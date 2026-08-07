import { NextResponse } from "next/server";

import { getSessionUser, loginUrl } from "@/lib/relay-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ user: null, loginUrl: loginUrl() }, { status: 401 });
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "认证服务不可用" }, { status: 503 });
  }
}
