import { runAgentSandboxCommand } from "@/lib/opensandbox-provider";
import { appendRunEvent, createRun, getRun, updateRun } from "@/lib/sandbox-store";
import type { CreateAgentRunInput } from "@/lib/sandbox-types";

const globalExecutions = globalThis as typeof globalThis & { __zmzaiAgentSandboxExecutions?: Map<string, AbortController> };
const executions = globalExecutions.__zmzaiAgentSandboxExecutions ?? new Map<string, AbortController>();
globalExecutions.__zmzaiAgentSandboxExecutions = executions;

export function createAgentRunRecord(input: CreateAgentRunInput, id: string) {
  return createRun(
    {
      userId: input.userId,
      task: `Agent 执行：${input.command.program} ${input.command.args.join(" ")}`,
      model: "agent",
      taskRunId: input.taskRunId,
      requestId: input.requestId,
      snapshot: input.snapshot,
      command: input.command,
      limits: input.limits,
    },
    id,
  );
}

/**
 * Executes an internal agent run: creates the sandbox, writes the snapshot,
 * runs the command, and streams `sandbox.*` events into the run store.
 * With no OPEN_SANDBOX_URL configured the provider is "demo" and the run is
 * simulated so the agent integration can be developed end-to-end locally.
 */
export async function executeAgentRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  const input = run.taskRunId && run.requestId && run.snapshot && run.command ? { userId: run.userId, taskRunId: run.taskRunId, requestId: run.requestId, snapshot: run.snapshot, command: run.command, limits: run.limits } : null;
  if (!input) {
    updateRun(runId, "failed", "内部运行缺少执行参数");
    return;
  }
  try {
    updateRun(runId, "running", "已接收执行请求，正在准备隔离沙箱");
    appendRunEvent(runId, "sandbox.started", `开始执行 ${input.command.program} ${input.command.args.join(" ")}`);
    if (run.provider === "demo") {
      updateRun(runId, "running", `Demo Sandbox：载入 ${input.snapshot.files.length} 个快照文件（${input.snapshot.revisionId ?? "草稿"}）`);
      const summary = input.snapshot.files.slice(0, 5).map((file) => file.path).join("、");
      appendRunEvent(runId, "sandbox.output", `快照文件：${summary}${input.snapshot.files.length > 5 ? ` 等 ${input.snapshot.files.length} 个` : ""}`);
      appendRunEvent(runId, "sandbox.output", `模拟执行：${input.command.program} ${input.command.args.join(" ")}`);
      appendRunEvent(runId, "sandbox.completed", "Demo Sandbox 执行完成（未连接 OpenSandbox，未真实运行）");
      updateRun(runId, "succeeded", "Demo Sandbox 执行完成", 0);
      return;
    }
    const limits = {
      timeoutMs: input.limits?.timeoutMs ?? 60000,
      cpuMillis: input.limits?.cpuMillis ?? 500,
      memoryMiB: input.limits?.memoryMiB ?? 512,
    };
    const result = await runAgentSandboxCommand({
      files: input.snapshot.files,
      program: input.command.program,
      args: input.command.args,
      cwd: input.command.cwd,
      envs: input.command.envs,
      timeoutMs: limits.timeoutMs,
      cpuMillis: limits.cpuMillis,
      memoryMiB: limits.memoryMiB,
      signal: executions.get(runId)?.signal,
      onLine: (kind, text) => appendRunEvent(runId, "sandbox.output", text),
    });
    if (result.exitCode === 0) {
      appendRunEvent(runId, "sandbox.completed", `执行完成，退出码 ${result.exitCode}，临时环境已清理`);
      updateRun(runId, "succeeded", "沙箱执行完成，临时环境已清理", result.exitCode);
    } else {
      appendRunEvent(runId, "sandbox.failed", `命令以退出码 ${result.exitCode} 结束`);
      updateRun(runId, "failed", `沙箱命令执行失败（退出码 ${result.exitCode}）`, result.exitCode);
    }
  } catch (error) {
    const signal = executions.get(runId)?.signal;
    if (signal?.aborted) {
      appendRunEvent(runId, "sandbox.failed", "执行已取消并清理");
      updateRun(runId, "cancelled", "沙箱执行已取消并清理");
    } else {
      const message = error instanceof Error ? error.message : "Agent 或沙箱执行失败";
      appendRunEvent(runId, "sandbox.failed", message);
      updateRun(runId, "failed", message, 1);
    }
  } finally {
    executions.delete(runId);
  }
}

export function executeAgentSandboxRun(runId: string) {
  const controller = new AbortController();
  executions.set(runId, controller);
  void executeAgentRun(runId);
}

export function abortAgentRun(runId: string) {
  executions.get(runId)?.abort();
}
