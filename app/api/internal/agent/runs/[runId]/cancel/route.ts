import { NextResponse } from "next/server";

import { agentCaller } from "@/lib/agent-auth";
import { abortAgentRun } from "@/lib/agent-executor";
import { cancelPersistedAgentRun, persistedRun } from "@/lib/persistent-runs";
import { deleteOpenSandbox } from "@/lib/opensandbox-provider";
import { cancelRun, getRun, updateRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!agentCaller(request)) return NextResponse.json({ code: "UNAUTHORIZED", error: "服务认证失败" }, { status: 401 });
  const { runId } = await context.params;
  abortAgentRun(runId);
  const inMemoryRun = cancelRun(runId);
  const run = inMemoryRun ?? await persistedRun(runId);
  if (!run) return NextResponse.json({ code: "RUN_NOT_FOUND", error: "Sandbox 运行不存在" }, { status: 404 });
  if (run.providerSandboxId) await deleteOpenSandbox(run.providerSandboxId).catch(() => undefined);
  // Route handlers do not share a durable AbortController with the executor.
  // A successful provider delete is the cancellation acknowledgement; finish
  // the projection here so the caller is never left in a limbo state.
  const cancelled = inMemoryRun
    ? updateRun(runId, "cancelled", "沙箱执行已取消并清理") ?? inMemoryRun
    : await cancelPersistedAgentRun(runId) ?? run;
  return NextResponse.json({ run: cancelled }, { status: ["succeeded", "failed", "cancelled"].includes(cancelled.status) ? 200 : 202, headers: { "Cache-Control": "no-store" } });
}
