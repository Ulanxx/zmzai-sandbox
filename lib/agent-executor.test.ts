import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "cancellation_requested", updates: [] as Array<{ status: string; message?: string }> }));

vi.mock("@/lib/opensandbox-provider", () => ({
  deleteOpenSandbox: vi.fn(),
  runAgentSandboxCommand: vi.fn(async () => ({ stdout: [], stderr: [], exitCode: 0, artifacts: [] })),
}));

vi.mock("@/lib/artifact-store", () => ({ setRunArtifacts: vi.fn() }));

vi.mock("@/lib/sandbox-store", () => ({
  appendRunEvent: vi.fn(),
  createRun: vi.fn(),
  getRun: vi.fn(() => ({
    id: "run_cancelled",
    userId: "user_1",
    status: state.status,
    provider: "opensandbox",
    taskRunId: "task_run_1",
    requestId: "request_0000000001",
    snapshot: { revisionId: null, files: [] },
    command: { program: "sh", args: ["-c", "sleep 30"] },
    limits: {},
  })),
  setRunDeliverables: vi.fn(),
  setRunProviderSandbox: vi.fn(),
  updateRun: vi.fn((_runId: string, status: string, message?: string) => {
    state.updates.push({ status, message });
  }),
}));

import { executeAgentRun } from "@/lib/agent-executor";

describe("executeAgentRun cancellation", () => {
  beforeEach(() => {
    state.status = "cancellation_requested";
    state.updates = [];
  });

  it("keeps a cancelled run terminal when a provider success arrives late", async () => {
    await executeAgentRun("run_cancelled");

    expect(state.updates.some((update) => update.status === "cancelled")).toBe(true);
    expect(state.updates.some((update) => update.status === "succeeded")).toBe(false);
  });
});
