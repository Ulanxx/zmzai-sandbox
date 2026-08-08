import { NextResponse } from "next/server";

import { sandboxCaller } from "@/lib/sandbox-api";
import { cancelRun, getRunForSandboxKey } from "@/lib/sandbox-store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const caller = await sandboxCaller(request).catch(() => null);
  if (!caller) return NextResponse.json({ code: "SANDBOX_KEY_INVALID", error: "Sandbox key 无效或已撤销" }, { status: 401 });
  const { runId } = await params;
  if (!getRunForSandboxKey(runId, caller.keyId)) return NextResponse.json({ code: "RUN_NOT_FOUND", error: "运行不存在" }, { status: 404 });
  return NextResponse.json({ run: cancelRun(runId) }, { status: 202 });
}
