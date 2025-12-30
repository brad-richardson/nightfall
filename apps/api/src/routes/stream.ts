/**
 * SSE streaming routes
 */

import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./types";
import { writeSseEvent } from "../utils/helpers";

// Heartbeat interval for SSE clients (15 seconds)
// This is shorter than the client's stale threshold to ensure timely detection
const SSE_HEARTBEAT_INTERVAL_MS = 15000;

export function registerStreamRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { config, eventStream, corsOrigin, getSseClients, setSseClients } = ctx;

  app.get("/api/stream", async (request, reply) => {
    if (getSseClients() >= config.SSE_MAX_CLIENTS) {
      reply.status(503).send({ ok: false, error: "too_many_connections" });
      return;
    }

    const once = request.headers["x-sse-once"] === "1";

    // Support reconnection with Last-Event-ID for replay of missed events
    const lastEventId = request.headers["last-event-id"] as string | undefined;

    // Manually set CORS headers for SSE (hijacked responses bypass @fastify/cors)
    const origin = request.headers.origin;
    if (origin) {
      const isAllowed = corsOrigin === true || corsOrigin.includes(origin);
      if (isAllowed) {
        reply.raw.setHeader("Access-Control-Allow-Origin", origin);
        reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-store");
    reply.raw.setHeader("Pragma", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();
    reply.hijack();

    setSseClients(getSseClients() + 1);
    let unsubscribe = () => {};
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      unsubscribe();
      setSseClients(getSseClients() - 1);
    };

    request.raw.on("close", cleanup);

    try {
      await eventStream.start?.();

      // Replay missed events if client reconnected with Last-Event-ID
      if (lastEventId && eventStream.replayEvents) {
        app.log.info({ lastEventId }, "Replaying missed events for reconnecting client");
        await eventStream.replayEvents(lastEventId, (payload) => {
          const seqId = (payload.data as Record<string, unknown>)?.seq_id as string | undefined;
          writeSseEvent(reply.raw, payload.event, payload.data, seqId);
        });
      }

      // Send heartbeat events to detect dead connections on both desktop and mobile
      // SSE comments (: prefix) are ignored by EventSource but keep the connection alive
      // We also send a proper event so the client can track activity
      heartbeatInterval = setInterval(() => {
        try {
          // SSE comment for keep-alive (doesn't trigger client event handler)
          reply.raw.write(":heartbeat\n\n");
          // Also send a proper heartbeat event the client can track
          writeSseEvent(reply.raw, "heartbeat", { ts: Date.now() });
        } catch {
          // Connection is dead, cleanup will be triggered by 'close' event
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);

      unsubscribe = eventStream.subscribe((payload) => {
        // Debug logging for rust_bulk
        if ((payload.data as Record<string, unknown>)?.type === "rust_bulk") {
          app.log.info({ event: payload.event, data: payload.data }, "[SSE] Writing rust_bulk to client");
        }
        // Include seq_id in SSE message for client tracking
        const seqId = (payload.data as Record<string, unknown>)?.seq_id as string | undefined;
        writeSseEvent(reply.raw, payload.event, payload.data, seqId);
        if (once) {
          reply.raw.end();
        }
      });
    } catch (error) {
      app.log.error({ err: error }, "event stream unavailable");
      reply.raw.writeHead(503, { "Content-Type": "application/json" });
      reply.raw.end(JSON.stringify({ ok: false, error: "event_stream_unavailable" }));
      cleanup();
      return;
    }
  });
}
