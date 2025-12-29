import type { PoolLike } from "./ticker";
import type { PhaseName } from "./cycle";
import { notifyEvent } from "./notify";

/**
 * The Lamplighter - A mysterious guardian who walks the streets at night,
 * occasionally activating buildings to generate resources.
 *
 * "The nights are getting longer."
 *
 * This bot makes the world feel alive by activating a building on average
 * once every ~25 seconds, creating subtle signs of life without overwhelming activity.
 */

export type RegionState = {
  region_id: string;
  name: string;
  pool_food: number;
  pool_equipment: number;
  pool_energy: number;
  pool_materials: number;
  rust_avg: number;
  health_avg: number;
};

// Contribution messages from various "workers"
const WORKER_CONTRIBUTIONS = [
  "Local workers contribute to {region}.",
  "Salvage team deposits materials in {region}.",
  "Supply run complete. Resources delivered to {region}.",
  "Community stockpile grows in {region}.",
  "Volunteer crew donates supplies to {region}.",
  "Overnight collection adds to {region}'s reserves.",
];

// Lamplighter-specific contributions
const LAMPLIGHTER_CONTRIBUTIONS = [
  "The Lamplighter leaves supplies at the {region} depot. Use them well.",
  "I gathered what I could on my rounds. {region} needs it more than I.",
  "From my travels: provisions for {region}. The night is long.",
  "A small contribution to {region}. Every lantern helps against the dark.",
];

/**
 * Pick a random element from an array.
 * @throws Error if array is empty
 */
export function pickRandom<T>(arr: T[]): T {
  if (arr.length === 0) {
    throw new Error("pickRandom called with empty array");
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

export function formatMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export type LamplighterResult = {
  observations: number;
  contributions: number;
  votes: number;
  warnings: number;
  regionActivities: number;
};

/**
 * The Lamplighter makes the world feel alive by occasionally activating buildings.
 * With a 20% chance per ~5 second tick, averages about once every 25 seconds.
 */
export async function runLamplighter(
  client: PoolLike,
  enabled: boolean,
  phase: PhaseName
): Promise<LamplighterResult> {
  const result: LamplighterResult = {
    observations: 0,
    contributions: 0,
    votes: 0,
    warnings: 0,
    regionActivities: 0,
  };

  if (!enabled) return result;

  // With ~5 second tick intervals, a 20% chance averages once every 25 seconds.
  if (Math.random() > 0.20) {
    return result;
  }

  // Pick a random region to activate a building in
  const regionStates = await fetchRegionStates(client);
  if (regionStates.length === 0) return result;

  const region = pickRandom(regionStates);
  const contributed = await contributeToRegion(client, region, phase);
  if (contributed) {
    result.contributions++;
  }

  return result;
}

export async function fetchRegionStates(client: PoolLike): Promise<RegionState[]> {
  const result = await client.query<RegionState>(`
    SELECT
      r.region_id,
      r.name,
      r.pool_food::float AS pool_food,
      r.pool_equipment::float AS pool_equipment,
      r.pool_energy::float AS pool_energy,
      r.pool_materials::float AS pool_materials,
      COALESCE((SELECT AVG(rust_level)::float FROM hex_cells WHERE region_id = r.region_id), 0) AS rust_avg,
      COALESCE((
        SELECT AVG(fs.health)::float
        FROM world_features AS wf
        JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
        WHERE wf.region_id = r.region_id AND wf.feature_type = 'road'
      ), 100) AS health_avg
    FROM regions AS r
  `);
  return result.rows;
}

/**
 * Activates a building in a region so it generates resources via the standard
 * resource transfer system. This reuses the same mechanism players use when
 * contributing, ensuring consistent behavior and proper convoy animations.
 *
 * Returns true if a building was activated, false otherwise.
 */
async function contributeToRegion(
  client: PoolLike,
  region: RegionState,
  phase: PhaseName
): Promise<boolean> {
  // Find a random building in this region that generates resources and isn't already activated.
  const buildingResult = await client.query<{
    gers_id: string;
    name: string | null;
    generates_food: boolean;
    generates_equipment: boolean;
    generates_energy: boolean;
    generates_materials: boolean;
  }>(
    `SELECT
      wf.gers_id,
      wf.name,
      COALESCE(wf.generates_food, false) AS generates_food,
      COALESCE(wf.generates_equipment, false) AS generates_equipment,
      COALESCE(wf.generates_energy, false) AS generates_energy,
      COALESCE(wf.generates_materials, false) AS generates_materials
    FROM world_features AS wf
    LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
    WHERE wf.region_id = $1
      AND wf.feature_type = 'building'
      AND (
        wf.generates_food = true OR
        wf.generates_equipment = true OR
        wf.generates_energy = true OR
        wf.generates_materials = true
      )
      AND (fs.last_activated_at IS NULL OR fs.last_activated_at < now() - interval '2 minutes')
    ORDER BY random()
    LIMIT 1`,
    [region.region_id]
  );

  if (buildingResult.rows.length === 0) {
    return false;
  }

  // Activate the building - this will trigger resource generation in the next tick
  const buildingIds = buildingResult.rows.map(b => b.gers_id);
  await client.query(
    `INSERT INTO feature_state (gers_id, last_activated_at)
     SELECT unnest($1::text[]), now()
     ON CONFLICT (gers_id) DO UPDATE SET last_activated_at = now()`,
    [buildingIds]
  );

  // Collect resource types for the activity message
  const resourceTypes: string[] = [];
  for (const building of buildingResult.rows) {
    if (building.generates_food) resourceTypes.push("food");
    if (building.generates_equipment) resourceTypes.push("equipment");
    if (building.generates_energy) resourceTypes.push("energy");
    if (building.generates_materials) resourceTypes.push("materials");
  }
  const uniqueResources = [...new Set(resourceTypes)];

  // Sometimes it's the Lamplighter, sometimes it's workers
  const isLamplighter = phase === "night" || Math.random() < 0.2;
  const templates = isLamplighter ? LAMPLIGHTER_CONTRIBUTIONS : WORKER_CONTRIBUTIONS;
  const template = pickRandom(templates);
  const message = formatMessage(template, { region: region.name || "this district" });

  await notifyEvent(client, "feed_item", {
    event_type: isLamplighter ? "lamplighter_contribute" : "contribute",
    region_id: region.region_id,
    message: isLamplighter ? `🏮 ${message}` : message,
    resources: uniqueResources,
    buildings_activated: buildingResult.rows.length,
    ts: new Date().toISOString(),
  });

  return true;
}
