# Nightfall Build Plan

Working list to build the core loop and UI in a sensible order. Keep PRs small but feature-complete per bullet.

## Immediate (Week 1)
- [x] Project plumbing: shared Prettier config + format script; align TS paths/aliases; CI lint/build workflow.
- [x] Data layer: define schema migrations (regions, hex_cells, world_features, feature_state, tasks, votes, crews, players, events, world_meta). Decide migration tool (e.g., Prisma/Migrations or Kysely + dbmate).
- [x] Tick runner harness: standalone Node worker process with advisory lock and observability hooks (metrics/logging). Stub `tick()` with no-op steps.
- [x] API skeleton: health, version, `/api/hello` stub that creates/returns player row; basic error handler.

## Core Loop (Week 2)
- [x] Cycle state store + helper (phase/progress) backed by `world_meta`.
- [x] SSE phase_change event (ticker NOTIFY + API stream endpoint).
- [x] Rust mechanics: neighbor-driven spread, pushback, caps, day/night tuning.
- [x] Road decay + degraded status thresholds; task auto-spawn for degraded roads without active tasks.
- [x] Resource generation per building type; region pools accumulate per tick with phase multipliers.
- [x] Crew dispatch + task completion: respect repair speed multiplier by phase; update road state and rust pushback.
- [x] Vote decay and task priority calculation.

## World Data (Week 2-3)
- [x] Ingest pipeline for Boston: download Overture layers, curate regions list, generate H3 cells, load roads/buildings/places with joins, initialize state. Script + docs to rerun.
- [x] Seed/demo data for dev: lightweight fixture load to let frontend run without full ingest.

## API & Realtime (Week 3)
- [x] REST endpoints: world summary, region detail, features by bbox, hexes by bbox, contribute, vote, tasks detail, set-home.
- [x] SSE stream: world_delta, feature_delta, task_delta, feed_item, reset warnings.
- [x] Admin endpoints: demo mode toggle, set-phase, reset trigger; auth guard.

## Frontend (Week 3-4)
- [x] State/store setup + shared client for API/SSE; environment config.
- [x] MapLibre base with day/night grading, roads colored by health, buildings by generation type, rust hex overlay with animated grain.
- [x] UI chrome: header with phase indicator + countdown, region selector, responsive layout (sidebar/bottom sheet), activity feed ticker.
- [x] Interaction flows: feature selection panel, vote buttons, contribute action, task list sorted by priority with ETA, crews markers.
- [x] Mobile polish: gestures, touch targets, bottom sheet behavior.
- [x] Phase transition visuals: urgency banners, ambient glows, and countdowns.

## Operations & Reset (Week 4-5)
- [x] Weekly reset job (cron/Fly Machine) updating roads/rust/pools/tasks/crews; update world version/reset metadata and broadcast.
- [x] Demo mode: tick multiplier, cycle speed override, bot contributors for demos; visible badge in UI.
- [x] Observability: structured logging, basic metrics (tick duration, rust spread stats, task counts), alerting hooks.

## Security & Abuse Protection (Week 4-5)
- [x] Request rate limiting: per-IP and per-client limits for /api/hello, /api/contribute, /api/vote, /api/stream.
- [x] SSE connection caps + reconnect backoff guidance to avoid reconnect storms.
- [x] Abuse guardrails: tighten payload size/validation, enforce quotas, and log suspicious patterns.
- [x] Admin endpoint hardening: secret rotation, optional allowlist, audit events for changes.
- [ ] Re-enable CORS with explicit allowlist + tests once deployment targets are stable.

## Attribution & Compliance
- [x] Add in-product attribution for Overture Maps and upstream sources; include in docs/landing page.
- [x] License/NOTICE updates as needed for data and dependencies.

## Code Review Follow-ups
- [x] Fix NOTIFY payloads to use pg_notify(channel, payload).
- [x] Add auth/verification for client_id (prevent impersonation on all endpoints).
- [x] Wrap tick loop in a transaction/locking strategy to avoid multi-ticker races.
- [x] Make vote score updates atomic (lock row or update in one statement).
- [x] Close contribution limit bypass with row locks or constraints.
- [ ] Prevent rust spread lost updates (transaction or update-in-DB strategy).
- [ ] Guard task spawn with locking to avoid duplicate degraded-road tasks.
- [ ] Clean up SSE listeners and add reconnect handling/backpressure strategy.
- [x] Ensure consistent phase multipliers within a tick (snapshot once per tick).

## Future Immersion & Polish (Post-MVP)
- [ ] Map Performance: Implement clustering or advanced MapLibre styling for high feature density.
- [ ] Soundscape: Add dynamic ambient audio that shifts with the day/night cycle.
- [ ] Real-time Feedback: Implement optimistic UI and animations (e.g., framer-motion) for user actions.
- [ ] Onboarding: Create a "How to Play" overlay for first-time users explaining mechanics.
