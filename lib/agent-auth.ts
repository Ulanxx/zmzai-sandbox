import { timingSafeEqual } from "node:crypto";

/**
 * Service-to-service authentication for the internal Agent API. The caller
 * (a.zmzai.cloud) presents `Authorization: Bearer <SANDBOX_AGENT_SERVICE_SECRET>`.
 * The secret only exists in the a.zmzai.cloud and z.zmzai.cloud server envs —
 * never in the browser or in any user-visible sandbox_key flow.
 */
export function agentCaller(request: Request): boolean {
  const match = /^Bearer\s+(.+)$/.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1] ?? "";
  const current = process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT?.trim() ?? "";
  const previous = process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS?.trim() ?? "";
  if (!current && !previous) return false;
  const candidate = Buffer.from(token);
  const accept = (secret: string) => {
    if (!secret) return false;
    const expected = Buffer.from(secret);
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  };
  return accept(current) || accept(previous);
}
