import { buildServer } from "./server";

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || "0.0.0.0";

async function start() {
  const app = buildServer();

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
