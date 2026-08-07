import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/relay-client";
import { cancelRun, getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { runId } = await params;
  if (!getRun(runId, user.id)) return NextResponse.json({ error: "运行不存在" }, { status: 404 });
  return NextResponse.json({ run: cancelRun(runId) });
}
