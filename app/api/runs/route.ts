import { NextResponse } from "next/server";
import { commandForAgent, imageForAgent, planTask } from "@/lib/agent-planner";
import { getRelayModels, getSessionUser } from "@/lib/relay-client";
import { createRun, listRuns, updateRun } from "@/lib/sandbox-store";
import { runOpenSandboxCommand } from "@/lib/opensandbox-provider";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json({ runs: listRuns(user.id) });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { task?: unknown; model?: unknown } | null;
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";

  if (task.length < 3 || task.length > 2000) {
    return NextResponse.json({ error: "任务描述需要在 3 到 2000 个字符之间" }, { status: 400 });
  }

  if (!model) return NextResponse.json({ error: "请选择模型" }, { status: 400 });
  let availableModels;
  try {
    availableModels = await getRelayModels(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "模型目录不可用" }, { status: 503 });
  }
  if (!availableModels.some((item) => item.model === model)) {
    return NextResponse.json({ error: "所选模型不可用，请重新加载模型目录" }, { status: 400 });
  }
  const run = createRun({ task, model, userId: user.id });
  updateRun(run.id, "running", `已登录为 ${user.name}，正在请求 Agent 规划命令`);
  void executeRun(request, run.id, model, task);
  return NextResponse.json({ run }, { status: 201 });
}

async function executeRun(request: Request, runId: string, model: string, task: string) {
  try {
    const command = await planTask(request, model, task);
    updateRun(runId, "running", `Agent 已生成 ${command.language} 命令，正在启动隔离沙箱`);
    const result = await runOpenSandboxCommand({ command: commandForAgent(command), image: imageForAgent(command), timeoutMs: command.timeoutMs });
    for (const line of result.stdout) updateRun(runId, "running", line);
    for (const line of result.stderr) updateRun(runId, "running", line);
    updateRun(runId, result.exitCode === 0 ? "succeeded" : "failed", result.exitCode === 0 ? "沙箱执行完成，临时环境已清理" : "沙箱命令执行失败", result.exitCode);
  } catch (error) {
    updateRun(runId, "failed", error instanceof Error ? error.message : "Agent 或沙箱执行失败", 1);
  }
}
