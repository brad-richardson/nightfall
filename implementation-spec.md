# Nightfall — Implementation Spec

## One-sentence pitch

A persistent, shared, city-scale infrastructure sim where real-world GERS infrastructure features (powered by Overture data) are the game objects, and players collaborate via a vector map UI to maintain roads and buildings against The Rust — a creeping decay that spreads faster when night falls.

## Tagline

*"The nights are getting longer."*

## Attribution

Nightfall uses Overture Maps data (and its upstream sources); ensure proper in-product and documentation attribution for Overture and contributors when shipping.

---

## Lore

Something changed. No one knows exactly what — some say it was atmospheric, others say it came from the ground, from the old infrastructure itself finally giving up. What they do know is that when night falls, The Rust spreads.

It's not rust in the traditional sense. It's accelerated entropy. Metal corrodes in hours. Asphalt crumbles. Concrete spalls and cracks. The longer the darkness sits on a place, the faster things fall apart. During the day, it slows — almost stops. But the nights are getting longer.

The only thing that seems to help is activity. Movement. Maintenance. Roads that carry traffic resist it. Buildings with people inside hold together. The city survives by staying alive — by refusing to be still.

---

## Core Design Decisions

- **City**: Boston (MVP), Seattle (post-MVP)
- **Regions**: Fixed set of divisions (manually curated, ~10-20 per city), each identified by its `gers_id`
- **Hex grid**: H3 hexagons overlay the map for Rust spread and visualization
- **Importance**: Road class only (motorway > trunk > primary > secondary > tertiary > residential > service)
- **Resource generation**: Places layer mapped to containing buildings
- **The Rust**: Spatial decay that spreads inward from edges; accelerates at night, slows during day
- **Day/night cycle**: 20-minute full cycle (8 min day, 8 min night, 2 min transitions)
- **Player identity**: Anonymous, fixed home region on first interaction
- **Voting**: Decay over time (older votes matter less)
- **World reset**: Weekly, back to moderately healthy state
- **Platforms**: Desktop and mobile web (responsive, touch-friendly)

---

## Implementation Status (Dec 2025)

- Runtime split: `apps/web` (Next.js App Router UI), `apps/api` (Fastify API + SSE), `apps/ticker` (Node tick worker with advisory lock).
- Map is the primary UI surface with in-map overlays (header, pools, health ring, task list, resource ticker, activity feed); mobile uses a bottom sheet.
- UI enhancements merged: task highlighting, phase transition overlays, hover tooltips, rust breathing, crew travel paths, regional health ring, task list search/filter/sort.
- Resource transfers are in-transit: `resource_transfers` table queues transfers; pools update on arrival; SSE `resource_transfer` drives client animations.
- Road routing helper `apps/web/app/lib/roadRouting.ts` builds a simple graph from road geometry for pathing animations.
- Ops constraints: low-memory host; API responses use `Cache-Control: no-store`; tile release is fetched dynamically and only cached in DB as `world_meta.overture_release`.
- Ticker performs periodic cleanup of old `events` and `resource_transfers` (hourly by default).

## 1. Data Model (Postgres)

### regions

Fixed set of division-based regions, curated at setup.

```sql
CREATE TABLE regions (
  region_id TEXT PRIMARY KEY,           -- gers_id of the division
  name TEXT NOT NULL,
  boundary GEOMETRY(Polygon, 4326) NOT NULL,
  center GEOMETRY(Point, 4326) NOT NULL,
  distance_from_center REAL NOT NULL,   -- for fog spread ordering
  pool_labor BIGINT NOT NULL DEFAULT 0,
  pool_materials BIGINT NOT NULL DEFAULT 0,
  crew_count SMALLINT NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX regions_boundary_idx ON regions USING GIST(boundary);
```

### hex_cells

H3 hexagons covering the play area, for Rust mechanics.

```sql
CREATE TABLE hex_cells (
  h3_index TEXT PRIMARY KEY,            -- H3 cell index (resolution 8 or 9)
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  rust_level REAL NOT NULL DEFAULT 0,   -- 0 = clear, 1 = fully rusted
  distance_from_center REAL NOT NULL,   -- precomputed, for Rust spread
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hex_cells_region_idx ON hex_cells(region_id);
CREATE INDEX hex_cells_rust_idx ON hex_cells(rust_level);
```

### world_features

Static Overture metadata for roads, buildings, parks, water.

```sql
CREATE TABLE world_features (
  gers_id TEXT PRIMARY KEY,
  feature_type TEXT NOT NULL,           -- road, building, park, water, intersection
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  h3_index TEXT NOT NULL REFERENCES hex_cells(h3_index),
  geom GEOMETRY NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  -- roads only
  road_class TEXT,                      -- motorway, trunk, primary, secondary, tertiary, residential, service
  -- buildings only (derived from places)
  place_category TEXT,                  -- restaurant, industrial, retail, office, etc. NULL if no place
  generates_labor BOOLEAN NOT NULL DEFAULT FALSE,
  generates_materials BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX world_features_region_idx ON world_features(region_id);
CREATE INDEX world_features_h3_idx ON world_features(h3_index);
CREATE INDEX world_features_type_idx ON world_features(feature_type);
CREATE INDEX world_features_geom_idx ON world_features USING GIST(geom);
```

### feature_state

Dynamic state per feature (roads primarily).

```sql
CREATE TABLE feature_state (
  gers_id TEXT PRIMARY KEY REFERENCES world_features(gers_id),
  health SMALLINT NOT NULL DEFAULT 100, -- 0..100
  status TEXT NOT NULL DEFAULT 'normal', -- normal, degraded, repairing
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feature_state_health_idx ON feature_state(health);
CREATE INDEX feature_state_status_idx ON feature_state(status);
```

### tasks

Repair and maintenance tasks.

```sql
CREATE TABLE tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  target_gers_id TEXT NOT NULL REFERENCES world_features(gers_id),
  task_type TEXT NOT NULL,              -- repair_road
  cost_labor INT NOT NULL,
  cost_materials INT NOT NULL,
  duration_s INT NOT NULL,
  repair_amount INT NOT NULL,           -- health restored on completion
  priority_score REAL NOT NULL DEFAULT 0,
  vote_score REAL NOT NULL DEFAULT 0,   -- decayed vote total
  status TEXT NOT NULL DEFAULT 'queued', -- queued, active, done, expired
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX tasks_region_status_idx ON tasks(region_id, status);
CREATE INDEX tasks_priority_idx ON tasks(priority_score DESC);
```

