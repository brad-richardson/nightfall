import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import type { Phase } from "./utils/phase";

export type PhaseChangePayload = {
  phase: Phase;
  next_phase: Phase;
  next_phase_in_seconds: number;
};

export type PhaseStream = {
  subscribe: (handler: (payload: PhaseChangePayload) => void) => () => void;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
};

type Logger = {
  error: (...args: unknown[]) => void;
};

export function createDbPhaseStream(pool: Pool, logger: Logger): PhaseStream {
  const emitter = new EventEmitter();
  let client: PoolClient | null = null;
  let listening = false;

  async function start() {
    if (listening) {
      return;
    }
    listening = true;
    client = await pool.connect();

    client.on("notification", (message) => {
      if (message.channel !== "phase_change" || !message.payload) {
        return;
      }
      try {
        const payload = JSON.parse(message.payload) as PhaseChangePayload;
        emitter.emit("phase_change", payload);
      } catch (error) {
        logger.error({ err: error }, "invalid phase_change payload");
      }
    });

    client.on("error", (error) => {
      logger.error({ err: error }, "phase stream db error");
    });

    await client.query("LISTEN phase_change");
  }

  async function stop() {
    if (!client) {
      listening = false;
      return;
    }

    try {
      await client.query("UNLISTEN phase_change");
    } finally {
      client.release();
      client = null;
      listening = false;
    }
  }

  function subscribe(handler: (payload: PhaseChangePayload) => void) {
    emitter.on("phase_change", handler);
    return () => emitter.off("phase_change", handler);
  }

  return {
    subscribe,
    start,
    stop
  };
}
