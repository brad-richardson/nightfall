import { Pool } from "pg";
import { getConfig } from "./config";

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000
    });

    pool.on("error", (err: Error) => {
      console.error("Unexpected pool error:", err);
    });
  }

  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
