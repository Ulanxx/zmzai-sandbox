import { agentCaller } from "@/lib/agent-auth";
import { persistedRun } from "@/lib/persistent-runs";
import { getRun } from "@/lib/sandbox-store";
import type { RunEvent } from "@/lib/sandbox-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminalStates = new Set(["succeeded", "failed", "cancelled"]);

function encodeEvent(sequence: number, event: RunEvent, runId: string): Uint8Array {
  const payload = event.data !== undefined && event.data !== null && typeof event.data === "object"
    ? { text: event.message, ...event.data as Record<string, unknown> }
    : { text: event.message };
  return new TextEncoder().encode(`id: ${sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify({ id: event.id, runId, sequence, type: event.kind, at: event.at, data: payload })}\n\n`);
}

async function resolveRun(runId: string) {
  return getRun(runId) ?? await persistedRun(runId);
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!agentCaller(request)) return new Response(null, { status: 401 });
  const { runId } = await context.params;
  const initial = await resolveRun(runId);
  if (!initial) return Response.json({ code: "RUN_NOT_FOUND", error: "Sandbox 运行不存在" }, { status: 404 });

  const encoder = new TextEncoder();
  let lastSequence = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      async function flush(): Promise<void> {
        const run = await resolveRun(runId);
        if (!run || closed) return;
        while (lastSequence < run.events.length) {
          lastSequence += 1;
          try {
            controller.enqueue(encodeEvent(lastSequence, run.events[lastSequence - 1], runId));
          } catch {
            closed = true;
            return;
          }
        }
        if (terminalStates.has(run.status)) close();
      }
      try {
        await flush();
        if (!closed) {
          timer = setInterval(() => { void flush().catch((error: unknown) => controller.error(error)); }, 400);
          try { controller.enqueue(encoder.encode(": connected\n\n")); } catch { close(); }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "cache-control": "no-cache, no-transform", connection: "keep-alive", "content-type": "text/event-stream" } });
}
