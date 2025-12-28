import type { PoolLike } from "./ticker";
import type { PhaseName } from "./cycle";
import { notifyEvent } from "./notify";

/**
 * The Lamplighter - A mysterious guardian who walks the streets at night,
 * observing the Rust's advance and helping where they can.
 *
 * "The nights are getting longer."
 *
 * This bot makes the world feel alive by generating 1-2 actions per region
 * per tick cycle, simulating an active community of workers and observers.
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

export type CriticalTask = {
  task_id: string;
  region_id: string;
  road_name: string | null;
  health: number;
  priority_score: number;
};

// The Lamplighter's observations, keyed by phase
const PHASE_OBSERVATIONS: Record<PhaseName, string[]> = {
  dawn: [
    "The first light breaks. The Rust retreats... for now.",
    "Another dawn. The city endures.",
    "I've walked these streets since before the first forgetting. Dawn still brings hope.",
    "The shadows lengthen even as the sun rises. Have you noticed?",
    "Morning fog hides what the night has taken.",
  ],
  day: [
    "The sun is high. Make haste with repairs—night comes sooner than you think.",
    "I rest little during daylight. There is always more to watch.",
    "The old roads remember when they were new. I remember too.",
    "Some say the Rust sleeps during the day. They are wrong. It waits.",
    "Good work today. The city grows stronger.",
  ],
  dusk: [
    "The shadows grow long. Secure what you can before darkness falls.",
    "Dusk brings a chill that seeps into old bones—and old roads.",
    "I light my lantern. The night watch begins soon.",
    "The boundary between light and dark grows thin. Be vigilant.",
    "I've seen a thousand dusks. Each one feels shorter than the last.",
  ],
  night: [
    "The night is deep. The Rust spreads swiftly now.",
    "In darkness, the old decay accelerates. Stay close to the light.",
    "I walk where others fear to tread. Someone must bear witness.",
    "The nights are getting longer. Or perhaps it only seems that way.",
    "Listen. Do you hear the creak of failing infrastructure? The Rust speaks.",
    "Not all who wander the night are lost. Some of us are looking.",
    "The city sleeps, but its guardians do not. Neither does the Rust.",
  ],
};

// Regional activity messages - things happening in each region
const REGIONAL_ACTIVITY: Record<PhaseName, string[]> = {
  dawn: [
    "Workers in {region} begin their morning rounds.",
    "The dawn patrol reports from {region}: all clear, for now.",
    "First shift crews mobilize in {region}.",
    "Early risers in {region} assess last night's damage.",
  ],
  day: [
    "Repair crews active throughout {region}.",
    "Supply convoy arrives in {region}.",
    "Volunteers reinforce the roads of {region}.",
    "Steady progress reported in {region}.",
    "Survey team maps decay patterns in {region}.",
    "Material stockpiles restocked in {region}.",
  ],
  dusk: [
    "Evening shift takes over in {region}.",
    "Workers in {region} wrap up before nightfall.",
    "Final daylight repairs underway in {region}.",
    "Emergency supplies distributed in {region}.",
  ],
  night: [
    "Night watch patrols the streets of {region}.",
    "Emergency crews on standby in {region}.",
    "Lanterns lit along the roads of {region}.",
    "Skeleton crew maintains vigil in {region}.",
    "Night repair team deployed in {region}.",
  ],
};

// Warnings for critical conditions
const CRITICAL_WARNINGS = {
  highRust: [
    "The Rust claims more ground in {region}. The orange tide advances.",
    "I've seen this before in {region}. The pattern accelerates.",
    "{region} grows dim. The Rust feeds well tonight.",
  ],
  lowHealth: [
    "The roads of {region} crumble. They cry out for repair.",
    "Infrastructure fails in {region}. How long before collapse?",
    "{region}'s arteries weaken. A city cannot live without its roads.",
  ],
  lowResources: [
    "{region} runs low on supplies. The crews cannot work without materials.",
    "The stockpiles dwindle in {region}. Send aid if you can.",
    "{region} starves for resources. The work slows to a crawl.",
  ],
  criticalTask: [
    "A road falters at {road}. Priority: critical.",
    "Urgent: {road} requires immediate attention.",
    "I've marked {road} for repair. It cannot wait much longer.",
  ],
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
 * The Lamplighter makes the world feel alive by generating activity across all regions.
 * Generates 1-2 actions per region per tick to simulate an active community.
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

  // Fetch current world state
  const regionStates = await fetchRegionStates(client);
  const criticalTasks = await fetchCriticalTasks(client);

  // Build a map of tasks by region for easy lookup
  const tasksByRegion = new Map<string, CriticalTask[]>();
  for (const task of criticalTasks) {
    const existing = tasksByRegion.get(task.region_id) ?? [];
    existing.push(task);
    tasksByRegion.set(task.region_id, existing);
  }

  // Process each region - generate 1-2 activities per region
  for (const region of regionStates) {
    const regionTasks = tasksByRegion.get(region.region_id) ?? [];
    const actionsThisTick = await processRegion(client, region, regionTasks, phase);
    result.regionActivities += actionsThisTick.activities;
    result.contributions += actionsThisTick.contributions;
    result.votes += actionsThisTick.votes;
    result.warnings += actionsThisTick.warnings;
  }

  // Global observations from the Lamplighter (less frequent)
  if (Math.random() < 0.15) {
    await shareObservation(client, phase);
    result.observations++;
  }

  return result;
}

type RegionActionResult = {
  activities: number;
  contributions: number;
  votes: number;
  warnings: number;
};

async function processRegion(
  client: PoolLike,
  region: RegionState,
  tasks: CriticalTask[],
  phase: PhaseName
): Promise<RegionActionResult> {
  const result: RegionActionResult = {
    activities: 0,
    contributions: 0,
    votes: 0,
    warnings: 0,
  };

  // Determine number of actions (1-2 per region, weighted by conditions)
  const baseActions = 1;
  const needsHelp = region.rust_avg > 0.4 || region.health_avg < 60;
  const extraActionChance = needsHelp ? 0.7 : 0.4;
  const numActions = baseActions + (Math.random() < extraActionChance ? 1 : 0);

  for (let i = 0; i < numActions; i++) {
    const actionType = selectAction(region, tasks, phase);

    switch (actionType) {
      case "activity":
        await shareRegionalActivity(client, region, phase);
        result.activities++;
        break;
      case "contribute": {
        const contributed = await contributeToRegion(client, region, phase);
        if (contributed) {
          result.contributions++;
        } else {
          // No buildings available to activate, fall back to activity
          await shareRegionalActivity(client, region, phase);
          result.activities++;
        }
        break;
      }
      case "vote":
        if (tasks.length > 0) {
          await voteOnRegionTask(client, tasks);
          result.votes++;
        } else {
          // Fallback to activity if no tasks
          await shareRegionalActivity(client, region, phase);
          result.activities++;
        }
        break;
      case "warning": {
        const issued = await issueWarning(client, region, tasks, phase);
        if (issued) {
          result.warnings++;
        } else {
          result.activities++; // Fallback was used
        }
        break;
      }
    }
  }

  return result;
}

type ActionType = "activity" | "contribute" | "vote" | "warning";

function selectAction(
  region: RegionState,
  tasks: CriticalTask[],
  phase: PhaseName
): ActionType {
  const isNight = phase === "night";
  const isDusk = phase === "dusk";

  // Calculate urgency scores (thresholds match issueWarning checks)
  const rustUrgency = region.rust_avg > 0.5 ? 2 : region.rust_avg > 0.3 ? 1 : 0;
  const healthUrgency = region.health_avg < 50 ? 2 : region.health_avg < 60 ? 1 : 0;
  const resourceUrgency =
    region.pool_food < 30 || region.pool_materials < 30 ? 2 :
      region.pool_food < 60 || region.pool_materials < 60 ? 1 : 0;
  const hasCriticalTasks = tasks.some(t => t.health < 25);

  // Build weighted action pool
  const actions: Array<{ type: ActionType; weight: number }> = [];

  // Base activity is always possible
  actions.push({ type: "activity", weight: 3 });

  // Contributions are more likely when resources are low or during day
  const contributeWeight = resourceUrgency * 2 + (isNight ? 1 : 2);
  actions.push({ type: "contribute", weight: contributeWeight });

  // Voting more likely when there are urgent tasks
  if (tasks.length > 0) {
    const voteWeight = (healthUrgency + (hasCriticalTasks ? 2 : 0)) + 1;
    actions.push({ type: "vote", weight: voteWeight });
  }

  // Warnings more likely when conditions are bad (include moderate health issues)
  if (rustUrgency > 0 || healthUrgency >= 1 || (resourceUrgency > 1 && !isNight)) {
    const warningWeight = isNight || isDusk ? 2 : 1;
    actions.push({ type: "warning", weight: warningWeight });
  }

  // Weighted random selection
  const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) return action.type;
  }

  return "activity";
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

export async function fetchCriticalTasks(client: PoolLike): Promise<CriticalTask[]> {
  const result = await client.query<CriticalTask>(`
    SELECT
      t.task_id,
      t.region_id,
      wf.name AS road_name,
      fs.health,
      t.priority_score
    FROM tasks t
    JOIN world_features wf ON wf.gers_id = t.gers_id
    JOIN feature_state fs ON fs.gers_id = t.gers_id
    WHERE t.status IN ('queued', 'active')
    ORDER BY t.priority_score DESC, fs.health ASC
    LIMIT 50
  `);
  return result.rows;
}

async function shareObservation(client: PoolLike, phase: PhaseName): Promise<void> {
  const observation = pickRandom(PHASE_OBSERVATIONS[phase]);

  await notifyEvent(client, "feed_item", {
    event_type: "lamplighter",
    region_id: null,
    message: `🏮 ${observation}`,
    ts: new Date().toISOString(),
  });
}

async function shareRegionalActivity(
  client: PoolLike,
  region: RegionState,
  phase: PhaseName
): Promise<void> {
  const template = pickRandom(REGIONAL_ACTIVITY[phase]);
  const message = formatMessage(template, { region: region.name || "this district" });

  await notifyEvent(client, "feed_item", {
    event_type: "activity",
    region_id: region.region_id,
    message,
    ts: new Date().toISOString(),
  });
}

/**
 * Activates buildings in a region so they generate resources via the standard
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
  // Building activation counts are tuned for game balance:
  // - Day (3): Peak productivity, workers most active, most buildings running
  // - Dawn/Dusk (2): Transition periods with moderate activity
  // - Night (1): Minimal activity, only essential operations continue
  // These values create a natural rhythm matching the day/night cycle theme.
  const buildingsToActivate =
    phase === "day" ? 3 :
      phase === "dawn" ? 2 :
        phase === "dusk" ? 2 :
          1; // night

  // Find random buildings in this region that generate resources and aren't already activated.
  // Note: ORDER BY random() is acceptable here because the result set is already small
  // after filtering by region, feature_type, and activation timestamp. Typical regions
  // have ~10-50 resource-generating buildings, and we only select a handful.
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
    LIMIT $2`,
    [region.region_id, buildingsToActivate]
  );

  if (buildingResult.rows.length === 0) {
    return false;
  }

  // Activate the buildings - this will trigger resource generation in the next tick
  const buildingIds = buildingResult.rows.map(b => b.gers_id);
  await client.query(
    `INSERT INTO feature_state (gers_id, last_activated_at)
     SELECT unnest($1::text[]), now()
     ON CONFLICT (gers_id) DO UPDATE SET last_activated_at = now()`,
    [buildingIds]
  );

  // Collect resource types for the activity message. Note: this shows what types
  // of resources the buildings CAN generate, not exact amounts. Actual generation
  // depends on rust levels and is handled by enqueueResourceTransfers in the ticker.
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

async function voteOnRegionTask(
  client: PoolLike,
  tasks: CriticalTask[]
): Promise<void> {
  // Prefer voting on lower health tasks that need attention
  const sortedTasks = [...tasks].sort((a, b) => a.health - b.health);
  const task = sortedTasks[0];
  if (!task) return;

  // Generate a voter ID from a larger pool to avoid exhaustion
  // Uses timestamp component for variety across ticks
  const voterNum = Math.floor(Math.random() * 100);
  const voterId = `citizen_${voterNum}`;

  await client.query(
    `INSERT INTO task_votes (task_id, client_id, weight)
     VALUES ($1, $2, 1)
     ON CONFLICT (task_id, client_id) DO NOTHING`,
    [task.task_id, voterId]
  );
}

/**
 * Issue a warning about critical conditions. Returns true if a warning was issued,
 * false if it fell back to a regular activity (no warning conditions met).
 */
