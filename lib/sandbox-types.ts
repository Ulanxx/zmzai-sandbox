export type RunStatus = "queued" | "planning" | "running" | "cancellation_requested" | "cleanup_pending" | "succeeded" | "failed" | "cancelled";

export type RunEventKind = "system" | "stdout" | "stderr" | "status" | "artifact" | "sandbox.started" | "sandbox.output" | "sandbox.completed" | "sandbox.failed";

export type RunEvent = {
  id: string;
  sequence: number;
  at: string;
  kind: RunEventKind;
  message: string;
};

export type SandboxSnapshotFile = { path: string; content: string };
export type SandboxSnapshot = { revisionId: string | null; files: SandboxSnapshotFile[] };
export type SandboxCommand = { program: string; args: string[]; cwd?: string; envs?: Record<string, string> };
export type SandboxLimits = { timeoutMs?: number; cpuMillis?: number; memoryMiB?: number };

export type SandboxRun = {
  id: string;
  userId: string;
  ownerSandboxKeyId?: string;
  task: string;
  model: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  failure?: { code: string; error: string; retryable: boolean };
  provider: "demo" | "opensandbox";
  events: RunEvent[];
  artifacts: string[];
  // Internal agent runs (from a.zmzai.cloud exec tool) carry these fields.
  taskRunId?: string;
  requestId?: string;
  snapshot?: SandboxSnapshot;
  command?: SandboxCommand;
  limits?: SandboxLimits;
};

export type CreateRunInput = {
  userId: string;
  ownerSandboxKeyId?: string;
  task: string;
  model: string;
};

export type CreateAgentRunInput = {
  userId: string;
  taskRunId: string;
  requestId: string;
  snapshot: SandboxSnapshot;
  command: SandboxCommand;
  limits?: SandboxLimits;
};

