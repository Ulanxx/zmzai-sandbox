import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAgentRunInput } from "@/lib/agent-api";

vi.mock("@/lib/agent-executor", () => ({
  createAgentRunRecord: vi.fn(),
  executeAgentSandboxRun: vi.fn(),
}));

vi.mock("@/lib/persistent-runs", () => ({
  activeAgentRunCount: vi.fn(),
  claimAgentSubmission: vi.fn(),
  existingAgentSubmission: vi.fn(),
  persistedRun: vi.fn(),
}));

function validBody() {
  return {
    userId: "user_123",
    taskRunId: "run_abc",
    requestId: "idempotent-request-0001",
    snapshot: { revisionId: "rev_1", files: [{ path: "src/app.ts", content: "export {};" }] },
    command: { program: "node", args: ["src/app.ts"] },
    limits: { timeoutMs: 30000, cpuMillis: 500, memoryMiB: 512 },
  };
}

describe("readAgentRunInput validation", () => {
  it("accepts a well-formed internal agent request", () => {
    const result = readAgentRunInput(validBody());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.requestId).toBe("idempotent-request-0001");
    expect(result.input.snapshot.files).toEqual([{ path: "src/app.ts", content: "export {};" }]);
    expect(result.input.limits).toEqual({ timeoutMs: 30000, cpuMillis: 500, memoryMiB: 512 });
  });

  it("rejects a requestId shorter than 16 chars", () => {
    const result = readAgentRunInput({ ...validBody(), requestId: "short" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("requestId");
  });

  it("rejects path traversal in snapshot paths", () => {
    const result = readAgentRunInput({
      ...validBody(),
      snapshot: { revisionId: null, files: [{ path: "../secret", content: "x" }] },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("路径不合法");
  });

  it("rejects absolute and dot-relative paths", () => {
    for (const path of ["/etc/passwd", "./local", "a/../../b"]) {
      const result = readAgentRunInput({ ...validBody(), snapshot: { revisionId: null, files: [{ path, content: "x" }] } });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects programs outside the allowlist", () => {
    const result = readAgentRunInput({ ...validBody(), command: { program: "sudo", args: ["rm", "-rf", "/"] } });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("不在允许列表");
  });

  it("rejects env keys that look like secrets", () => {
    const result = readAgentRunInput({ ...validBody(), command: { program: "node", args: [], envs: { API_KEY: "sk-123" } } });
    expect(result.ok).toBe(false);
  });

  it("rejects snapshots over the file cap", () => {
    const files = Array.from({ length: 201 }, (_, index) => ({ path: `f${index}.txt`, content: "x" }));
    const result = readAgentRunInput({ ...validBody(), snapshot: { revisionId: null, files } });
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range limits", () => {
    const result = readAgentRunInput({ ...validBody(), limits: { timeoutMs: 999, cpuMillis: 500, memoryMiB: 512 } });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("timeoutMs");
  });
});

describe("readAgentRunInput env allowlist", () => {
  beforeEach(() => {
    delete process.env.SANDBOX_AGENT_ALLOWED_PROGRAMS;
  });

  it("uses the default allowlist when unset", () => {
    const result = readAgentRunInput({ ...validBody(), command: { program: "node", args: [] } });
    expect(result.ok).toBe(true);
  });

  it("honors a configured allowlist", () => {
    process.env.SANDBOX_AGENT_ALLOWED_PROGRAMS = "python3,node";
    const ok = readAgentRunInput({ ...validBody(), command: { program: "node", args: [] } });
    expect(ok.ok).toBe(true);
    const rejected = readAgentRunInput({ ...validBody(), command: { program: "git", args: [] } });
    expect(rejected.ok).toBe(false);
  });
});
