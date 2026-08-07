type RelayUser = { id: string; name: string; email: string; role: string };
export type RelayModel = { model: string; maxInputTokens?: number; maxOutputTokens?: number; allowedReasoningEfforts?: string[] };

const authUrl = () => (process.env.AUTH_URL?.trim() || "https://auth.zmzai.cloud").replace(/\/$/, "");
const relayUrl = () => (process.env.RELAY_URL?.trim() || "https://m.zmzai.cloud/api/v1").replace(/\/$/, "");

function forwardedHeaders(request: Request, extra?: HeadersInit) {
  const headers = new Headers(extra);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("accept", "application/json");
  return headers;
}

export async function getSessionUser(request: Request): Promise<RelayUser | null> {
  if (!request.headers.get("cookie")) return null;
  const response = await fetch(`${authUrl()}/api/me`, {
    headers: forwardedHeaders(request),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`认证服务返回 HTTP ${response.status}`);
  const body = (await response.json()) as { user?: RelayUser | null };
  return body.user ?? null;
}

export async function relayRequest(request: Request, path: string, init?: RequestInit) {
  return fetch(`${relayUrl()}${path}`, {
    ...init,
    headers: forwardedHeaders(request, init?.headers),
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(120_000),
  });
}

export async function getRelayModels(request: Request) {
  const response = await relayRequest(request, "/models", { method: "GET" });
  const body = (await response.json().catch(() => null)) as { models?: unknown } | null;
  if (!response.ok) throw new Error(`Relay 模型目录返回 HTTP ${response.status}`);
  const models = Array.isArray(body?.models) ? body.models : [];
  return models.filter((model): model is RelayModel => {
    if (!model || typeof model !== "object") return false;
    return typeof (model as { model?: unknown }).model === "string";
  });
}

export function loginUrl() {
  return `${authUrl()}/login`;
}
