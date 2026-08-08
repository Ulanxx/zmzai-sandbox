import { NextResponse } from "next/server";

import { getSessionUser, relaySessionRequest } from "@/lib/relay-client";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(request))) return NextResponse.json({ code: "UNAUTHENTICATED", error: "请先登录" }, { status: 401 });
  const { id } = await params;
  const response = await relaySessionRequest(request, `/api/me/sandbox-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
