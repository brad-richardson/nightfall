import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";
import { logger } from "./logger";

export type ResourceTransfer = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: "food" | "equipment" | "energy" | "materials";
  amount: number;
  depart_at: string;
  arrive_at: string;
};

type ArrivalResult = {
  regionIds: string[];
};

const RESOURCE_TRAVEL_MPS = Math.max(0.1, Number(process.env.RESOURCE_TRAVEL_MPS ?? 8) || 8);
const RESOURCE_DISTANCE_MULTIPLIER = Math.max(0.1, Number(process.env.RESOURCE_DISTANCE_MULTIPLIER ?? 1.25) || 1.25);
const RESOURCE_TRAVEL_MIN_S = Math.max(1, Number(process.env.RESOURCE_TRAVEL_MIN_S ?? 4) || 4);
const RESOURCE_TRAVEL_MAX_S = Math.max(RESOURCE_TRAVEL_MIN_S, Number(process.env.RESOURCE_TRAVEL_MAX_S ?? 45) || 45);
const RESOURCE_TABLE_CHECK_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.RESOURCE_TABLE_CHECK_INTERVAL_MS ?? 60_000) || 60_000
);

let resourceTransfersTableReady: boolean | null = null;
let lastResourceTransfersCheckMs = 0;
let loggedMissingResourceTransfers = false;

async function ensureResourceTransfersTable(pool: PoolLike): Promise<boolean> {
  const now = Date.now();
  if (resourceTransfersTableReady === true) {
    return true;
  }
  if (
    resourceTransfersTableReady === false &&
    now - lastResourceTransfersCheckMs < RESOURCE_TABLE_CHECK_INTERVAL_MS
  ) {
    return false;
  }

  lastResourceTransfersCheckMs = now;

  try {
    const result = await pool.query<{ exists: string | null }>(
      "SELECT to_regclass('public.resource_transfers') AS exists"
    );
    const exists = Boolean(result.rows[0]?.exists);
    resourceTransfersTableReady = exists;

    if (!exists && !loggedMissingResourceTransfers) {
      loggedMissingResourceTransfers = true;
      logger.error("[ticker] missing resource_transfers table; run `pnpm db:up`");
    }

    return exists;
  } catch (error) {
    resourceTransfersTableReady = false;
    if (!loggedMissingResourceTransfers) {
      loggedMissingResourceTransfers = true;
      logger.error({ err: error }, "[ticker] failed checking resource_transfers table");
    }
    return false;
  }
}

export function resetResourceTransferCacheForTests() {
  resourceTransfersTableReady = null;
  lastResourceTransfersCheckMs = 0;
  loggedMissingResourceTransfers = false;
}

