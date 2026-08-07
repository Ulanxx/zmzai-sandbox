import { NextResponse } from "next/server";
import { checkOpenSandbox } from "@/lib/opensandbox-provider";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.OPEN_SANDBOX_URL) {
    return NextResponse.json({ provider: "demo", configured: false, healthy: true });
  }

  try {
    const health = await checkOpenSandbox();
    return NextResponse.json({ provider: "opensandbox", configured: true, healthy: health.ok, baseUrl: health.baseUrl });
  } catch (error) {
    return NextResponse.json({ provider: "opensandbox", configured: true, healthy: false, error: error instanceof Error ? error.message : "OpenSandbox 健康检查失败" }, { status: 503 });
  }
}

