import { createHash, randomUUID } from "node:crypto";

import { commandForAgent, imageForAgent, planSandboxTask } from "@/lib/agent-planner";
import { resolveSandboxCaller, type SandboxCaller } from "@/lib/relay-client";
import { deleteOpenSandbox, findOpenSandboxes, runOpenSandboxCommand } from "@/lib/opensandbox-provider";
import { createRun, updateRun } from "@/lib/sandbox-store";
import { activeRunCount, claimSubmission, existingSubmission, heartbeatExecutionLease, persistedRun, recordProviderSandbox, recoverExpiredExecutions, releaseExecutionLease, startExecutionLease } from "@/lib/persistent-runs";
import type { SandboxRun } from "@/lib/sandbox-types";

const globalExecutions = globalThis as typeof globalThis & { __zmzaiSandboxExecutions?: Map<string, AbortController> };
const executions = globalExecutions.__zmzaiSandboxExecutions ?? new Map<string, AbortController>();
globalExecutions.__zmzaiSandboxExecutions = executions;


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

export async function idempotentRun(caller: SandboxCaller, idempotencyKey: string | null, input: { task: string; model: string }) {
  if (!idempotencyKey || !/^[\x21-\x7e]{16,128}$/.test(idempotencyKey)) return { error: "Idempotency-Key 必须是 16 到 128 个可打印字符" } as const;
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await recoverExpiredExecutions(deleteOpenSandbox, findOpenSandboxes).catch(() => undefined);
  const existing = await existingSubmission(caller.keyId, idempotencyKey);
  if (existing) {
    if (existing.requestHash !== fingerprint) return { error: "同一 Idempotency-Key 不能对应不同请求" } as const;
    const run = await persistedRun(existing.runId, caller.keyId);
    return run ? { run, replayed: true } as const : { error: "该请求正在恢复，请稍后查询 runId" } as const;
  }
  const [keyActive, totalActive] = await Promise.all([activeRunCount(caller.keyId), activeRunCount()]);
  if (keyActive >= 1) return { error: "当前 sandbox_key 已有运行中的任务" } as const;
  if (totalActive >= 3) return { error: "Sandbox 当前并发已满，请稍后重试" } as const;
  const runId = `run_${randomUUID().slice(0, 8)}`;
  const claimed = await claimSubmission(caller.keyId, idempotencyKey, fingerprint, runId);
  if ("conflict" in claimed) return { error: "同一 Idempotency-Key 不能对应不同请求" } as const;
  if (!claimed.created) {
    const run = await persistedRun(claimed.runId, caller.keyId);
    return run ? { run, replayed: true } as const : { error: "该请求正在恢复，请稍后查询 runId" } as const;
  }
  const run = createRun({ task: input.task, model: input.model, userId: caller.userId, ownerSandboxKeyId: caller.keyId }, runId);
  return { run, replayed: false } as const;
}

export function executeSandboxRun(runId: string, ownerSandboxKeyId: string, sandboxKey: string, input: { task: string; model: string }) {
  const controller = new AbortController();
  const executionId = randomUUID();
  executions.set(runId, controller);
  void (async () => {
    const heartbeat = setInterval(() => { void heartbeatExecutionLease(runId, executionId).catch(() => undefined); }, 20_000);
    try {
      if (!(await startExecutionLease(runId, ownerSandboxKeyId, executionId))) throw new Error("Sandbox 当前并发已满，请稍后重试");
      updateRun(runId, "planning", "正在通过 Relay 规划受限命令");
      const command = await planSandboxTask(sandboxKey, input.model, input.task);
      updateRun(runId, "running", `Agent 已生成 ${command.language} 命令，正在启动隔离沙箱`);
      const result = await runOpenSandboxCommand({
        command: commandForAgent(command),
        image: imageForAgent(command),
        timeoutMs: command.timeoutMs,
        signal: controller.signal,
        metadata: { "zmzai.run_id": runId, "zmzai.execution_id": executionId },
        onSandboxCreated: async (sandboxId) => { await recordProviderSandbox(runId, executionId, sandboxId); updateRun(runId, "running", "临时沙箱已创建，正在执行受限命令"); },
      });
      for (const line of result.stdout) updateRun(runId, "running", line);
      for (const line of result.stderr) updateRun(runId, "running", line);
      updateRun(runId, result.exitCode === 0 ? "succeeded" : "failed", result.exitCode === 0 ? "沙箱执行完成，临时环境已清理" : "沙箱命令执行失败", result.exitCode);
    } catch (error) {
      updateRun(runId, controller.signal.aborted ? "cancelled" : "failed", controller.signal.aborted ? "沙箱执行已取消并清理" : error instanceof Error ? error.message : "Agent 或沙箱执行失败", controller.signal.aborted ? undefined : 1);
    } finally { clearInterval(heartbeat); executions.delete(runId); await releaseExecutionLease(runId, executionId).catch(() => undefined); }
  })();
}

export function abortSandboxRun(runId: string) {
  const controller = executions.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}
