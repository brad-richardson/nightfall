import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { getConfig } from "./config";
import { buildServer } from "./server";

async function start() {
  const config = getConfig();
  const app = buildServer();

  try {
    console.log(`[startup] Attempting to listen on ${config.HOST}:${config.PORT}`);
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`[startup] Successfully listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

start();
