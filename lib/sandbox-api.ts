import { createHash } from "node:crypto";

import { commandForAgent, imageForAgent, planSandboxTask } from "@/lib/agent-planner";
import { resolveSandboxCaller, type SandboxCaller } from "@/lib/relay-client";
import { runOpenSandboxCommand } from "@/lib/opensandbox-provider";
import { createRun, updateRun } from "@/lib/sandbox-store";
import type { SandboxRun } from "@/lib/sandbox-types";

type Submission = { fingerprint: string; run: SandboxRun; expiresAt: number };
const globalSubmissions = globalThis as typeof globalThis & { __zmzaiSandboxSubmissions?: Map<string, Submission> };
const submissions = globalSubmissions.__zmzaiSandboxSubmissions ?? new Map<string, Submission>();
globalSubmissions.__zmzaiSandboxSubmissions = submissions;

export async function sandboxCaller(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(zsk_[A-Za-z0-9_-]+)$/);
  return match ? resolveSandboxCaller(match[1]) : null;
}

export function readRunInput(body: unknown) {
  const value = body as { task?: unknown; model?: unknown } | null;
  const task = typeof value?.task === "string" ? value.task.trim() : "";
  const model = typeof value?.model === "string" ? value.model.trim() : "";
  if (task.length < 3 || task.length > 2000 || !model) return null;
  return { task, model };
}

export function idempotentRun(caller: SandboxCaller, idempotencyKey: string | null, input: { task: string; model: string }) {
  if (!idempotencyKey || !/^[\x21-\x7e]{16,128}$/.test(idempotencyKey)) return { error: "Idempotency-Key 必须是 16 到 128 个可打印字符" } as const;
  const key = `${caller.keyId}:${idempotencyKey}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const current = submissions.get(key);
  if (current && current.expiresAt > Date.now()) {
    return current.fingerprint === fingerprint ? { run: current.run, replayed: true } as const : { error: "同一 Idempotency-Key 不能对应不同请求" } as const;
  }
  const run = createRun({ task: input.task, model: input.model, userId: caller.userId, ownerSandboxKeyId: caller.keyId });
  submissions.set(key, { fingerprint, run, expiresAt: Date.now() + 86_400_000 });
  return { run, replayed: false } as const;
}

export function executeSandboxRun(runId: string, sandboxKey: string, input: { task: string; model: string }) {
  void (async () => {
    try {
      updateRun(runId, "running", "正在通过 Relay 规划受限命令");
      const command = await planSandboxTask(sandboxKey, input.model, input.task);
      updateRun(runId, "running", `Agent 已生成 ${command.language} 命令，正在启动隔离沙箱`);
      const result = await runOpenSandboxCommand({ command: commandForAgent(command), image: imageForAgent(command), timeoutMs: command.timeoutMs });
      for (const line of result.stdout) updateRun(runId, "running", line);
      for (const line of result.stderr) updateRun(runId, "running", line);
      updateRun(runId, result.exitCode === 0 ? "succeeded" : "failed", result.exitCode === 0 ? "沙箱执行完成，临时环境已清理" : "沙箱命令执行失败", result.exitCode);
    } catch (error) {
      updateRun(runId, "failed", error instanceof Error ? error.message : "Agent 或沙箱执行失败", 1);
    }
  })();
}
