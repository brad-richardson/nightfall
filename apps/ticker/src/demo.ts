import type { PoolLike } from "./ticker";

export type DemoConfig = {
  enabled: boolean;
  tick_multiplier: number;
  cycle_speed: number;
};

export async function getDemoConfig(client: PoolLike): Promise<DemoConfig> {
  const result = await client.query<{ value: any }>(
    "SELECT value FROM world_meta WHERE key = 'demo_mode'"
  );

  const raw = result.rows[0]?.value || {};
  
  return {
    enabled: !!raw.enabled,
    tick_multiplier: Number(raw.tick_multiplier || 1),
    cycle_speed: Number(raw.cycle_speed || 1)
  };
}
