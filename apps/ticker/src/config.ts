import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  TICK_LOCK_ID: z.coerce.number().int().positive().default(424242)
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
