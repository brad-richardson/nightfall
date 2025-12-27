import type { PoolLike } from "./ticker";

export type DemoConfig = {
  enabled: boolean;
  tick_multiplier: number;
  cycle_speed: number;
};

// Default demo config for local development
const DEV_DEFAULTS: DemoConfig = {
  enabled: true,
  tick_multiplier: 5,
  cycle_speed: 5
};

export async function getDemoConfig(client: PoolLike): Promise<DemoConfig> {
  const result = await client.query<{
    value: {
      enabled?: boolean;
      tick_multiplier?: number;
      cycle_speed?: number;
    }
  }>(
    "SELECT value FROM world_meta WHERE key = 'demo_mode'"
  );

  const raw = result.rows[0]?.value;

  // If no config in DB and we're in dev, use dev defaults
  if (!raw && process.env.NODE_ENV !== 'production') {
    return DEV_DEFAULTS;
  }

  return {
    enabled: !!raw?.enabled,
    tick_multiplier: Number(raw?.tick_multiplier || 1),
    cycle_speed: Number(raw?.cycle_speed || 1)
  };
}
