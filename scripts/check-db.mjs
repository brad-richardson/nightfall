import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const tables = [
  "regions",
  "hex_cells",
  "world_features",
  "feature_state",
  "tasks",
  "task_votes",
  "crews",
  "players",
  "events",
  "world_meta"
];

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  for (const table of tables) {
    const result = await client.query("SELECT to_regclass($1) as name", [`public.${table}`]);
    const exists = Boolean(result.rows[0]?.name);

    if (!exists) {
      throw new Error(`missing table: ${table}`);
    }
  }

  const meta = await client.query("SELECT COUNT(*)::int as count FROM world_meta");
  const count = Number(meta.rows[0]?.count ?? 0);
  if (count < 3) {
    throw new Error("world_meta seed data missing");
  }

  console.log("db check passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
