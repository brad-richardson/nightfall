import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";

export type EventPayload = {
  event: string;
  data: unknown;
};

export type EventStream = {
  subscribe: (handler: (payload: EventPayload) => void) => () => void;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
};

type Logger = {
  error: (...args: unknown[]) => void;
};

const DEFAULT_CHANNELS = [
  "phase_change",
  "world_delta",
  "feature_delta",
  "task_delta",
  "feed_item",
  "reset_warning",
  "reset"
];

export function createDbEventStream(
  pool: Pool,
  logger: Logger,
  channels: string[] = DEFAULT_CHANNELS
): EventStream {
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
      const channel = message.channel;
      if (!channels.includes(channel)) {
        return;
      }

      let data: unknown = {};
      if (message.payload) {
        try {
          data = JSON.parse(message.payload);
        } catch (error) {
          logger.error({ err: error }, "invalid event payload");
          data = {};
        }
      }

      emitter.emit("event", { event: channel, data });
    });

    client.on("error", (error) => {
      logger.error({ err: error }, "event stream db error");
    });

    for (const channel of channels) {
      await client.query(`LISTEN ${channel}`);
    }
  }

  async function stop() {
    if (!client) {
      listening = false;
      return;
    }

    try {
      for (const channel of channels) {
        await client.query(`UNLISTEN ${channel}`);
      }
    } finally {
      client.release();
      client = null;
      listening = false;
    }
  }

  function subscribe(handler: (payload: EventPayload) => void) {
    emitter.on("event", handler);
    return () => emitter.off("event", handler);
  }

  return {
    subscribe,
    start,
    stop
  };
}
