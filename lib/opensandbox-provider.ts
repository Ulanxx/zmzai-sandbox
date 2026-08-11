import { createHash } from "node:crypto";

import { maxArtifactCount, maxArtifactFileBytes, maxArtifactTotalBytes, type SandboxArtifactData } from "@/lib/sandbox-types";

const DEFAULT_EXECD_PORT = 44772;
// Execd commands run at the container root by default; a dedicated workdir keeps
// snapshot files, commands and artifact collection scoped and isolated.
const agentWorkDir = "/work";
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

export type OpenSandboxCommand = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envs?: Record<string, string>;
  image?: string;
  signal?: AbortSignal;
  metadata?: Record<string, string>;
  onSandboxCreated?: (sandboxId: string) => Promise<void> | void;
};

export type OpenSandboxCommandResult = {
  sandboxId: string;
  stdout: string[];
  stderr: string[];
  exitCode: number;
};

export type AgentSandboxCommand = {
  files: Array<{ path: string; content: string }>;
  program: string;
  args: string[];
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  cpuMillis?: number;
  memoryMiB?: number;
  image?: string;
  signal?: AbortSignal;
  onLine?: (kind: "stdout" | "stderr", text: string) => void;
  /** Collect files new or changed vs the input snapshot into `artifacts`. */
  collectArtifacts?: boolean;
  inputFiles?: Array<{ path: string; content: string }>;
};

export type AgentSandboxCommandResult = {
  stdout: string[];
  stderr: string[];
  exitCode: number;
  artifacts: SandboxArtifactData[];
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

export async function deleteOpenSandbox(sandboxId: string) {
  await lifecycleRequest(`/sandboxes/${encodeURIComponent(sandboxId)}`, { method: "DELETE" });
}

export async function findOpenSandboxes(metadata: Record<string, string>) {
  const response = await lifecycleRequest("/sandboxes?page=1&pageSize=100");
  const body = (await response.json()) as { items?: Array<{ id?: string; metadata?: Record<string, string> }> };
  return (body.items ?? []).flatMap((sandbox) => {
    if (!sandbox.id || !sandbox.metadata) return [];
    return Object.entries(metadata).every(([key, value]) => sandbox.metadata?.[key] === value) ? [sandbox.id] : [];
  });
}

function parseSseChunk(buffer: string, onEvent: (event: { type?: string; text?: string; error?: { evalue?: string } }) => void) {
  const records = buffer.split(/\n\n/);
  const remainder = records.pop() ?? "";
  for (const record of records) {
    const dataLines = record.split("\n").filter((line) => line.startsWith("data:"));
    // OpenSandbox Execd writes raw JSON records; standard SSE proxies add data: prefixes.
    const data = dataLines.length > 0 ? dataLines.map((line) => line.slice(5).trim()).join("\n") : record.trim();
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
      metadata: { "zmzai.managed": "true", ...(input.metadata ?? {}) },
    }),
  });
  const created = (await createResponse.json()) as { id?: string };
  if (!created.id) throw new Error("OpenSandbox 创建响应缺少 sandbox id");

  const sandboxId = created.id;
  await input.onSandboxCreated?.(sandboxId);
  const abort = () => { void deleteOpenSandbox(sandboxId).catch(() => undefined); };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const endpoint = await getExecdEndpoint(sandboxId);
    const response = await fetch(`${endpointUrl(endpoint.endpoint)}/command`, {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json", ...(endpoint.headers ?? {}) },
      body: JSON.stringify({ command: input.command, ...(input.cwd ? { cwd: input.cwd } : {}), timeout: input.timeoutMs ?? 60000, background: false, envs: input.envs }),
      cache: "no-store",
      signal: input.signal,
    });
    if (!response.ok) throw new Error(`OpenSandbox Execd ${response.status}: ${await readError(response)}`);

    const stdout: string[] = [];
    const stderr: string[] = [];
    let outputBytes = 0;
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
        if (event.type === "stdout" && event.text) { outputBytes += Buffer.byteLength(event.text); if (outputBytes <= MAX_OUTPUT_BYTES) stdout.push(event.text); }
        if (event.type === "stderr" && event.text) { outputBytes += Buffer.byteLength(event.text); if (outputBytes <= MAX_OUTPUT_BYTES) stderr.push(event.text); }
        if (event.type === "error") {
          stderr.push(event.error?.evalue || event.text || "OpenSandbox 执行失败");
          exitCode = 1;
        }
      });
    }
    if (outputBytes > MAX_OUTPUT_BYTES) { stderr.push("输出超过 256 KiB 限制，已截断"); exitCode = 1; }
    return { sandboxId, stdout, stderr, exitCode };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await deleteOpenSandbox(sandboxId).catch(() => undefined);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function relativeDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

