import { getRun } from "@/lib/sandbox-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!getRun(runId)) return new Response("运行不存在", { status: 404 });

  const encoder = new TextEncoder();
  let lastEventCount = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      timer = setInterval(() => {
        const run = getRun(runId);
        if (!run) {
          controller.close();
          if (timer) clearInterval(timer);
          return;
        }
        if (run.events.length > lastEventCount) {
          const events = run.events.slice(lastEventCount);
          lastEventCount = run.events.length;
          for (const item of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ run })}\n\n`));
        }
        if (["succeeded", "failed", "cancelled"].includes(run.status)) {
          controller.close();
          if (timer) clearInterval(timer);
        }
      }, 400);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}

