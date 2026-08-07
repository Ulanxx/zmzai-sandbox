import { NextResponse } from "next/server";

import { getSessionUser, relayRequest } from "@/lib/relay-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!(await getSessionUser(request))) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const response = await relayRequest(request, "/models");
    const body = await response.json().catch(() => ({ error: "模型目录返回无效" }));
    if (!response.ok) return NextResponse.json(body, { status: response.status });
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "模型目录不可用" }, { status: 503 });
  }
}
