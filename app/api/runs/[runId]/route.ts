import { NextResponse } from "next/server";
import { getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return NextResponse.json({ error: "运行不存在" }, { status: 404 });
  return NextResponse.json({ run });
}

