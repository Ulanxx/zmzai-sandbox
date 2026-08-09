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
  const lastEventId = Number.parseInt(request.headers.get("last-event-id") ?? "0", 10);
  const initialCursor = Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : 0;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        let sent = initialCursor;
        let lastHeartbeat = Date.now();
        while (!closed) {
          const run = getRunForSandboxKey(runId, caller.keyId) ?? await persistedRun(runId, caller.keyId).catch(() => undefined);
          if (!run) break;
          for (const event of run.events.filter((item) => item.sequence > sent).sort((a, b) => a.sequence - b.sequence)) {
            sent = event.sequence;
            controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify({ id: event.id, sequence: event.sequence, runId, type: event.kind, at: event.at, data: { text: event.message }, status: run.status })}\n\n`));
          }
          if (["succeeded", "failed", "cancelled"].includes(run.status)) break;
          if (Date.now() - lastHeartbeat >= 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastHeartbeat = Date.now();
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (!closed) controller.close();
      })();
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream" } });
}
