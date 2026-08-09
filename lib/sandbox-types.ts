export type RunStatus = "queued" | "planning" | "running" | "cancellation_requested" | "cleanup_pending" | "succeeded" | "failed" | "cancelled";

export type RunEvent = {
  id: string;
  sequence: number;
  at: string;
  kind: "system" | "stdout" | "stderr" | "status" | "artifact";
  message: string;
};

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
};

export type CreateRunInput = {
  userId: string;
  ownerSandboxKeyId?: string;
  task: string;
  model: string;
};
