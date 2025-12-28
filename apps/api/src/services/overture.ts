/**
 * Overture Maps API cache service
 */

import { getPool } from "../db";

const OVERTURE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // daily refresh is sufficient; releases are monthly
let overtureLatestCache: { value: string; fetchedAt: number } | null = null;

export function resetOvertureCacheForTests() {
  overtureLatestCache = null;
}

function normalizeOvertureRelease(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d{4}-\d{2}-\d{2})(?:\.\d+)?/);
  return match ? match[1] : null;
}

async function readOvertureReleaseFromDb(): Promise<string | null> {
  try {
    const pool = getPool();
    const result = await pool.query<{ release: string | null }>(
      "SELECT value->>'release' AS release FROM world_meta WHERE key = 'overture_release'"
    );
    return result.rows[0]?.release ?? null;
  } catch {
    return null;
  }
}

async function writeOvertureReleaseToDb(release: string): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('overture_release', jsonb_build_object('release', $1, 'fetched_at', now()), now())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      [release]
    );
  } catch {
    // best-effort cache only
  }
}

export async function fetchOvertureLatest(): Promise<string | null> {
  const now = Date.now();
  if (overtureLatestCache && now - overtureLatestCache.fetchedAt < OVERTURE_CACHE_TTL_MS) {
    return overtureLatestCache.value;
  }

  try {
    const response = await fetch("https://stac.overturemaps.org/");
    if (!response.ok) {
      throw new Error(`fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      latest?: string;
      links?: Array<{ rel?: string; href?: string; latest?: boolean }>;
    };

    const fromLatestField = normalizeOvertureRelease(payload.latest ?? null);
    const fromLinks = normalizeOvertureRelease(
      payload.links?.find((link) => link.latest)?.href ??
        payload.links?.find((link) => link.rel === "child")?.href ??
        null
    );

    const release = fromLatestField ?? fromLinks;
    if (release) {
      overtureLatestCache = { value: release, fetchedAt: now };
      await writeOvertureReleaseToDb(release);
      return release;
    }
  } catch {
    // Swallow and fall back to cache; logger not available here
  }

  const cachedRelease = await readOvertureReleaseFromDb();
  if (cachedRelease) {
    return cachedRelease;
  }

  return overtureLatestCache?.value ?? null;
}