export async function enqueueResourceTransfers(
  pool: PoolLike,
  multipliers: PhaseMultipliers
): Promise<ResourceTransfer[]> {
  if (!(await ensureResourceTransfersTable(pool))) {
    return [];
  }

  const result = await pool.query<ResourceTransfer>(
    `
    WITH feature_rust AS (
      SELECT
        wf.gers_id,
        wf.region_id,
        wf.h3_index,
        wf.generates_food,
        wf.generates_equipment,
        wf.generates_energy,
        wf.generates_materials,
        AVG(h.rust_level) AS rust_level
      FROM world_features AS wf
      JOIN world_feature_hex_cells AS wfhc ON wfhc.gers_id = wf.gers_id
      JOIN hex_cells AS h ON h.h3_index = wfhc.h3_index
      WHERE wf.feature_type = 'building'
      GROUP BY wf.gers_id, wf.region_id, wf.h3_index, wf.generates_food, wf.generates_equipment, wf.generates_energy, wf.generates_materials
    ),
    building_outputs AS (
      SELECT
        fr.gers_id AS source_gers_id,
        fr.region_id,
        fr.h3_index,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_food THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS food_amount,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_equipment THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS equipment_amount,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_energy THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS energy_amount,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_materials THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS materials_amount
      FROM feature_rust AS fr
    ),
    hub_lookup AS (
      SELECT
        h.h3_index,
        h.hub_building_gers_id,
        (hub.bbox_xmin + hub.bbox_xmax) / 2 AS hub_lon,
        (hub.bbox_ymin + hub.bbox_ymax) / 2 AS hub_lat
      FROM hex_cells AS h
      JOIN world_features AS hub ON hub.gers_id = h.hub_building_gers_id
    ),
    source_points AS (
      SELECT
        bo.source_gers_id,
        bo.region_id,
        bo.food_amount,
        bo.equipment_amount,
        bo.energy_amount,
        bo.materials_amount,
        hub_lookup.hub_building_gers_id,
        (wf.bbox_xmin + wf.bbox_xmax) / 2 AS source_lon,
        (wf.bbox_ymin + wf.bbox_ymax) / 2 AS source_lat,
        hub_lookup.hub_lon,
        hub_lookup.hub_lat
      FROM building_outputs AS bo
      JOIN world_features AS wf ON wf.gers_id = bo.source_gers_id
      JOIN hub_lookup ON hub_lookup.h3_index = bo.h3_index
    ),
    travel_times AS (
      SELECT
        source_gers_id,
        region_id,
        hub_building_gers_id,
        food_amount,
        equipment_amount,
        energy_amount,
        materials_amount,
        GREATEST(
          $3,
          LEAST(
            $4,
            (ST_DistanceSphere(
              ST_MakePoint(source_lon, source_lat),
              ST_MakePoint(hub_lon, hub_lat)
            ) * $2 / NULLIF($5, 0))
          )
        ) AS travel_seconds
      FROM source_points
      WHERE hub_building_gers_id IS NOT NULL
    ),
    inserts AS (
      SELECT
        region_id,
        source_gers_id,
        hub_building_gers_id AS hub_gers_id,
        travel_seconds,
        resource_type,
        amount
      FROM travel_times
      CROSS JOIN LATERAL (
        SELECT 'food'::text AS resource_type, food_amount AS amount
        WHERE food_amount > 0
        UNION ALL
        SELECT 'equipment'::text AS resource_type, equipment_amount AS amount
        WHERE equipment_amount > 0
        UNION ALL
        SELECT 'energy'::text AS resource_type, energy_amount AS amount
        WHERE energy_amount > 0
        UNION ALL
        SELECT 'materials'::text AS resource_type, materials_amount AS amount
        WHERE materials_amount > 0
      ) AS amounts
    )
    INSERT INTO resource_transfers (
      region_id,
      source_gers_id,
      hub_gers_id,
      resource_type,
      amount,
      depart_at,
      arrive_at
    )
    SELECT
      region_id,
      source_gers_id,
      hub_gers_id,
      resource_type,
      amount,
      now(),
      now() + (travel_seconds || ' seconds')::interval
    FROM inserts
    RETURNING
      transfer_id,
      region_id,
      source_gers_id,
      hub_gers_id,
      resource_type,
      amount,
      depart_at::text,
      arrive_at::text
    `,
    [
      multipliers.generation,
      RESOURCE_DISTANCE_MULTIPLIER,
      RESOURCE_TRAVEL_MIN_S,
      RESOURCE_TRAVEL_MAX_S,
      RESOURCE_TRAVEL_MPS
    ]
  );

  return result.rows;
}

export async function applyArrivedResourceTransfers(pool: PoolLike): Promise<ArrivalResult> {
  if (!(await ensureResourceTransfersTable(pool))) {
    return { regionIds: [] };
  }

  const result = await pool.query<{ region_id: string }>(
    `
    WITH arrived AS (
      SELECT transfer_id, region_id, resource_type, amount
      FROM resource_transfers
      WHERE status = 'in_transit'
        AND arrive_at <= now()
      FOR UPDATE SKIP LOCKED
    ),
    totals AS (
      SELECT
        region_id,
        SUM(CASE WHEN resource_type = 'food' THEN amount ELSE 0 END)::bigint AS food,
        SUM(CASE WHEN resource_type = 'equipment' THEN amount ELSE 0 END)::bigint AS equipment,
        SUM(CASE WHEN resource_type = 'energy' THEN amount ELSE 0 END)::bigint AS energy,
        SUM(CASE WHEN resource_type = 'materials' THEN amount ELSE 0 END)::bigint AS materials
      FROM arrived
      GROUP BY region_id
    ),
    updated_regions AS (
      UPDATE regions AS r
      SET
        pool_food = r.pool_food + COALESCE(totals.food, 0),
        pool_equipment = r.pool_equipment + COALESCE(totals.equipment, 0),
        pool_energy = r.pool_energy + COALESCE(totals.energy, 0),
        pool_materials = r.pool_materials + COALESCE(totals.materials, 0),
        updated_at = now()
      FROM totals
      WHERE r.region_id = totals.region_id
      RETURNING r.region_id
    )
    UPDATE resource_transfers AS rt
    SET status = 'arrived'
    WHERE rt.transfer_id IN (SELECT transfer_id FROM arrived)
    RETURNING rt.region_id
    `
  );

  const regionIds = Array.from(new Set(result.rows.map((row) => row.region_id)));
  return { regionIds };
}
