import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().default("postgresql://nightfall:nightfall@localhost:5432/nightfall?sslmode=disable"),
  APP_VERSION: z.string().default("dev")
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
