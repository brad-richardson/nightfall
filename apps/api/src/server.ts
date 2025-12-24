import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    return { ok: true };
  });

  return app;
}
