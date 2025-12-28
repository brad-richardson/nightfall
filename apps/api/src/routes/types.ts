/**
 * Shared types for route modules
 */

import type { FastifyInstance } from "fastify";
import type { EventStream } from "../event-stream";
import type { getConfig } from "../config";

export interface RouteContext {
  config: ReturnType<typeof getConfig>;
  eventStream: EventStream;
  corsOrigin: string[] | true;
  getSseClients: () => number;
  setSseClients: (count: number) => void;
}

export type RouteRegistrar = (app: FastifyInstance, ctx: RouteContext) => void;
