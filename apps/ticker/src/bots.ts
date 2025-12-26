import type { PoolLike } from "./ticker";
import { notifyEvent } from "./notify";

export async function simulateBots(client: PoolLike, enabled: boolean) {
  if (!enabled) return;

  // 1. Chance to contribute
  if (Math.random() < 0.3) {
    // Pick a random region
    const regionResult = await client.query<{ region_id: string }>(
      "SELECT region_id FROM regions ORDER BY random() LIMIT 1"
    );
    const regionId = regionResult.rows[0]?.region_id;

    if (regionId) {
      const labor = Math.floor(Math.random() * 50) + 10;
      const materials = Math.floor(Math.random() * 50) + 10;

      await client.query(
        "UPDATE regions SET pool_labor = pool_labor + $1, pool_materials = pool_materials + $2 WHERE region_id = $3",
        [labor, materials, regionId]
      );

      await notifyEvent(client, "feed_item", {
        event_type: "contribute",
        region_id: regionId,
        message: `Anonymous contributor added ${labor} labor and ${materials} materials`,
        ts: new Date().toISOString()
      });
    }
  }

  // 2. Chance to vote on a task
  if (Math.random() < 0.3) {
    const taskResult = await client.query<{ task_id: string; region_id: string }>(
      "SELECT task_id, region_id FROM tasks WHERE status = 'active' ORDER BY random() LIMIT 1"
    );
    const task = taskResult.rows[0];

    if (task) {
      // Upsert a bot vote
      const botId = `bot_${Math.floor(Math.random() * 10)}`;
      
      await client.query(
        `INSERT INTO task_votes (task_id, client_id, weight) 
         VALUES ($1, $2, 1)
         ON CONFLICT (task_id, client_id) DO NOTHING`,
        [task.task_id, botId]
      );
      
      // We don't notify for every vote to avoid spam, but the priority update will reflect it next tick
    }
  }
}
