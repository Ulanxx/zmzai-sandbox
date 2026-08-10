import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentCaller } from "@/lib/agent-auth";

const originalCurrent = process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT;
const originalPrevious = process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS;

function request(header: string | null): Request {
  return new Request("http://localhost/api/internal/agent/runs", { headers: header ? { authorization: header } : {} });
}

beforeEach(() => {
  process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT = "current-secret-value";
  process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS = "";
});

afterEach(() => {
  if (originalCurrent === undefined) delete process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT;
  else process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT = originalCurrent;
  if (originalPrevious === undefined) delete process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS;
  else process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS = originalPrevious;
});

describe("agentCaller", () => {
  it("accepts the current service secret", () => {
    expect(agentCaller(request("Bearer current-secret-value"))).toBe(true);
  });

  it("accepts the previous secret during rotation", () => {
    process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS = "previous-secret-value";
    expect(agentCaller(request("Bearer previous-secret-value"))).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(agentCaller(request("Bearer not-the-secret"))).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(agentCaller(request(null))).toBe(false);
    expect(agentCaller(request("Basic abc"))).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    delete process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT;
    delete process.env.SANDBOX_AGENT_SERVICE_SECRET_PREVIOUS;
    expect(agentCaller(request("Bearer anything"))).toBe(false);
  });
});
