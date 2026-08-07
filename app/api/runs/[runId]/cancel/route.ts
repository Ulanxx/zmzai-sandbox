import { NextResponse } from "next/server";
import { cancelRun, getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!getRun(runId)) return NextResponse.json({ error: "运行不存在" }, { status: 404 });
  return NextResponse.json({ run: cancelRun(runId) });
}

