import { NextResponse } from "next/server";

import { agentCaller } from "@/lib/agent-auth";
import { getRunArtifacts } from "@/lib/artifact-store";
import { persistedRun } from "@/lib/persistent-runs";
import { getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!agentCaller(request)) return NextResponse.json({ code: "UNAUTHORIZED", error: "服务认证失败" }, { status: 401 });
  const { runId } = await context.params;
  const run = getRun(runId) ?? await persistedRun(runId);
  if (!run) return NextResponse.json({ code: "RUN_NOT_FOUND", error: "Sandbox 运行不存在" }, { status: 404 });
  const artifacts = getRunArtifacts(runId).map(({ content: _content, ...meta }) => meta);
  return NextResponse.json({ artifacts }, { headers: { "Cache-Control": "no-store" } });
}
