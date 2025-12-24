import { Pool, PoolConfig } from "pg";

export const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000
};

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    pool = new Pool(poolConfig);

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
