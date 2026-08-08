import { NextResponse } from "next/server";

import { sandboxCaller } from "@/lib/sandbox-api";
import { getRunForSandboxKey } from "@/lib/sandbox-store";
import { persistedRun } from "@/lib/persistent-runs";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const caller = await sandboxCaller(request).catch(() => null);
  if (!caller) return NextResponse.json({ code: "SANDBOX_KEY_INVALID", error: "Sandbox key 无效或已撤销" }, { status: 401 });
  const { runId } = await params;
  const run = getRunForSandboxKey(runId, caller.keyId) ?? await persistedRun(runId, caller.keyId).catch(() => undefined);
  return run ? NextResponse.json({ run }) : NextResponse.json({ code: "RUN_NOT_FOUND", error: "运行不存在" }, { status: 404 });
}