async function execdCommand(endpoint: Endpoint, body: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(`${endpointUrl(endpoint.endpoint)}/command`, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json", ...(endpoint.headers ?? {}) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`OpenSandbox Execd ${response.status}: ${await readError(response)}`);
  return response;
}

async function streamExecdOutput(response: Response, onLine: (kind: "stdout" | "stderr", text: string) => void): Promise<{ stdout: string[]; stderr: string[]; exitCode: number; artifacts?: SandboxArtifactData[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let outputBytes = 0;
  let exitCode = 0;
  let buffer = "";
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenSandbox Execd 没有返回 SSE body");
  const decoder = new TextDecoder();
  const push = (kind: "stdout" | "stderr", text: string) => {
    outputBytes += Buffer.byteLength(text);
    if (outputBytes <= MAX_OUTPUT_BYTES) {
      if (kind === "stdout") stdout.push(text);
      else stderr.push(text);
    }
    onLine(kind, text);
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    buffer = parseSseChunk(buffer, (event) => {
      if (event.type === "stdout" && event.text) push("stdout", event.text);
      if (event.type === "stderr" && event.text) push("stderr", event.text);
      if (event.type === "error") {
        push("stderr", event.error?.evalue || event.text || "OpenSandbox 执行失败");
        exitCode = 1;
      }
    });
  }
  if (outputBytes > MAX_OUTPUT_BYTES) { push("stderr", "输出超过 256 KiB 限制，已截断"); exitCode = 1; }
  return { stdout, stderr, exitCode };
}

/** Captures raw stdout text from an Execd SSE stream up to `maxBytes`. Execd
 *  delivers each line as its own stdout event WITHOUT the trailing newline, so
 *  `chunks` preserves the per-line boundaries for callers that need them. */
async function captureStdout(response: Response, maxBytes: number): Promise<{ text: string; chunks: string[]; truncated: boolean; exitCode: number }> {
  const chunks: string[] = [];
  let text = "";
  let truncated = false;
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
      if (event.type === "stdout" && event.text) {
        chunks.push(event.text);
        const remaining = maxBytes - Buffer.byteLength(text, "utf8");
        if (remaining > 0) text += event.text.slice(0, Math.max(0, remaining));
        else truncated = true;
      }
      if (event.type === "error") {
        exitCode = 1;
      }
    });
  }
  return { text, chunks, truncated, exitCode };
}

const contentTypeByExt: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
};

