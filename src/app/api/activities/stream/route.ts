/**
 * Real-time activity stream via SSE.
 * GET /api/activities/stream
 *
 * Replaces v1's 2s SQLite polling with a Supabase Realtime subscription
 * to `public.activities_v1`. The server subscribes to INSERT events on
 * that table once per connection and forwards each new row to the
 * client through Server-Sent Events. Closing the SSE channel (browser
 * navigate away, tab close, abort signal) tears the Realtime channel
 * down so we don't leak subscriptions on the Supabase side.
 *
 * First-frame: we pull the latest 5 activities so the panel renders
 * immediately instead of waiting for the next INSERT.
 */
import { NextRequest } from "next/server";
import { getActivities } from "@/lib/activities-db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => Promise<void>) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream was closed under us — ignore.
        }
      };

      send({ type: "connected", ts: new Date().toISOString() });

      // Initial backfill so the UI isn't blank on connect.
      try {
        const result = await getActivities({ limit: 5, sort: "newest" });
        if (result.activities.length > 0) {
          send({ type: "batch", activities: result.activities });
        }
      } catch (err) {
        console.error("[activities/stream] initial fetch failed:", err);
      }

      // Realtime subscription. Note: we use the admin client because the
      // panel server is trusted; the SSE response itself is gated by the
      // middleware (Supabase Auth) so the operator's authorization is
      // already verified by the time we get here.
      const supabase = createSupabaseAdminClient();
      const channel = supabase
        .channel(`activities_v1_stream_${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "activities_v1" },
          (payload) => {
            if (closed) return;
            send({ type: "new", activity: payload.new });
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(`[activities/stream] realtime status=${status}`);
          }
        });

      unsubscribe = async () => {
        try {
          await supabase.removeChannel(channel);
        } catch (err) {
          console.error("[activities/stream] removeChannel failed:", err);
        }
      };

      request.signal?.addEventListener("abort", async () => {
        closed = true;
        if (unsubscribe) await unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      });
    },
    async cancel() {
      closed = true;
      if (unsubscribe) await unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
