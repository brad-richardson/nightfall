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
  "crew_delta",
  "building_activation",
  "building_boost",
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
  let isReconnecting = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;

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
    // Guard against concurrent reconnection attempts
    if (isReconnecting) {
      return;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error("max reconnection attempts reached, giving up");
      isReconnecting = false;
      return;
    }

    isReconnecting = true;
    logger.error({ attempt: reconnectAttempts + 1 }, "attempting to reconnect event stream");
    await cleanup();

    // Implement exponential backoff: 2^n * 1000ms, capped at 30 seconds
    const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, 30000);
    reconnectAttempts++;

    reconnectTimeout = setTimeout(async () => {
      try {
        await start();
        reconnectAttempts = 0; // Reset on successful reconnection
        isReconnecting = false;
      } catch (error) {
        logger.error({ err: error, attempt: reconnectAttempts }, "failed to reconnect event stream");
        isReconnecting = false;
        // Try again with next exponential backoff
        reconnect();
      }
    }, delay);
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
          // Log rust_bulk notifications for debugging
          if ((data as Record<string, unknown>)?.type === "rust_bulk") {
            logger.error({ channel, data }, "[EventStream] Received rust_bulk notification");
          }
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
      if (client && !isReconnecting) {
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
