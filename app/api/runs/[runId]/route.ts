import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/relay-client";
import { getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser(_).catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { runId } = await params;
  const run = getRun(runId, user.id);
  if (!run) return NextResponse.json({ error: "运行不存在" }, { status: 404 });
  return NextResponse.json({ run });
}
