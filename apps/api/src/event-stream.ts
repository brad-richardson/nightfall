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
  "resource_transfer",
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
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  async function cleanup() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (client) {
      try {
        client.removeAllListeners();
        client.release();
      } catch (error) {
        logger.error({ err: error }, "error releasing client during cleanup");
      }
      client = null;
    }
    listening = false;
  }

  async function reconnect() {
    logger.error("attempting to reconnect event stream");
    await cleanup();

    // Use exponential backoff for reconnection
    reconnectTimeout = setTimeout(async () => {
      try {
        await start();
      } catch (error) {
        logger.error({ err: error }, "failed to reconnect event stream");
        // Try again after delay
        reconnect();
      }
    }, 5000);
  }

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
      logger.error({ err: error }, "event stream db error - triggering reconnect");
      reconnect();
    });

    client.on("end", () => {
      logger.error("event stream db connection ended - triggering reconnect");
      reconnect();
    });

    for (const channel of channels) {
      await client.query(`LISTEN ${channel}`);
    }

    // Set up heartbeat to detect stale connections
    heartbeatInterval = setInterval(async () => {
      if (client) {
        try {
          await client.query("SELECT 1");
        } catch (error) {
          logger.error({ err: error }, "heartbeat failed - triggering reconnect");
          reconnect();
        }
      }
    }, 30000); // Heartbeat every 30 seconds
  }

  async function stop() {
    if (!client) {
      await cleanup();
      return;
    }

    try {
      for (const channel of channels) {
        await client.query(`UNLISTEN ${channel}`);
      }
    } catch (error) {
      logger.error({ err: error }, "error unlistening from channels");
    } finally {
      await cleanup();
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