### task_votes

Individual votes with timestamps for decay calculation.

```sql
CREATE TABLE task_votes (
  vote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  weight SMALLINT NOT NULL DEFAULT 1,   -- 1 = upvote, -1 = downvote
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX task_votes_unique_idx ON task_votes(task_id, client_id);
CREATE INDEX task_votes_task_idx ON task_votes(task_id);
```

### crews

NPC work crews per region.

```sql
CREATE TABLE crews (
  crew_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  status TEXT NOT NULL DEFAULT 'idle',  -- idle, traveling, working
  active_task_id UUID REFERENCES tasks(task_id),
  busy_until TIMESTAMPTZ
);

CREATE INDEX crews_region_idx ON crews(region_id);
CREATE INDEX crews_status_idx ON crews(status);
```

### players

Anonymous player state.

```sql
CREATE TABLE players (
  client_id TEXT PRIMARY KEY,
  display_name TEXT,
  home_region_id TEXT REFERENCES regions(region_id),
  lifetime_contrib BIGINT NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### events

Append-only activity log.

```sql
CREATE TABLE events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id TEXT,
  region_id TEXT,
  event_type TEXT NOT NULL,             -- contribute, vote, task_complete, fog_spread
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX events_ts_idx ON events(ts DESC);
CREATE INDEX events_region_idx ON events(region_id);
```

### resource_transfers

Track in-transit resources from buildings to hubs; pools update on arrival.

```sql
CREATE TABLE resource_transfers (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  source_gers_id TEXT REFERENCES world_features(gers_id),
  hub_gers_id TEXT REFERENCES world_features(gers_id),
  resource_type TEXT NOT NULL, -- labor | materials
  amount INT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'in_transit',
  depart_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrive_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX resource_transfers_region_status_idx
  ON resource_transfers(region_id, status, arrive_at);
CREATE INDEX resource_transfers_arrive_idx
  ON resource_transfers(arrive_at) WHERE status = 'in_transit';
```

### world_meta

Global world state and reset tracking.

```sql
CREATE TABLE world_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Initial values:
-- 'last_reset' -> { "ts": "2025-01-01T00:00:00Z", "version": 1 }
-- 'demo_mode' -> { "enabled": false, "tick_multiplier": 1 }
-- 'cycle_state' -> { "phase": "day", "phase_start": "...", "cycle_start": "..." }
-- 'overture_release' -> { "release": "YYYY-MM-DD", "fetched_at": "..." }
```

---

## 2. Resource Generation Rules

### Place category → building output

Places are spatially joined to their containing building at ingest time.

| Place category pattern | generates_labor | generates_materials |
|------------------------|-----------------|---------------------|
| `restaurant`, `cafe`, `bar`, `food_*` | TRUE | FALSE |
| `office`, `coworking` | TRUE | FALSE |
| `retail`, `shop_*`, `store` | TRUE | FALSE |
| `industrial`, `factory`, `warehouse`, `manufacturing` | FALSE | TRUE |
| `construction`, `building_supply*`, `hardware*`, `home_improvement*`, `garden_center`, `nursery_and_gardening`, `lumber*`, `wood*`, `flooring*`, `automotive_repair`, `auto_body_shop`, `industrial_equipment` | FALSE | TRUE |
| `hospital`, `school`, `university` | TRUE | FALSE |
| All others | FALSE | FALSE |

Buildings without a matched place generate nothing.

Fallback: if a building has no matching category, assign labor or materials to 5% of buildings using a deterministic hash of the GERS id.

If a place category matches both labor and materials patterns, treat it as materials only.

### Generation rates (per tick, per building)

- Labor: `1 * (1 - local_rust_level) * day_multiplier` per labor-generating building
- Materials: `1 * (1 - local_rust_level) * day_multiplier` per material-generating building

Generated resources are enqueued as in-transit transfers to the region hub and do not appear in pools until arrival.

Resources accumulate in the building's region pool. Generation is higher during the day.

---

## 3. Production Minigames

Buildings passively generate resources each tick, but players can **temporarily boost** a building's output by completing a skill-based minigame. This creates an active gameplay loop beyond voting and watching.

### Overview

- **Trigger**: Player clicks a resource-generating building → clicks "Boost Production"
- **UI**: Opens an **immersive overlay** (80% viewport, centered, dimmed background)
- **Duration**: 10-30 seconds depending on minigame
- **Reward**: Temporary production multiplier (2-3×) for that building, duration based on performance
- **Cooldown**: Per-building cooldown (e.g., 5 minutes) before player can boost again

### Minigame Roster

Six minigames, themed to the four resource types:

| Resource | Minigame | Skill Type | Description |
|----------|----------|------------|-------------|
| **Food** | Kitchen Rush | Memory (Simon Says) | Repeat the order sequence as it gets longer |
| **Food** | Fresh Check | Reaction | Sort fresh ingredients left, spoiled right on a conveyor |
| **Equipment** | Gear Up | Alignment/Timing | Drag spinning gear to mesh with fixed gear at right moment |
| **Equipment** | Patch Job | Precision/Tracing | Trace a welding line along cracks before they spread |
| **Energy** | Power Up | Rhythm/Control | Tap to spin generator, maintain RPM in sweet spot |
| **Materials** | Salvage Run | Timing Windows | Hit action button when oscillating marker is in clean zone |

### Minigame Selection

When a player boosts a building:
1. Determine building's resource type (food, equipment, energy, materials)
2. Randomly select from available minigames for that type
3. Apply night difficulty modifier if applicable

### Overlay UI Specification

The minigame runs in an immersive, focused overlay - not a tiny modal.

```
┌──────────────────────────────────────────────────────────────────┐
│ [×]                                                              │
│                                                                  │
│                    ┌─────────────────────────┐                   │
│                    │                         │                   │
│                    │      MINIGAME AREA      │                   │
│                    │       (see specs)       │                   │
│                    │                         │                   │
│                    │                         │                   │
│                    └─────────────────────────┘                   │
│                                                                  │
│              ████████████░░░░░░░░  Progress / Timer              │
│                                                                  │
│                   🏭 Boosting: Corner Bakery                     │
│                   🍞 Resource: Food                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
       ▲
       │ 80% viewport height, centered
       │ Semi-transparent dark backdrop (click outside = confirm quit)
```

**Overlay behavior**:
- Opens with subtle scale-up animation
- Background map visible but dimmed (opacity 0.3)
- Escape or × button to quit (confirms first: "Quit? You'll lose progress")
- Mobile: Full-screen with safe area padding
- Game world continues ticking in background (adds tension at night)

### Minigame Specifications

#### Kitchen Rush (Food) — Simon Says

```
     ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐
     │ 🍳  │    │ 🥗  │    │ 🍜  │    │ 🍰  │
     │  1  │    │  2  │    │  3  │    │  4  │
     └─────┘    └─────┘    └─────┘    └─────┘

            "Repeat the order!"

     Round 5: ██████████░░░░░░░░░░

```

**Mechanic**:
- 4 stations light up in sequence
- Player repeats the sequence by clicking/tapping
- Each successful round adds one more to the sequence
- Fail = game ends, collect earnings based on rounds completed

**Scoring**: Round reached × base multiplier
**Night modifier**: Stations dim faster, sequence plays quicker

---

#### Fresh Check (Food) — Conveyor Sort

```
     ┌─────────────────────────────────────┐
     │        ●────────────►               │
     │      [🥬]                           │
     │                                     │
     │   [👎 SPOILED]         [👍 FRESH]   │
     └─────────────────────────────────────┘

     Score: 24    Mistakes: 1/3

```

**Mechanic**:
- Items slide across screen (left to right or top to bottom)
- Player swipes/clicks left for spoiled, right for fresh
- Visual cues: brown spots, wilting, mold vs. vibrant colors
- 3 mistakes = game over
- Speed increases over time

**Scoring**: Correct sorts × speed bonus
**Night modifier**: Items are darker, harder to distinguish

---

#### Gear Up (Equipment) — Alignment

```
            ┌───────────┐
            │  ╭─────╮  │  ← Fixed gear (target)
            │  │ ◆◆◆ │  │     Teeth at set positions
            │  ╰─────╯  │
            └───────────┘
                 ▲
                 │ Drag to engage
                 │
            ┌───────────┐
            │  ╭─────╮  │  ← Spinning gear (player drags)
            │  │ ◇◇◇ │  │     Teeth rotating
            │  ╰─────╯  │
            └───────────┘

            Chain: 2/5 gears

```

**Mechanic**:
- Bottom gear spins continuously
- Player drags it upward toward fixed gear
- Must release when teeth align (timing window)
- Perfect mesh = full points, partial = reduced, clash = retry with penalty

**Scoring**: Precision × speed × chain multiplier
**Night modifier**: Gears spin faster, timing window shrinks

---

#### Patch Job (Equipment) — Trace Welding

```
     ┌─────────────────────────────────────┐
     │                                     │
     │      ╱‾‾‾‾╲                         │
     │     ╱      ╲___                     │
     │    ●            ╲____               │  ← Crack pattern
     │   START              ╲              │
     │                       END           │
     │                                     │
     │   Accuracy: 94%    Time: 4.2s       │
     └─────────────────────────────────────┘

```

**Mechanic**:
- Crack pattern appears on metal surface
- Player traces along crack with mouse/finger
- Staying on line = good accuracy
- Crack slowly spreads if player is too slow
- Must reach end before crack spreads off-screen

**Scoring**: Accuracy % × time bonus
**Night modifier**: Crack spreads faster, line visibility reduced

---

#### Power Up (Energy) — Generator Crank

```
     ┌─────────────────────────────────────┐
     │                                     │
     │           ▲ OVERHEAT                │
     │     ┌────────────────────┐          │
     │     │        ████        │ ← Current RPM
     │     │      ══════════    │ ← Sweet spot zone
     │     └────────────────────┘          │
     │           ▼ STALL                   │
     │                                     │
     │     Output: ████████░░░░░░░░        │
     │                                     │
     │          [ TAP TAP TAP ]            │
     └─────────────────────────────────────┘

```

**Mechanic**:
- Tap/click repeatedly to increase RPM
- RPM naturally decays over time
- Sweet spot zone in middle of meter
- Above sweet spot = overheat warning, then penalty
- Below sweet spot = reduced output
- Stay in zone to fill output meter

**Scoring**: Time in sweet spot × output accumulated
**Night modifier**: Faster decay, narrower sweet spot

---

#### Salvage Run (Materials) — Timing Windows

```
     ┌─────────────────────────────────────┐
     │                                     │
     │   ◄═══════════════●═══════════════► │
     │         RUST ████████ CLEAN ███ RUST│
     │                                     │
     │              [ SALVAGE ]            │
     │                                     │
     │   Salvaged: 6/10 pieces             │
     │   Quality: ████████░░ 82%           │
     └─────────────────────────────────────┘

```

**Mechanic**:
- Marker oscillates left-right across meter
- Green "clean" zone in center, red "rust" zones on edges
- Player hits button when marker is in clean zone
- Closer to center = higher quality bonus
- 10 pieces to salvage, or time limit

**Scoring**: Pieces salvaged × average quality
**Night modifier**: Clean zone shrinks, oscillation speeds up

---

### Difficulty Scaling

| Factor | Day | Night | High Rust Area |
|--------|-----|-------|----------------|
| Speed/tempo | Normal | +25% | +10% |
| Timing windows | Normal | -20% | -10% |
| Visual clarity | Full | Reduced | Haze overlay |
| Rounds/pieces | Normal | +2 | Normal |

### Reward Structure

```javascript
const BASE_BOOST_DURATION_MS = 3 * 60 * 1000; // 3 minutes base

function calculateReward(score, maxScore, phase) {
  const performance = score / maxScore; // 0.0 - 1.0

  // Multiplier: 1.5× at 50% performance, up to 3× at 100%
  const multiplier = 1.5 + (performance * 1.5);

  // Duration: 1 min at 50%, up to 5 min at 100%
  const durationMs = BASE_BOOST_DURATION_MS * (0.33 + performance * 1.67);

  // Night bonus: +20% duration for playing during harder conditions
  const nightBonus = (phase === 'night') ? 1.2 : 1.0;

  return {
    multiplier: Math.round(multiplier * 10) / 10,
    durationMs: Math.round(durationMs * nightBonus),
  };
}
```

### Results Screen

After minigame completion:

```
     ┌─────────────────────────────────────┐
     │                                     │
     │          ★ GREAT JOB! ★             │
     │                                     │
     │         Score: 847 points           │
     │         Performance: 84%            │
     │                                     │
     │    ┌─────────────────────────┐      │
     │    │ 🍞 Corner Bakery        │      │
     │    │                         │      │
     │    │ Production: 2.3× boost  │      │
     │    │ Duration: 4:12          │      │
     │    └─────────────────────────┘      │
     │                                     │
     │          [ BACK TO MAP ]            │
     │                                     │
     └─────────────────────────────────────┘
```

### Database Schema Addition

```sql
-- Track active production boosts
CREATE TABLE production_boosts (
  boost_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_gers_id TEXT NOT NULL REFERENCES world_features(gers_id),
  client_id TEXT NOT NULL,
  multiplier REAL NOT NULL DEFAULT 2.0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  minigame_type TEXT NOT NULL,
  score INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX production_boosts_building_idx ON production_boosts(building_gers_id);
CREATE INDEX production_boosts_expires_idx ON production_boosts(expires_at);

-- Track cooldowns per player per building
CREATE TABLE minigame_cooldowns (
  client_id TEXT NOT NULL,
  building_gers_id TEXT NOT NULL REFERENCES world_features(gers_id),
  available_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, building_gers_id)
);
```

### API Additions

```
POST /api/minigame/start
  Request:  { client_id: string, building_gers_id: string }
  Response: {
    ok: boolean,
    minigame_type: string,
    config: { ... minigame-specific params ... },
    difficulty: { speed_mult, window_mult, ... }
  }
  - Validates cooldown
  - Selects minigame based on building resource type
  - Returns config adjusted for current phase

POST /api/minigame/complete
  Request:  {
    client_id: string,
    building_gers_id: string,
    minigame_type: string,
    score: number,
    max_score: number,
    duration_ms: number
  }
  Response: {
    ok: boolean,
    reward: { multiplier, duration_ms },
    new_cooldown_at: string (ISO)
  }
  - Validates score is plausible (anti-cheat: score/time ratio)
  - Creates production_boost record
  - Sets cooldown
  - Emits SSE event for building boost visual
```

### Ticker Integration

Modify resource generation to check for active boosts:

```python
# In tick loop, step 3 (generate resources)
for building in resource_buildings(region):
    rust = get_hex_rust(building.h3_index)
    base_output = 1 * (1 - rust) * phase_mults['generation']

    # Check for active boost
    boost = get_active_boost(building.gers_id)
    if boost and boost.expires_at > now:
        base_output *= boost.multiplier

    enqueue_transfer(building, base_output, building.resource_type)
```

### Visual Feedback on Map

Buildings with active boosts show:
- Pulsing glow ring matching resource color
- Small multiplier badge (×2.3)
- Boost timer arc around building
- Particle effect (subtle sparks/energy)

---

## 4. Road Class → Repair Costs

| Road class | Decay rate (per tick) | Repair cost (labor) | Repair cost (materials) | Repair time (s) | Repair amount |
|------------|----------------------|---------------------|-------------------------|-----------------|---------------|
| motorway | 0.5 | 100 | 100 | 120 | 30 |
| trunk | 0.6 | 80 | 80 | 100 | 30 |
| primary | 0.8 | 60 | 60 | 80 | 25 |
| secondary | 1.0 | 40 | 40 | 60 | 25 |
| tertiary | 1.2 | 30 | 30 | 50 | 20 |
| residential | 1.5 | 20 | 20 | 40 | 20 |
| service | 2.0 | 10 | 10 | 30 | 15 |

Decay is multiplied by local Rust level and time of day:
```
effective_decay = base_decay * (1 + rust_level) * night_multiplier
```

---

## 5. Day/Night Cycle

### Cycle timing

Full cycle: **20 minutes real-time**

| Phase | Duration | Description |
|-------|----------|-------------|
| **Dawn** | 2 min | Transition from night to day, Rust recedes slightly |
| **Day** | 8 min | Minimal decay, peak resource generation, repair efficiency bonus |
| **Dusk** | 2 min | Warning phase, Rust begins creeping back |
| **Night** | 8 min | Rust spreads aggressively, decay accelerates, crews work slower |

### Phase multipliers

```javascript
const PHASE_MULTIPLIERS = {
  dawn: {
    rust_spread: 0.2,      // Rust spreads slowly
    decay: 0.3,            // Roads decay slowly
    generation: 1.2,       // Resource generation bonus (people waking up)
    repair_speed: 1.0,     // Normal repair speed
  },
  day: {
    rust_spread: 0.1,      // Rust barely spreads
    decay: 0.2,            // Minimal decay
    generation: 1.5,       // Peak generation
    repair_speed: 1.25,    // Crews work faster in daylight
  },
  dusk: {
    rust_spread: 0.5,      // Rust picking up
    decay: 0.6,            // Decay increasing
    generation: 0.8,       // Generation winding down
    repair_speed: 1.0,     // Normal repair speed
  },
  night: {
    rust_spread: 1.0,      // Full Rust spread
    decay: 1.0,            // Full decay rate
    generation: 0.3,       // Minimal generation (skeleton crews)
    repair_speed: 0.75,    // Crews work slower at night
  }
};
```

### Cycle state tracking

```sql
-- Add to world_meta table
-- 'cycle_state' -> { 
--   "phase": "day", 
--   "phase_start": "2025-01-01T00:00:00Z",
--   "cycle_start": "2025-01-01T00:00:00Z"
-- }
```

### Phase calculation

```javascript
function getCurrentPhase(now) {
  const cycleLength = 20 * 60 * 1000; // 20 minutes in ms
  const cycleStart = getCycleStart();
  const elapsed = (now - cycleStart) % cycleLength;
  const minutes = elapsed / 60000;
  
  if (minutes < 2) return 'dawn';
  if (minutes < 10) return 'day';
  if (minutes < 12) return 'dusk';
  return 'night';
}

function getPhaseProgress(now) {
  // Returns 0-1 for current phase progress (for smooth transitions)
  const phase = getCurrentPhase(now);
  const phaseStart = getPhaseStart(phase);
  const phaseDuration = getPhaseDuration(phase);
  return (now - phaseStart) / phaseDuration;
}
```

### Visual transitions

- **Dawn**: Gradient from dark amber to warm yellow, Rust overlay fades
- **Day**: Bright, clear colors, minimal Rust overlay opacity
- **Dusk**: Gradient from warm to orange/amber, warning UI pulse
- **Night**: Desaturated, dark amber/brown tones, Rust overlay at full opacity

### UI indicators

- **Sun/moon icon** in corner showing current phase
- **Progress arc** around icon showing time until next phase
- **"Nightfall in X:XX"** countdown during dusk (creates urgency)
- **"Dawn in X:XX"** countdown during night (gives hope)

---

## 6. Rust Mechanics

### Spread behavior

- Rust originates from map edges (hex cells with highest `distance_from_center`)
- Each tick, Rust spreads inward: cells increase rust if neighbors have higher rust
- City center hex cells have `distance_from_center = 0` and resist Rust longest
- Rust never reaches 100% in center cells (world cannot be fully lost)
- **Spread rate varies by time of day** — fastest at night, slowest during day

### Rust effects

- Resource generation reduced: `output * (1 - rust_level) * phase.generation`
- Road decay increased: `decay * (1 + rust_level) * phase.decay`
- Visual: hex overlay with opacity = rust_level, tinted amber/brown

### Rust reduction

- Completing repairs in a hex reduces Rust in that hex by small amount
- Healthy roads (>80 health) in a hex slowly push back Rust
- Pushback is stronger during the day

### Rust spread algorithm (per tick)

```python
def spread_rust(phase):
    spread_mult = PHASE_MULTIPLIERS[phase]['rust_spread']
    
    for cell in hex_cells_ordered_by_distance_desc():
        if cell.distance_from_center == 0:
            continue  # center never fully rusts

        neighbor_rust = max(rust_level of H3 neighbors)
        
        if neighbor_rust > cell.rust_level:
            spread_rate = 0.01 * (neighbor_rust - cell.rust_level) * spread_mult
            cell.rust_level = min(0.95, cell.rust_level + spread_rate)
        
        # Healthy roads push back Rust (stronger during day)
        healthy_roads = count roads in cell with health > 80
        total_roads = count roads in cell
        if total_roads > 0:
            health_ratio = healthy_roads / total_roads
            # Pushback is inverse of spread multiplier
            pushback_mult = 1.5 - spread_mult  # 1.4 during day, 0.5 at night
            pushback = 0.005 * health_ratio * pushback_mult
            cell.rust_level = max(0, cell.rust_level - pushback)
```

### The Rust visual identity

- **Color palette**: Amber, burnt orange, brown, desaturated
- **Texture**: Particulate, like oxidized air or fine dust
- **Affected roads**: Cracked texture overlay, color shifts toward brown
- **Hex overlay**: Semi-transparent with subtle animated grain/noise
- **Transition edges**: Soft gradient, not hard lines

---

## 7. Vote Decay

Votes decay exponentially over time when calculating priority.

```
vote_weight(vote) = vote.weight * exp(-lambda * hours_since_vote)
lambda = 0.1  # half-life ≈ 7 hours

task.vote_score = sum(vote_weight(v) for v in task.votes)
task.priority_score = base_priority(road_class, health) + vote_score
```

Base priority calculation:
```
base_priority = (100 - health) * class_weight

class_weights = {
  motorway: 10,
  trunk: 8,
  primary: 6,
  secondary: 4,
  tertiary: 3,
  residential: 2,
  service: 1
}
```

---

## 8. Tick Loop (every 10 seconds, configurable)

```python
def tick(now):
    acquire_advisory_lock("world_tick")
    
    tick_multiplier = get_demo_mode_multiplier()  # 1 normally, 10 in demo mode
    phase = get_current_phase(now)
    phase_mults = PHASE_MULTIPLIERS[phase]
    
    # 1. Spread Rust (outer hexes → inner), affected by time of day
    spread_rust(phase)
    
    # 2. Decay roads
    for road in roads_in_active_hexes():
        rust = get_hex_rust(road.h3_index)
        decay = ROAD_DECAY[road.road_class] * (1 + rust) * phase_mults['decay'] * tick_multiplier
        road.health = max(0, road.health - decay)
        if road.health < 30:
            road.status = 'degraded'
    
    # 3. Generate resources and enqueue transfers (higher during day)
    for region in regions:
        for building in labor_buildings(region):
            rust = get_hex_rust(building.h3_index)
            labor = 1 * (1 - rust) * phase_mults['generation']
            enqueue_transfer(building, labor, "labor")
        for building in material_buildings(region):
            rust = get_hex_rust(building.h3_index)
            materials = 1 * (1 - rust) * phase_mults['generation']
            enqueue_transfer(building, materials, "materials")

    # 4. Apply arrived transfers to region pools
    for transfer in transfers_arrived(now):
        region.pool_labor += transfer.labor
        region.pool_materials += transfer.materials
        transfer.status = 'arrived'
    
    # 5. Spawn tasks for degraded roads without active tasks
    for road in degraded_roads_without_tasks():
        create_task(road)
    
    # 6. Update task priorities (with vote decay)
    update_all_task_priorities(now)
    
    # 7. Dispatch idle crews
    for crew in idle_crews():
        task = highest_priority_affordable_task(crew.region)
        if task:
            deduct_resources(crew.region, task)
            crew.status = 'working'
            crew.active_task_id = task.task_id
            # Repair time affected by time of day
            effective_duration = task.duration_s / phase_mults['repair_speed']
            crew.busy_until = now + effective_duration
            task.status = 'active'
            road.status = 'repairing'
    
    # 8. Complete finished tasks
    for crew in crews_past_deadline(now):
        task = crew.active_task
        road = task.target_road
        road.health = min(100, road.health + task.repair_amount)
        road.status = 'normal' if road.health >= 30 else 'degraded'
        
        # Rust pushback on repair (stronger during day)
        hex = get_hex(road.h3_index)
        pushback = 0.02 * (1.5 - phase_mults['rust_spread'])
        hex.rust_level = max(0, hex.rust_level - pushback)
        
        task.status = 'done'
        task.completed_at = now
        crew.status = 'idle'
        crew.active_task_id = None
        
        log_event('task_complete', task)

    # 9. Cleanup old events/transfers (periodic)
    cleanup_old_events_and_transfers(now)
    
    # 8. Check for phase transitions and emit events
    if phase_just_changed():
        log_event('phase_change', {'phase': phase})
        publish_phase_change(phase)
    
    # 9. Emit deltas via SSE
    publish_deltas()
    
    release_lock()
```

---

## 9. Weekly Reset

Every Sunday at 00:00 UTC:

```python
def weekly_reset():
    # Reset all road health to 70-90 (randomized)
    UPDATE feature_state 
    SET health = 70 + random() * 20,
        status = 'normal',
        updated_at = now()
    WHERE gers_id IN (SELECT gers_id FROM world_features WHERE feature_type = 'road')
    
    # Clear Rust to low levels (outer = 0.3, inner = 0)
    UPDATE hex_cells
    SET rust_level = LEAST(0.3, distance_from_center / max_distance * 0.3),
        updated_at = now()
    
    # Reset region pools to starting values
    UPDATE regions
    SET pool_labor = 1000,
        pool_materials = 1000,
        updated_at = now()
    
    # Clear all queued/active tasks
    DELETE FROM tasks WHERE status IN ('queued', 'active')
    
    # Reset crews
    UPDATE crews SET status = 'idle', active_task_id = NULL, busy_until = NULL
    
    # Reset cycle to dawn
    UPDATE world_meta
    SET value = jsonb_build_object(
        'ts', now(), 
        'version', (value->>'version')::int + 1
    ),
        updated_at = now()
    WHERE key = 'last_reset'
    
    UPDATE world_meta
    SET value = jsonb_build_object(
        'phase', 'dawn',
        'phase_start', now(),
        'cycle_start', now()
    )
    WHERE key = 'cycle_state'
    
    # Log reset event
    INSERT INTO events (event_type, payload)
    VALUES ('world_reset', jsonb_build_object('version', new_version))
```

---

## 10. API Routes

### Identity & Session

```
POST /api/hello
  Request:  { client_id: string, display_name?: string }
  Response: { 
    ok: boolean,
    world_version: number,
    home_region_id: string | null,
    regions: [{ region_id, name, center }],
    cycle: { phase, phase_progress, next_phase_in_seconds }
  }
  
  - Creates player if not exists
  - Returns existing home_region_id if set
```

### World State

```
GET /api/world
  Response: {
    world_version: number,
    last_reset: string (ISO),
    next_reset: string (ISO),
    demo_mode: boolean,
    cycle: {
      phase: 'dawn' | 'day' | 'dusk' | 'night',
      phase_progress: number (0-1),
      phase_start: string (ISO),
      next_phase: string,
      next_phase_in_seconds: number
    },
    regions: [{
      region_id, name, center,
      pool_labor, pool_materials,
      crew_count, active_crews,
      rust_avg, health_avg
    }]
  }

GET /api/region/:region_id
  Response: {
    region_id, name, boundary,
    pool_labor, pool_materials,
    crews: [{ crew_id, status, active_task_id, busy_until }],
    tasks: [{ task_id, target_gers_id, priority_score, status, ... }],
    stats: { total_roads, healthy_roads, degraded_roads, rust_avg }
  }

GET /api/features?bbox=w,s,e,n&types=road,building
  Response: {
    features: [{
      gers_id, feature_type, geom (GeoJSON),
      health?, status?, road_class?,
      place_category?, generates_labor?, generates_materials?
    }]
  }
  
  - Returns features within bounding box
  - Includes dynamic state for roads
  - Paginate if needed (cursor-based)

GET /api/hexes?bbox=w,s,e,n
  Response: {
    hexes: [{ h3_index, rust_level, boundary (GeoJSON) }]
  }
```

### Player Actions

```
POST /api/set-home
  Request:  { client_id: string, region_id: string }
  Response: { ok: boolean, home_region_id: string }
  
  - Only works if player has no home region set
  - Fails if already set

POST /api/contribute
  Request:  { client_id: string, region_id: string, labor: number, materials: number }
  Response: { ok: boolean, new_pool_labor: number, new_pool_materials: number }
  
  - Contributing to home region: 1:1
  - Contributing elsewhere: 20% tax (lose 20% of contribution)
  - Source: player's lifetime_contrib acts as soft limit? Or unlimited?
  
  MVP: Contributions are "free" - players just allocate focus, not personal resources.
  This means contribute = "I'm helping this region" signal, adds to pool from void.
  Limit: 100 labor + 100 materials per player per hour per region.

POST /api/vote
  Request:  { client_id: string, task_id: string, weight: 1 | -1 }
  Response: { ok: boolean, new_vote_score: number }
  
  - Upserts vote (one vote per player per task)
  - Weight: 1 = upvote, -1 = downvote

POST /api/tasks/:task_id
  GET: task details
  Response: { task_id, target_gers_id, road_class, health, priority_score, votes, eta }
```

### Realtime

```
GET /api/stream (SSE)
  Events:
    - phase_change: { phase, next_phase, next_phase_in_seconds }
    - world_delta: { rust_changed: [h3_index], regions_changed: [region_id] }
    - feature_delta: { gers_id, health, status }
    - task_delta: { task_id, status, priority_score }
    - feed_item: { event_type, region_id, message, ts }
    - reset_warning: { minutes_until_reset }
    - reset: { world_version }
```

### Admin / Demo

```
POST /api/admin/demo-mode
  Request:  { enabled: boolean, tick_multiplier?: number, cycle_speed?: number }
  Response: { ok: boolean }
  
  - Requires admin secret header
  - tick_multiplier: 1-20 (default 10 for demo)
  - cycle_speed: 1-10 (default 5 for demo, makes day/night cycle faster)

POST /api/admin/reset
  Request:  { confirm: true }
  Response: { ok: boolean, new_version: number }
  
  - Triggers immediate reset
  - Requires admin secret

POST /api/admin/set-phase
  Request:  { phase: 'dawn' | 'day' | 'dusk' | 'night' }
  Response: { ok: boolean }
  
  - Force a specific phase (for demos/testing)
  - Requires admin secret
```

---

## 11. UI Specification

### Layout (Responsive)

**Desktop (>768px)**
```
┌─────────────────────────────────────────────────────────┐
│ [Logo] Overture: Nightfall   [☀/☽ Day 3:42] [Region ▾] │
├────────────┬────────────────────────────────────────────┤
│            │                                            │
│  SIDEBAR   │                   MAP                      │
│  - Global  │                                            │
│  - Region  │                                            │
│  - Tasks   │                                            │
│            │                                            │
├────────────┴────────────────────────────────────────────┤
│ [Activity Feed - horizontal ticker]                     │
└─────────────────────────────────────────────────────────┘
```

**Mobile (<768px)**
```
┌─────────────────────┐
│ [≡] Nightfall [☀]   │
├─────────────────────┤
│                     │
│        MAP          │
│   (full viewport)   │
│                     │
├─────────────────────┤
│ [Global] [Region]   │  ← Tab bar
├─────────────────────┤
│                     │
│   BOTTOM SHEET      │
│   (draggable)       │
│                     │
└─────────────────────┘
```

**Current implementation (merged UI plan)**
- Map fills the viewport; header + metrics are rendered as map overlays.
- Desktop: floating panels for pools, health ring, task list, resource ticker, and attribution.
- Mobile: bottom sheet drawer retains the sidebar content.

### Day/Night Cycle UI

**Phase indicator (always visible)**
- Sun icon (☀) during dawn/day
- Moon icon (☽) during dusk/night
- Circular progress ring around icon showing phase progress
- Countdown text: "Day 3:42" or "Night 5:18"

**Phase transition alerts**
- Dusk: Amber banner "Nightfall in 2:00" with pulsing animation
- Night: Subtle red glow on UI edges
- Dawn: Warm yellow flash, brief "The sun rises" message

**Map color grading by phase**
```css
/* Applied as CSS filter or MapLibre style expression */
.map-container[data-phase="dawn"]  { filter: brightness(1.1) saturate(0.9); }
.map-container[data-phase="day"]   { filter: brightness(1.0) saturate(1.0); }
.map-container[data-phase="dusk"]  { filter: brightness(0.85) saturate(0.8) sepia(0.2); }
.map-container[data-phase="night"] { filter: brightness(0.6) saturate(0.5) sepia(0.3); }
```

### Map Interactions

**Touch targets**: Minimum 44x44px for all interactive elements.

**Feature selection**:
- Desktop: Hover shows tooltip (feature type, health, task status), click selects
- Mobile: Tap selects (no hover state)

**Gestures**:
- Pinch to zoom
- Two-finger pan
- Double-tap to zoom in
- Single tap on feature to select

**Selected feature panel**:
- Shows feature details (health, road class, rust level) and active task status
- Action buttons: "Vote Up" for active tasks
- Contribution buttons for resource-generating buildings (dispatch to hub)

### Map Layers

1. **Base**: Overture PMTiles layers (land use, water, transportation, buildings)
2. **Buildings**: Colored by generation type + hub glow
   - Gray: no generation
   - Blue: labor (offices, restaurants)
   - Orange: materials (industrial)
3. **Roads**: Colored by health + repair pulse
   - Green: 80-100
   - Yellow: 50-79
   - Orange: 30-49
   - Red: 0-29
4. **Tasks**: Queued/pending dashed outline + glow on target road segments
5. **Rust overlay**: H3 hexagons with semi-transparent amber/brown fill + breathing animation at dusk/night
6. **Crews**: Animated travel paths with moving markers
7. **Resource transfers**: Animated packages with path trails (arrive after travel delay)
8. **Hub marker**: Central hub ring for the region

### Rust Visual Treatment

**Hex overlay styling**
```javascript
// MapLibre paint expression
'fill-color': [
  'interpolate', ['linear'], ['get', 'rust_level'],
  0, 'rgba(139, 90, 43, 0)',      // Clear
  0.3, 'rgba(139, 90, 43, 0.2)',  // Light rust
  0.6, 'rgba(120, 60, 30, 0.4)',  // Medium rust
  0.9, 'rgba(80, 40, 20, 0.6)'    // Heavy rust
],
'fill-opacity': [
  'interpolate', ['linear'], ['var', 'phase_multiplier'],
  0.2, 0.5,  // Day: subtle
  1.0, 1.0   // Night: full intensity
]
```

**Affected roads texture**
- Health < 50: Add dashed pattern overlay
- Health < 30: Add crack texture, color shifts browner

### Sidebar Content (Desktop) / Bottom Sheet (Mobile)

**Global tab**:
- Day/night phase with progress ring
- World health gauge (avg road health)
- Total Rust coverage %
- Next reset countdown
- Active players (last 5 min)

**Region tab**:
- Region name and stats
- Resource pools (labor / materials bars)
- Crew status (idle / working)
- "Contribute" button

**Tasks tab**:
- Sorted by priority_score DESC
- Search + filter + sort controls for quick triage
- Each task shows:
  - Road name (if available) or "Road segment"
  - Road class icon
  - Health bar
  - Vote buttons with current score
  - ETA if active (adjusted for day/night)

### Activity Feed

Horizontal scrolling ticker (desktop, in-map overlay) or vertical list in sheet (mobile).

Event types:
- "A road in [Region] was repaired"
- "[Region] received contributions"
- "The Rust is spreading in [Region]"
- "Night has fallen" / "The sun rises"
- "Weekly reset in X hours"

---

## 12. Tech Stack

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Map**: MapLibre GL JS
- **State**: Zustand (lightweight, good for realtime updates)
- **Styling**: Tailwind CSS
- **Mobile**: Responsive design, no native app needed

### Backend
- **API**: Fastify service (`apps/api`)
- **Database**: PostgreSQL + PostGIS
- **Realtime**: Server-Sent Events (SSE) fed by Postgres LISTEN/NOTIFY
- **Tick loop**: Separate Node.js process (`apps/ticker`)

### Infrastructure
- **Hosting**: Fly.io
- **Database**: Fly Postgres (PostGIS for geo)
- **Tiles**: Overture PMTiles hosted on CDN; no application-side tile caching

### Recommended Fly setup
```
- fly-web (Next.js, 1-2 instances, auto-scale)
- fly-api (Fastify, 1 instance, always-on)
- fly-ticker (Node.js, 1 instance, always-on)
- fly-postgres (shared-cpu-1x, 1GB RAM minimum)
```

---

## 13. Data Ingest Pipeline

Run once per city, re-run on Overture updates.

### Step 1: Download Overture data

```bash
# Using DuckDB or overturemaps-py
# Bounding box for Boston: -71.19, 42.23, -70.92, 42.40

overturemaps download \
  --type=transportation/segment \
  --type=buildings/building \
  --type=places/place \
  --type=divisions/division \
  --type=base/water \
  --bbox=-71.19,42.23,-70.92,42.40 \
  -o boston_data/
```

### Step 2: Set up regions

Manual curation: select ~15-20 divisions that cover Boston neighborhoods.

```sql
INSERT INTO regions (region_id, name, boundary, center, distance_from_center)
SELECT 
  gers_id,
  names->>'primary' as name,
  geometry as boundary,
  ST_Centroid(geometry) as center,
  ST_Distance(
    ST_Centroid(geometry)::geography,
    ST_SetSRID(ST_MakePoint(-71.0589, 42.3601), 4326)::geography  -- Boston center
  ) as distance_from_center
FROM overture_divisions
WHERE gers_id IN (
  -- Manually curated list of neighborhood division gers_ids
  '08f2a100...',  -- Back Bay
  '08f2a101...',  -- Beacon Hill
  -- etc.
);
```

### Step 3: Generate H3 hexes

```sql
-- Using h3-pg extension
INSERT INTO hex_cells (h3_index, region_id, rust_level, distance_from_center)
SELECT DISTINCT ON (h3)
  h3_cell_to_boundary(h3)::text as h3_index,
  r.region_id,
  LEAST(0.3, dist / max_dist * 0.3) as rust_level,  -- Initial Rust (edges start rustier)
  dist as distance_from_center
FROM regions r,
LATERAL (
  SELECT h3_polygon_to_cells(r.boundary, 8) as h3  -- Resolution 8
) cells,
LATERAL (
  SELECT ST_Distance(
    h3_cell_to_boundary(h3)::geography,
    ST_SetSRID(ST_MakePoint(-71.0589, 42.3601), 4326)::geography
  ) as dist
) d,
(SELECT MAX(distance_from_center) as max_dist FROM regions) m;
```

### Step 4: Load roads

```sql
INSERT INTO world_features (gers_id, feature_type, region_id, h3_index, geom, properties, road_class)
SELECT
  t.gers_id,
  'road',
  r.region_id,
  h3_lat_lng_to_cell(ST_Y(ST_Centroid(t.geometry)), ST_X(ST_Centroid(t.geometry)), 8)::text,
  t.geometry,
  t.properties,
  t.properties->>'class'
FROM overture_transportation t
JOIN regions r ON ST_Intersects(t.geometry, r.boundary)
WHERE t.properties->>'subtype' = 'road';

-- Initialize state
INSERT INTO feature_state (gers_id, health, status)
SELECT gers_id, 70 + random() * 30, 'normal'
FROM world_features WHERE feature_type = 'road';
```

### Step 5: Load buildings with places

```sql
-- First, load all buildings
INSERT INTO world_features (gers_id, feature_type, region_id, h3_index, geom, properties)
SELECT
  b.gers_id,
  'building',
  r.region_id,
  h3_lat_lng_to_cell(ST_Y(ST_Centroid(b.geometry)), ST_X(ST_Centroid(b.geometry)), 8)::text,
  b.geometry,
  b.properties
FROM overture_buildings b
JOIN regions r ON ST_Intersects(b.geometry, r.boundary);

-- Then, join places to buildings and update categories
UPDATE world_features f
SET 
  place_category = p.categories->0->>'primary',
  generates_labor = p.categories->0->>'primary' IN ('restaurant', 'cafe', 'bar', 'office', 'retail', 'hospital', 'school'),
  generates_materials = p.categories->0->>'primary' IN ('industrial', 'factory', 'warehouse', 'construction')
FROM overture_places p
WHERE f.feature_type = 'building'
  AND ST_Contains(f.geom, p.geometry);
```

### Step 6: Initialize crews

```sql
INSERT INTO crews (region_id, status)
SELECT region_id, 'idle'
FROM regions
CROSS JOIN generate_series(1, 2);  -- 2 crews per region
```

---

## 14. Demo Mode

When enabled:
- Tick rate: 10x (1 tick per second instead of per 10 seconds)
- Cycle speed: 5x (4-minute full day/night cycle instead of 20 minutes)
- Bot players: Simulate 5-10 anonymous contributors
- Rust acceleration: Spreads faster to show mechanics
- UI indicator: "DEMO MODE" badge in corner

Activation:
```bash
curl -X POST https://nightfall.fly.dev/api/admin/demo-mode \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "tick_multiplier": 10, "cycle_speed": 5}'
```

Demo scenario script (10 minutes):

1. **0:00 - Dawn** (accelerated): Start with moderate Rust on outer regions, show the sun rising, Rust visibly receding
2. **0:45 - Day**: Resource generation peaks, crews actively repairing, show health bars climbing
3. **1:30 - Dusk**: Warning banner appears "Nightfall in 30 seconds", tension builds
4. **2:00 - Night**: Map darkens, Rust spreads visibly faster, decay accelerates
5. **3:00 - Critical moment**: One region's roads start going red, task queue fills up
6. **3:30 - Player action**: Simulate votes coming in, priorities shift, crews respond
7. **4:00 - Dawn returns**: Relief moment, Rust pulls back, repairs complete
8. **4:30+**: Loop continues, showing the rhythm

Key demo beats:
- Show the Rust visually spreading during night
- Show the relief when dawn comes
- Show player votes actually affecting which roads get fixed
- Show the crews as little animated icons doing work

---

## 15. Implementation Order

### Phase 1: Foundation (Week 1)
1. Set up Fly project (postgres, web app)
2. Create database schema (including cycle_state in world_meta)
3. Run Boston data ingest
4. Basic Next.js app with MapLibre showing roads

### Phase 2: Core Loop (Week 2)
5. Implement day/night cycle state machine
6. Implement tick loop (decay, generation, Rust spread with phase multipliers)
7. Task creation and priority calculation
8. Crew dispatch and task completion
9. SSE stream for deltas (including phase changes)

### Phase 3: Player Interaction (Week 3)
10. Player identity (localStorage client_id)
11. Home region selection
12. Contribution endpoint
13. Vote endpoint with decay

### Phase 4: UI Polish (Week 4)
14. Day/night visual transitions (map color grading, UI theme)
15. Phase indicator with countdown
16. Health heatmap layer
17. Rust overlay layer with animated grain
18. Responsive layout (mobile bottom sheet)
19. Activity feed

### Phase 5: Demo & Launch (Week 5)
20. Demo mode implementation (accelerated cycle)
21. Weekly reset cron job
22. Bot player simulation
23. Landing page and onboarding
24. "Nightfall in X:XX" urgency notifications

---

## 16. Open Questions / Future Ideas

- **Variable night length**: As the world degrades, nights get longer? ("The nights are getting longer" becomes literal)
- **Seasonal events**: Longer nights in winter, shorter in summer?
- **Eclipse events**: Rare full-darkness events with accelerated Rust?
- **Authentication**: Add optional login for persistent identity across devices?
- **Leaderboards**: Per-region contributor rankings?
- **Expansion**: Procedural city loading based on player interest?
- **Mobile app**: PWA first, native later if needed?
- **Sound design**: Ambient audio that shifts with day/night cycle?

---

## Appendix: Boston Region Candidates

Neighborhoods to consider for initial region set:

1. Back Bay
2. Beacon Hill
3. North End
4. South End
5. Fenway-Kenmore
6. Allston
7. Brighton
8. Jamaica Plain
9. Roxbury
10. Dorchester (may need to split)
11. South Boston
12. Charlestown
13. East Boston
14. Cambridge (if including across river)
15. Somerville (if including)

Start with 10-12 that have clear boundaries in Overture divisions data.