function contentTypeFor(path: string): string {
  const extension = path.includes(".") ? path.split(".").pop()?.toLowerCase() ?? "" : "";
  return contentTypeByExt[extension] ?? "application/octet-stream";
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Lists the sandbox workdir and reads back files that are new or changed
 * relative to the input snapshot. Over-limit files are marked `tooLarge` and
 * skipped. Runs before the temp sandbox is deleted.
 */
async function collectSandboxArtifacts(endpoint: Endpoint, input: AgentSandboxCommand, signal?: AbortSignal): Promise<SandboxArtifactData[]> {
  const listResponse = await execdCommand(endpoint, { command: "find . -type f -printf '%s\\t%p\\n' 2>/dev/null || find . -type f", cwd: agentWorkDir, timeout: 30_000, background: false }, signal);
  const listing = await captureStdout(listResponse, 1024 * 1024);
  // Each execd stdout event is one line without the trailing newline.
  const rows = listing.chunks.map((line) => line.trim()).filter(Boolean);
  const files: Array<{ path: string; bytes: number }> = [];
  for (const row of rows) {
    const tab = row.indexOf("\t");
    if (tab > 0) {
      const bytes = Number.parseInt(row.slice(0, tab), 10);
      const path = row.slice(tab + 1).replace(/^\.\//, "");
      if (Number.isFinite(bytes)) files.push({ path, bytes });
      else files.push({ path, bytes: 0 });
    } else {
      files.push({ path: row.replace(/^\.\//, ""), bytes: 0 });
    }
  }

  const inputHashes = new Map<string, string>((input.inputFiles ?? []).map((file) => [file.path, sha256Hex(Buffer.from(file.content, "utf8"))]));
  const inputPaths = new Set((input.inputFiles ?? []).map((file) => file.path));
  const artifacts: SandboxArtifactData[] = [];
  let totalBytes = 0;

  for (const { path, bytes } of files) {
    if (!path || path.includes("\0") || path.split("/").includes("..") || path.startsWith("/")) continue;
    if (artifacts.length >= maxArtifactCount || totalBytes >= maxArtifactTotalBytes) {
      artifacts.push({ path, bytes, contentType: contentTypeFor(path), sha256: "", tooLarge: true, content: Buffer.alloc(0) });
      continue;
    }
    if (bytes > maxArtifactFileBytes) {
      artifacts.push({ path, bytes, contentType: contentTypeFor(path), sha256: "", tooLarge: true, content: Buffer.alloc(0) });
      continue;
    }
    // Portable base64: no -w flag (busybox in alpine lacks it); wrapped output
    // still decodes fine because Buffer.from(..., "base64") ignores whitespace.
    const readResponse = await execdCommand(endpoint, { command: `base64 ${shellQuote(path)} 2>/dev/null`, cwd: agentWorkDir, timeout: 30_000, background: false }, signal);
    const read = await captureStdout(readResponse, maxArtifactFileBytes * 2 + 1024);
    if (read.exitCode !== 0) continue; // unreadable entry (directory, broken link)
    let content: Buffer;
    try {
      content = Buffer.from(read.text, "base64");
    } catch {
      continue;
    }
    if (read.truncated || content.length > maxArtifactFileBytes) {
      artifacts.push({ path, bytes: content.length || bytes, contentType: contentTypeFor(path), sha256: "", tooLarge: true, content: Buffer.alloc(0) });
      continue;
    }
    // Skip files unchanged relative to the input snapshot.
    const hash = sha256Hex(content);
    if (inputPaths.has(path) && inputHashes.get(path) === hash) continue;
    totalBytes += content.length;
    if (totalBytes > maxArtifactTotalBytes) {
      artifacts.push({ path, bytes: content.length, contentType: contentTypeFor(path), sha256: "", tooLarge: true, content: Buffer.alloc(0) });
      break;
    }
    artifacts.push({ path, bytes: content.length, contentType: contentTypeFor(path), sha256: hash, tooLarge: false, content });
  }
  if (!artifacts.length) console.error("[artifact-collect] no deliverables; raw listing:", JSON.stringify(listing.text.slice(0, 2000)));
  return artifacts;
}

/**
 * Creates an isolated sandbox, writes the caller-provided snapshot files into
 * the workdir (via the verified Execd `/command` API using base64 — no host
 * filesystem access), then runs `program args`. stdout/stderr lines are pushed
 * to `onLine` as they arrive so the agent can stream them into the run store.
 * With `collectArtifacts` enabled, files new or changed vs the snapshot are
 * read back before the sandbox is deleted.
 */
export async function runAgentSandboxCommand(input: AgentSandboxCommand): Promise<AgentSandboxCommandResult> {
  const snapshotBytes = input.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    throw new Error("快照总大小超过 1 MiB 限制");
  }
  const config = getConfig();
  const createResponse = await lifecycleRequest("/sandboxes", {
    method: "POST",
    body: JSON.stringify({
      image: { uri: input.image || process.env.OPEN_SANDBOX_IMAGE?.trim() || "node:22-alpine" },
      timeout: Math.max(60, Math.ceil((input.timeoutMs ?? 60000) / 1000) + 30),
      resourceLimits: {
        cpu: input.cpuMillis ? `${input.cpuMillis}m` : process.env.OPEN_SANDBOX_CPU_LIMIT?.trim() || "500m",
        memory: input.memoryMiB ? `${input.memoryMiB}Mi` : process.env.OPEN_SANDBOX_MEMORY_LIMIT?.trim() || "512Mi",
      },
      entrypoint: ["tail", "-f", "/dev/null"],
      networkPolicy: { defaultAction: "deny" },
      metadata: { "zmzai.managed": "true", "zmzai.agent": "true" },
    }),
  });
  const created = (await createResponse.json()) as { id?: string };
  if (!created.id) throw new Error("OpenSandbox 创建响应缺少 sandbox id");
  const sandboxId = created.id;
  const abort = () => { void deleteOpenSandbox(sandboxId).catch(() => undefined); };
  input.signal?.addEventListener("abort", abort, { once: true });

  try {
    const endpoint = await getExecdEndpoint(sandboxId);
    // Dedicated workdir so snapshot writes, the command and artifact
    // collection never touch the container root filesystem.
    const mkdirResponse = await execdCommand(endpoint, { command: `mkdir -p ${shellQuote(agentWorkDir)}`, timeout: 30_000, background: false }, input.signal);
    await streamExecdOutput(mkdirResponse, () => undefined);
    for (const file of input.files) {
      const dir = relativeDir(file.path);
      const base64 = Buffer.from(file.content).toString("base64");
      const write = `${dir ? `mkdir -p ${shellQuote(dir)} && ` : ""}printf '%s' '${base64}' | base64 -d > ${shellQuote(file.path)}`;
      const writeResponse = await execdCommand(endpoint, { command: write, cwd: agentWorkDir, timeout: 30_000, background: false }, input.signal);
      await streamExecdOutput(writeResponse, () => undefined);
    }
    const command = [input.program, ...input.args].map(shellQuote).join(" ");
    const runResponse = await execdCommand(endpoint, { command, cwd: input.cwd ?? agentWorkDir, timeout: input.timeoutMs ?? 60000, background: false, envs: input.envs }, input.signal);
    const result = await streamExecdOutput(runResponse, input.onLine ?? (() => undefined));
    if (input.collectArtifacts && result.exitCode === 0) {
      try {
        result.artifacts = await collectSandboxArtifacts(endpoint, input, input.signal);
      } catch (error) {
        console.error("[artifact-collect] collection failed", error instanceof Error ? error.message : error);
        result.artifacts = [];
      }
    } else {
      result.artifacts = [];
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, artifacts: result.artifacts ?? [] };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await deleteOpenSandbox(sandboxId).catch(() => undefined);
  }
}
