# Nightfall Build Plan

Working list to build the core loop and UI in a sensible order. Keep PRs small but feature-complete per bullet.

## Immediate (Week 1)
- Project plumbing: shared Prettier config + format script; align TS paths/aliases; CI lint/build workflow.
- Data layer: define schema migrations (regions, hex_cells, world_features, feature_state, tasks, votes, crews, players, events, world_meta). Decide migration tool (e.g., Prisma/Migrations or Kysely + dbmate).
- Tick runner harness: standalone Node worker process with advisory lock and observability hooks (metrics/logging). Stub `tick()` with no-op steps.
- API skeleton: health, version, `/api/hello` stub that creates/returns player row; basic error handler.

## Core Loop (Week 2)
- Implement cycle state store (day/night) in DB (`world_meta`) and helper to compute current phase + progress; SSE event for phase change.
- Rust mechanics: hex rust spread/reduction per tick, capped, distance-aware.
- Road decay + degraded status thresholds; task auto-spawn for degraded roads without active tasks.
- Resource generation per building type; region pools accumulate per tick with phase multipliers.
- Crew dispatch + task completion: respect repair speed multiplier by phase; update road state and rust pushback.
- Vote decay and task priority calculation.

## World Data (Week 2-3)
- Ingest pipeline for Boston: download Overture layers, curate regions list, generate H3 cells, load roads/buildings/places with joins, initialize state. Script + docs to rerun.
- Seed/demo data for dev: lightweight fixture load to let frontend run without full ingest.

## API & Realtime (Week 3)
- REST endpoints: world summary, region detail, features by bbox, hexes by bbox, contribute, vote, tasks detail, set-home.
- SSE stream: phase_change, world_delta, feature_delta, task_delta, feed_item, reset warnings.
- Admin endpoints: demo mode toggle, set-phase, reset trigger; auth guard.

## Frontend (Week 3-4)
- State/store setup (Zustand) + shared client for API/SSE; environment config.
- MapLibre base with day/night grading, roads colored by health, buildings by generation type, rust hex overlay with animated grain.
- UI chrome: header with phase indicator + countdown, region selector, responsive layout (sidebar/bottom sheet), activity feed ticker.
- Interaction flows: feature selection panel, vote buttons, contribute action, task list sorted by priority with ETA, crews markers.
- Mobile polish: gestures, touch targets, bottom sheet behavior.

## Operations & Reset (Week 4-5)
- Weekly reset job (cron/Fly Machine) updating roads/rust/pools/tasks/crews; update world version/reset metadata and broadcast.
- Demo mode: tick multiplier, cycle speed override, bot contributors for demos; visible badge in UI.
- Observability: structured logging, basic metrics (tick duration, rust spread stats, task counts), alerting hooks.

## Attribution & Compliance
- Add in-product attribution for Overture Maps and upstream sources; include in docs/landing page.
- License/NOTICE updates as needed for data and dependencies.
