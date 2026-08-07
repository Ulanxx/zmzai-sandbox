const DEFAULT_EXECD_PORT = 44772;

export type OpenSandboxCommand = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envs?: Record<string, string>;
  image?: string;
};

export type OpenSandboxCommandResult = {
  sandboxId: string;
  stdout: string[];
  stderr: string[];
  exitCode: number;
};

type Endpoint = { endpoint: string; headers?: Record<string, string> };

function getConfig() {
  const baseUrl = process.env.OPEN_SANDBOX_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("OPEN_SANDBOX_URL 未配置");
  return { baseUrl, apiKey: process.env.OPEN_SANDBOX_API_KEY?.trim() };
}

function lifecycleHeaders(apiKey?: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(apiKey ? { "OPEN-SANDBOX-API-KEY": apiKey } : {}),
  };
}

async function readError(response: Response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { code?: string; message?: string };
    return body.message || body.code || text;
  } catch {
    return text || response.statusText;
  }
}

async function lifecycleRequest(path: string, init?: RequestInit) {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { ...lifecycleHeaders(config.apiKey), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenSandbox ${response.status}: ${await readError(response)}`);
  return response;
}

function endpointUrl(endpoint: string) {
  if (/^https?:\/\//.test(endpoint)) return endpoint;
  const protocol = process.env.OPEN_SANDBOX_PROTOCOL?.trim() || "http";
  return `${protocol}://${endpoint}`;
}

async function getExecdEndpoint(sandboxId: string): Promise<Endpoint> {
  const response = await lifecycleRequest(`/sandboxes/${encodeURIComponent(sandboxId)}/endpoints/${DEFAULT_EXECD_PORT}`);
  return (await response.json()) as Endpoint;
}

async function deleteSandbox(sandboxId: string) {
  await lifecycleRequest(`/sandboxes/${encodeURIComponent(sandboxId)}`, { method: "DELETE" });
}

function parseSseChunk(buffer: string, onEvent: (event: { type?: string; text?: string; error?: { evalue?: string } }) => void) {
  const records = buffer.split(/\n\n/);
  const remainder = records.pop() ?? "";
  for (const record of records) {
    const data = record.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    try {
      onEvent(JSON.parse(data) as { type?: string; text?: string; error?: { evalue?: string } });
    } catch {
      // Ignore malformed keep-alive frames. The provider will still report the HTTP failure.
    }
  }
  return remainder;
}

export async function checkOpenSandbox() {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}/sandboxes?page=1&pageSize=1`, {
    headers: lifecycleHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenSandbox ${response.status}: ${await readError(response)}`);
  return { ok: true as const, baseUrl: config.baseUrl };
}

export async function runOpenSandboxCommand(input: OpenSandboxCommand): Promise<OpenSandboxCommandResult> {
  const config = getConfig();
  const createResponse = await lifecycleRequest("/sandboxes", {
    method: "POST",
    body: JSON.stringify({
      image: { uri: input.image || process.env.OPEN_SANDBOX_IMAGE?.trim() || "node:22-alpine" },
      timeout: Math.max(60, Math.ceil((input.timeoutMs ?? 60000) / 1000) + 30),
      resourceLimits: {
        cpu: process.env.OPEN_SANDBOX_CPU_LIMIT?.trim() || "500m",
        memory: process.env.OPEN_SANDBOX_MEMORY_LIMIT?.trim() || "512Mi",
      },
      entrypoint: ["tail", "-f", "/dev/null"],
      networkPolicy: { defaultAction: "deny" },
      metadata: { "zmzai.managed": "true" },
    }),
  });
  const created = (await createResponse.json()) as { id?: string };
  if (!created.id) throw new Error("OpenSandbox 创建响应缺少 sandbox id");

  const sandboxId = created.id;
  try {
    const endpoint = await getExecdEndpoint(sandboxId);
    const response = await fetch(`${endpointUrl(endpoint.endpoint)}/command`, {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json", ...(endpoint.headers ?? {}) },
      body: JSON.stringify({ command: input.command, ...(input.cwd ? { cwd: input.cwd } : {}), timeout: input.timeoutMs ?? 60000, background: false, envs: input.envs }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`OpenSandbox Execd ${response.status}: ${await readError(response)}`);

    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = 0;
    let buffer = "";
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OpenSandbox Execd 没有返回 SSE body");
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = parseSseChunk(buffer, (event) => {
        if (event.type === "stdout" && event.text) stdout.push(event.text);
        if (event.type === "stderr" && event.text) stderr.push(event.text);
        if (event.type === "error") {
          stderr.push(event.error?.evalue || event.text || "OpenSandbox 执行失败");
          exitCode = 1;
        }
      });
    }
    return { sandboxId, stdout, stderr, exitCode };
  } finally {
    await deleteSandbox(sandboxId).catch(() => undefined);
  }
}
