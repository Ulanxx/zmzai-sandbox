import { sandboxCaller } from "@/lib/sandbox-api";
import { getRunForSandboxKey } from "@/lib/sandbox-store";
import { persistedRun } from "@/lib/persistent-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const caller = await sandboxCaller(request).catch(() => null);
  if (!caller) return new Response(JSON.stringify({ code: "SANDBOX_KEY_INVALID", error: "Sandbox key 无效或已撤销" }), { status: 401 });
  const { runId } = await params;
  if (!(getRunForSandboxKey(runId, caller.keyId) ?? await persistedRun(runId, caller.keyId).catch(() => undefined))) return new Response(JSON.stringify({ code: "RUN_NOT_FOUND", error: "运行不存在" }), { status: 404 });
  const encoder = new TextEncoder();
  let sent = 0;
  let sequence = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      timer = setInterval(() => {
        const run = getRunForSandboxKey(runId, caller.keyId);
        if (!run) { controller.close(); if (timer) clearInterval(timer); return; }
        for (const event of run.events.slice(sent)) {
          sent += 1; sequence += 1;
          controller.enqueue(encoder.encode(`id: ${sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify({ id: event.id, sequence, runId, type: event.kind, at: event.at, data: { text: event.message }, status: run.status })}\n\n`));
        }
        if (["succeeded", "failed", "cancelled"].includes(run.status)) { controller.close(); if (timer) clearInterval(timer); }
      }, 400);
    },
    cancel() { if (timer) clearInterval(timer); },
  });
  return new Response(stream, { headers: { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream" } });
}
