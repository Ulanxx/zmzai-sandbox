import { NextResponse } from "next/server";

import { getSessionUser, relaySessionRequest } from "@/lib/relay-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getSessionUser(request))) return NextResponse.json({ code: "UNAUTHENTICATED", error: "请先登录" }, { status: 401 });
  const response = await relaySessionRequest(request, "/api/me/sandbox-keys");
  return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await getSessionUser(request))) return NextResponse.json({ code: "UNAUTHENTICATED", error: "请先登录" }, { status: 401 });
  const response = await relaySessionRequest(request, "/api/me/sandbox-keys", { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() });
  return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
