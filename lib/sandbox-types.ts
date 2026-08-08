export type RunStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";

export type RunEvent = {
  id: string;
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
