type RelayUser = { id: string; name: string; email: string; role: string };

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

export function loginUrl() {
  return `${authUrl()}/login`;
}
