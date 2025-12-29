/**
 * Fastify API server for Nightfall
 */

import type { FastifyInstance, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { getConfig } from "./config";
import { closePool, getPool } from "./db";
import { createDbEventStream } from "./event-stream";
import type { EventStream } from "./event-stream";
import { parseAllowedOrigins } from "./utils/helpers";

// Route registrars
import {
  registerHealthRoutes,
  registerStreamRoutes,
  registerPlayerRoutes,
  registerWorldRoutes,
  registerContributeRoutes,
  registerVoteRoutes,
  registerMinigameRoutes,
  registerRepairMinigameRoutes,
  registerBuildingRoutes,
  registerAdminRoutes,
  type RouteContext
} from "./routes";

// Re-export test helpers from services
export { resetOvertureCacheForTests } from "./services/overture";
export { resetFocusHexCacheForTests } from "./services/graph";

type ServerOptions = {
  eventStream?: EventStream;
  logger?: FastifyServerOptions["logger"];
};

function resolveLogger(optionsLogger?: FastifyServerOptions["logger"]) {
  if (optionsLogger !== undefined) {
    return optionsLogger;
  }

  if (process.env.NODE_ENV === "test") {
    return { level: "silent" };
  }

  return true;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: resolveLogger(options.logger) });
  const config = getConfig();
  let sseClients = 0;

  // Warn if admin secret is not configured (admin endpoints will return 401)
  if (!config.ADMIN_SECRET) {
    app.log.warn('ADMIN_SECRET not configured - all admin endpoints will return 401 Unauthorized');
  }

  // CORS: Use allowlist in production, allow all in development
  const corsOrigin = parseAllowedOrigins(config.ALLOWED_ORIGINS);
  app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });
  app.register(helmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    contentSecurityPolicy: false, // Disable CSP for API
  });
  app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
  });

  const eventStream = options.eventStream ?? createDbEventStream(getPool(), app.log);

  // Route context shared across route modules
  const routeContext: RouteContext = {
    config,
    eventStream,
    corsOrigin,
    getSseClients: () => sseClients,
    setSseClients: (count: number) => { sseClients = count; }
  };

  // Add cache control headers for API routes
  app.addHook("onSend", (request, reply, payload, done) => {
    const url = request.raw.url ?? "";
    if (url.startsWith("/api/") && !url.startsWith("/api/stream")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    done(null, payload);
  });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const message = error instanceof Error ? error.message : String(error);
    reply.status(500).send({ ok: false, error: "internal_error", message });
  });

  // Register all route modules
  registerHealthRoutes(app);
  registerStreamRoutes(app, routeContext);
  registerPlayerRoutes(app);
  registerWorldRoutes(app);
  registerContributeRoutes(app, routeContext);
  registerVoteRoutes(app);
  registerMinigameRoutes(app);
  registerRepairMinigameRoutes(app);
  registerBuildingRoutes(app);
  registerAdminRoutes(app, routeContext);

  // Cleanup on close
  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