async function issueWarning(
  client: PoolLike,
  region: RegionState,
  tasks: CriticalTask[],
  phase: PhaseName
): Promise<boolean> {
  // Determine what to warn about
  let template: string;
  let vars: Record<string, string>;

  const criticalTask = tasks.find(t => t.health < 25);

  if (region.rust_avg > 0.5) {
    template = pickRandom(CRITICAL_WARNINGS.highRust);
    vars = { region: region.name || "this district" };
  } else if (criticalTask) {
    template = pickRandom(CRITICAL_WARNINGS.criticalTask);
    vars = { road: criticalTask.road_name || "an unnamed road" };
  } else if (region.health_avg < 50) {
    template = pickRandom(CRITICAL_WARNINGS.lowHealth);
    vars = { region: region.name || "this district" };
  } else if (region.pool_food < 40 || region.pool_materials < 40) {
    template = pickRandom(CRITICAL_WARNINGS.lowResources);
    vars = { region: region.name || "this district" };
  } else {
    // No warning needed, share activity instead
    await shareRegionalActivity(client, region, phase);
    return false;
  }

  const message = formatMessage(template, vars);

  await notifyEvent(client, "feed_item", {
    event_type: "lamplighter_warning",
    region_id: region.region_id,
    message: `🏮 ${message}`,
    ts: new Date().toISOString(),
  });

  return true;
}
