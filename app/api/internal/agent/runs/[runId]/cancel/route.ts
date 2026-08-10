import { NextResponse } from "next/server";

import { agentCaller } from "@/lib/agent-auth";
import { abortAgentRun } from "@/lib/agent-executor";
import { persistedRun } from "@/lib/persistent-runs";
import { cancelRun, getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!agentCaller(request)) return NextResponse.json({ code: "UNAUTHORIZED", error: "服务认证失败" }, { status: 401 });
  const { runId } = await context.params;
  abortAgentRun(runId);
  const run = cancelRun(runId) ?? await persistedRun(runId);
  if (!run) return NextResponse.json({ code: "RUN_NOT_FOUND", error: "Sandbox 运行不存在" }, { status: 404 });
  return NextResponse.json({ run }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
