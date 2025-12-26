import type { Logger } from "./ticker";

type PoolWithErrorEvent = {
  on: (event: "error", handler: (err: Error) => void) => void;
};

export function attachPoolErrorHandler(pool: PoolWithErrorEvent, logger: Logger) {
  pool.on("error", (err) => {
    logger.error({ err }, "[ticker] pool error");
  });
}
