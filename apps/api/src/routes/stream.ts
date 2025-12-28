/**
 * SSE streaming routes
 */

import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./types";
import { writeSseEvent } from "../utils/helpers";

export function registerStreamRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { config, eventStream, corsOrigin, getSseClients, setSseClients } = ctx;

  app.get("/api/stream", async (request, reply) => {
    if (getSseClients() >= config.SSE_MAX_CLIENTS) {
      reply.status(503).send({ ok: false, error: "too_many_connections" });
      return;
    }

    const once = request.headers["x-sse-once"] === "1";

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

    const cleanup = () => {
      unsubscribe();
      setSseClients(getSseClients() - 1);
    };

    request.raw.on("close", cleanup);

    try {
      await eventStream.start?.();
      unsubscribe = eventStream.subscribe((payload) => {
        writeSseEvent(reply.raw, payload.event, payload.data);
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
