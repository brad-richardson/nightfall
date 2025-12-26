import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().default("postgresql://nightfall:nightfall@localhost:5432/nightfall?sslmode=disable"),
  APP_VERSION: z.string().default("dev"),
  // Security & Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000), // 1 minute
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100), // 100 requests per window
  SSE_MAX_CLIENTS: z.coerce.number().int().positive().default(1000),
  ADMIN_SECRET: z.string().optional(),
  JWT_SECRET: z.string().default("dev-secret-do-not-use-in-prod"),
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

// For testing: reset cached config
export function resetConfig(): void {
  cachedConfig = null;
}
