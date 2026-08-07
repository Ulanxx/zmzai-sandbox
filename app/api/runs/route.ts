import { NextResponse } from "next/server";
import { createRun, listRuns, startDemoRun, updateRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { task?: unknown; model?: unknown } | null;
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "relay-default";

  if (task.length < 3 || task.length > 2000) {
    return NextResponse.json({ error: "任务描述需要在 3 到 2000 个字符之间" }, { status: 400 });
  }

  const run = createRun({ task, model });
  if (run.provider === "demo") {
    startDemoRun(run.id);
  } else {
    updateRun(run.id, "failed", "OpenSandbox 地址已配置，但 Provider 适配器尚未接入", 1);
  }
  return NextResponse.json({ run }, { status: 201 });
}
