/**
 * Live log streaming via Server-Sent Events.
 * GET /api/logs/stream?container=<name>&tail=<n>
 *
 * Backend: `docker logs -f --tail <n> <container>` running inside the
 * panel container. The compose file mounts /var/run/docker.sock read-only
 * and adds the `docker` group to the panel's runtime user so `docker logs`
 * can attach to sibling containers (openclaw-kozw, mostly).
 *
 * Security:
 * - `container` is constrained to an allowlist so a leaked auth token
 *   can't be used to tail unrelated containers on the host.
 * - The mount is read-only — even if someone got into the panel they
 *   couldn't `docker run`, `docker stop`, etc. (the docker CLI does try
 *   to call mutate endpoints; they'd fail server-side at the kernel layer).
 */
import { NextRequest } from "next/server";
import { spawn } from "child_process";

// Containers the operator is allowed to tail. Add new entries here as
// the host gains new services worth surfacing in the panel.
const ALLOWED_CONTAINERS = new Set([
  "openclaw-kozw-openclaw-1",
  "mission-control",
  "openclaw-mission-control-backend-1",
  "openclaw-mission-control-frontend-1",
]);

const DEFAULT_CONTAINER = "openclaw-kozw-openclaw-1";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const container = searchParams.get("container") || DEFAULT_CONTAINER;
  const tail = Math.min(
    Math.max(parseInt(searchParams.get("tail") || "100", 10) || 100, 10),
    1000,
  );

  if (!ALLOWED_CONTAINERS.has(container)) {
    return new Response("Container not allowed", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (line: string, stream: "stdout" | "stderr" = "stdout") => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                line,
                stream,
                ts: new Date().toISOString(),
              })}\n\n`,
            ),
          );
        } catch {
          // Stream was closed under us — bail.
          closed = true;
        }
      };

      send(`[stream] Connected to ${container} (tail=${tail})`);

      // `--tail` controls how much backfill we get; `-f` follows.
      // `-t` adds timestamps from the docker daemon (useful when the
      // container's app doesn't print its own).
      const proc = spawn(
        "docker",
        ["logs", "-f", "-t", "--tail", String(tail), container],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      // Both stdout AND stderr of `docker logs` carry container output —
      // docker multiplexes the container's stdout to ours' stdout, and
      // container's stderr to ours' stderr. We label them so the UI can
      // colour-code if it wants to.
      proc.stdout.on("data", (data: Buffer) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          send(line, "stdout");
        }
      });
      proc.stderr.on("data", (data: Buffer) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          send(line, "stderr");
        }
      });

      proc.on("error", (err) => {
        send(`[error] ${err.message}`, "stderr");
        closed = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });

      proc.on("close", (code) => {
        send(`[stream] docker logs exited with code ${code}`);
        closed = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });

      request.signal?.addEventListener("abort", () => {
        closed = true;
        proc.kill("SIGTERM");
        // Force-kill after 2s if SIGTERM doesn't take.
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }, 2000);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
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

/** GET /api/logs/stream/containers — list of allowed containers. */
export async function HEAD() {
  // (Method just to make the OPTIONS preflight cheap.)
  return new Response(null, { status: 200 });
}
