import { NextResponse } from "next/server";

import { getSandboxModels } from "@/lib/relay-client";
import { sandboxCaller } from "@/lib/sandbox-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await sandboxCaller(request).catch(() => null);
  if (!caller) return NextResponse.json({ code: "SANDBOX_KEY_INVALID", error: "Sandbox key 无效或已撤销" }, { status: 401 });

  const sandboxKey = request.headers.get("authorization")!.slice(7).trim();
  try {
    return NextResponse.json({ models: await getSandboxModels(sandboxKey) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "SANDBOX_KEY_INVALID") return NextResponse.json({ code, error: "Sandbox key 无效或已撤销" }, { status: 401 });
    return NextResponse.json({ code: "RELAY_UNAVAILABLE", error: "Relay 模型目录不可用" }, { status: 503 });
  }
}
