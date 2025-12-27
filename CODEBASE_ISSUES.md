# Nightfall Codebase Issues - Prioritized Review

This document contains a prioritized list of issues found in the codebase, including items from `TODO.md` and additional concerns discovered during code review.

---

## Priority 1: Critical Bugs (Blocking Gameplay)

### 1.1 Event Streaming Stops After Initial Connection ✅ FIXED
**Location:** `apps/api/src/event-stream.ts`, `apps/web/app/hooks/useEventStream.ts`
**Issue:** Live/streaming updates stop after initial connection, breaking real-time gameplay.
**Root Cause Analysis:**
- The `event-stream.ts:39` only starts listening when first SSE client connects, but doesn't handle reconnection of the shared PostgreSQL client
- No error recovery if the DB connection drops - the `client.on("error")` handler only logs, doesn't reconnect
- The `useEventStream.ts` has retry logic but maxes out at 10 retries

**Fix Applied:**
- ✅ Added reconnection logic in `createDbEventStream` when the PostgreSQL client disconnects or errors
- ✅ Implemented 30-second heartbeat with `SELECT 1` to detect stale connections (skips if already reconnecting)
- ✅ Added cleanup function that properly clears `listening` flag and releases resources
- ✅ Added `end` event handler to trigger reconnection on connection loss
- ✅ Exponential backoff for reconnection attempts (2^n * 1000ms, capped at 30 seconds)
- ✅ Reconnection guard to prevent concurrent reconnection attempts
- ✅ Maximum retry limit of 10 attempts to prevent infinite reconnection loops
- ✅ Resets retry counter on successful reconnection

### 1.2 Rust Spread Lost Updates (Race Condition) ✅ FIXED
**Location:** `apps/ticker/src/rust.ts:145-159`
**Issue:** Concurrent ticker runs can cause lost updates during rust spread calculations.
**Details:** The current `UPDATE ... WHERE ... IS DISTINCT FROM` pattern doesn't prevent read-modify-write race conditions when multiple ticker instances run (even with advisory locks, edge cases exist).

**Fix Applied:**
- ✅ Added `SELECT FOR UPDATE` on hex_cells to lock rows during rust spread processing
- This prevents concurrent ticker instances from processing the same data simultaneously

### 1.3 Voting System Not Reflecting in Real-Time ✅ FIXED
**Location:** `apps/api/src/server.ts:1124-1243`
**Issue:** Votes may not be correctly tallied and reflected in real-time.
**Analysis:** The `pg_notify('task_delta', ...)` call at line 1233 occurs after COMMIT, but only if `updatedTask.rows[0]` exists. If the UPDATE doesn't return rows (which can happen if the JOIN fails), no notification is sent.

**Fix Applied:**
- ✅ Changed `JOIN feature_state` to `LEFT JOIN feature_state` to handle missing feature state rows
- ✅ Added `COALESCE(fs.health, 100)` to handle null health values gracefully
- ✅ Added fallback query to fetch task details if UPDATE doesn't return rows (within transaction boundary)
- ✅ Moved fallback query before COMMIT to maintain transaction integrity
- ✅ Ensured notification is always sent after successful vote recording

### 1.4 Cycle Visuals Get Stuck ✅ FIXED
**Location:** `apps/web/app/components/PhaseIndicator.tsx`, `apps/web/app/store.ts`
**Issue:** Night/day transition visual gets stuck.
**Root Cause:** The `phase_progress` update from SSE might not trigger re-render if value is the same, or the cycle state from initial hydration conflicts with SSE updates.

**Fix Applied:**
- ✅ Added `lastUpdated` timestamp field to `CycleState` type
- ✅ Dashboard now sets `lastUpdated: Date.now()` on every `phase_change` event to force new object reference
- ✅ PhaseIndicator useEffect now depends on `cycle.lastUpdated` to ensure re-renders

---

## Priority 2: UI Architecture Issues

### 2.1 Duplicate State in Dashboard vs Store ✅ FIXED
**Location:** `apps/web/app/components/Dashboard.tsx:197-210`
**Issue:** Props were hydrated into store on mount, but components also received props, creating potential for state mismatch.
**Fix Applied:** Now uses "store-only" pattern:
- `useLayoutEffect` with `hasHydratedRef` ensures hydration happens exactly once (survives React strict mode)
- `initial*` props are used ONLY for hydration, never read directly elsewhere
- All component reads come from store via `useStore((state) => state.xxx)`
- SSE updates write to store, component reads from store - single source of truth

### 2.2 Unused `refreshRegionData` Function ✅ FIXED
**Location:** `apps/web/app/components/Dashboard.tsx:256`
**Issue:** `refreshRegionData` is defined but never called (marked with eslint-disable). This appears to be dead code or an incomplete feature.
**Fix Applied:** Function was removed in commit b69647b as part of panel cleanup.

### 2.3 Feature Panel Positioning Logic Is Fragile ✅ FIXED
**Location:** `apps/web/app/components/FeaturePanel.tsx:53-79`
**Issue:** Panel positioning relies on `useLayoutEffect` and window dimensions, but doesn't account for viewport changes.
**Fix Applied:** Already has resize and orientation change listeners (lines 103-104) that trigger repositioning.

### 2.4 Activity Feed Shows "No Recent Activity" Indefinitely ✅ FIXED
**Location:** `apps/web/app/components/ActivityFeed.tsx`
**Issue:** Feed only populates from `nightfall:feed_item` CustomEvents. If no events arrive (due to SSE issues), the feed appears dead.
**Fix Applied:** Already shows connection status indicator and has 60-second stale detection (lines 57-66).

### 2.5 Map Component Is Very Large (1800+ lines) ✅ FIXED
**Location:** `apps/web/app/components/DemoMap.tsx`
**Issue:** Single file handling all map functionality.
**Fix Applied:** Refactored from 1834 lines to ~982 lines (46% reduction) by extracting modules to `apps/web/app/components/map/`:
- `types.ts` - Feature, Crew, Task, Hex, CrewPath, etc.
- `layers.ts` - MapLibre layer configurations
- `utils.ts` - Utility functions (getFeatureCenter, normalizePercent, etc.)
- `mapConfig.ts` - Colors and constants
- `index.ts` - Re-exports

### 2.6 Mobile Sidebar vs Desktop Layout Duplication
**Location:** `apps/web/app/components/Dashboard.tsx:546-605`, `apps/web/app/components/MobileSidebar.tsx`
**Issue:** `SidebarContent` component is rendered differently for mobile vs desktop, leading to:
- Duplicate code paths
- Different component hierarchies
- Potential for UI drift between platforms

---

## Priority 3: Data Consistency & Race Conditions

### 3.1 Task Spawn Race Condition
**Location:** `apps/ticker/src/tasks.ts:7-87`
**Issue:** `spawnDegradedRoadTasks` can create duplicate tasks if called concurrently.
**Details:** The `NOT EXISTS` check at lines 65-70 isn't atomic with the INSERT.
**Fix Needed:** Use `INSERT ... ON CONFLICT DO NOTHING` with unique constraint on `(target_gers_id, status)` or use advisory locks per road.

### 3.2 SSE Client Count Inaccuracy
**Location:** `apps/api/src/server.ts:288, 364-370`
**Issue:** `sseClients` counter is incremented on connection but may not always be decremented:
- If `eventStream.start()` throws after increment
- Race conditions on cleanup
**Fix Needed:** Use try/finally pattern consistently, or use a Set of client IDs.

### 3.3 Resource Transfer Timing Issues
**Location:** `apps/ticker/src/resources.ts`
**Issue:** Resource transfers depend on clock synchronization between API and Ticker. If clocks drift, transfers can arrive early/late or be processed twice.

---

## Priority 4: Type Safety & Code Quality

### 4.1 Multiple `eslint-disable` for `@typescript-eslint/no-explicit-any`
**Locations:**
- `apps/web/app/hooks/useEventStream.test.tsx:39-40`
- `apps/web/app/components/DemoMap.tsx:1400, 1474-1475, 1787`
- `scripts/ingest/src/index.ts:993, 1014, 1057, 1133, 1192, 1199`

**Impact:** Type safety gaps that could cause runtime errors.

### 4.2 Unsafe Type Casts in Ingest Script
**Location:** `scripts/ingest/src/index.ts`
**Issue:** Multiple `any` casts for building/road data processing:
```typescript
chunk.forEach((b: any, idx: number) => {
```
**Fix Needed:** Define proper types for Overture data structures.

### 4.3 Unchecked Query Parameters
**Location:** `apps/api/src/server.ts:535, 639, 712`
**Issue:** Query parameters cast directly without validation:
```typescript
const regionId = (request.params as { region_id: string }).region_id;
```
**Fix Needed:** Add Fastify JSON Schema validation.

---

## Priority 5: Security Concerns

### 5.1 CORS Disabled Pending Stabilization
**Location:** `TODO.md:25`
**Issue:** CORS is currently disabled; needs explicit allowlist + tests.
**Risk:** Cross-origin attacks possible in current state.

### 5.2 Admin Secret Validation Timing
**Location:** `apps/api/src/server.ts:189-206`
**Status:** Good - Already uses `timingSafeEqual` for admin secret verification.

### 5.3 SQL Injection via Road Class Names
**Location:** `apps/api/src/server.ts:1151-1153`, `apps/ticker/src/tasks.ts:8-23`
**Issue:** Road class names from config are interpolated directly into SQL:
```typescript
.map(([cls, info]) => `WHEN '${cls}' THEN ${info.priorityWeight}`)
```
**Risk:** If `ROAD_CLASSES` keys contain special characters, SQL injection is possible.
**Fix Needed:** Use parameterized queries or validate road class names match `/^[a-z_]+$/`.

### 5.4 JWT Secret Validation Only in Production
**Location:** `apps/api/src/config.ts:16`
**Issue:** The default secret is only blocked in production:
```typescript
(val) => process.env.NODE_ENV !== 'production' || val !== 'dev-secret-do-not-use-in-prod'
```
**Recommendation:** Warn in all non-test environments.

---

## Priority 6: Testing Gaps

### 6.1 Missing E2E Tests for Core Flows
**Current Coverage:**
- `tests/map-interactions.spec.ts` - Basic map tests
- `tests/map-lifecycle.spec.ts` - Lifecycle tests

**Missing:**
- Voting flow E2E test
- Contribution flow E2E test
- Full SSE event handling test
- World reset flow test
- Multi-region switching test

### 6.2 No Integration Tests for Ticker + API
**Issue:** Ticker and API are tested in isolation. No tests verify:
- Ticker publishes events that API correctly streams
- Resource transfer lifecycle from contribution to arrival
- Task completion updating feature state

### 6.3 Missing Tests for Error Paths
**Issue:** Happy path coverage is good, but edge cases lack tests:
- Database connection failures
- SSE reconnection scenarios
- Rate limiting behavior
- Invalid Overture data handling

---

## Priority 7: Performance Concerns

### 7.1 Map Performance at Scale
**Location:** `TODO.md:29`
**Issue:** No clustering or advanced styling for high feature density.
**Impact:** Performance degrades with many roads/buildings visible.

### 7.2 Full Feature Reload on Bbox Change
**Location:** `apps/web/app/components/Dashboard.tsx:223-237`
**Issue:** Every bbox change triggers full feature fetch.
**Fix Needed:** Implement incremental loading or spatial caching.

### 7.3 Hex Updates Process All Cells
**Location:** `apps/ticker/src/rust.ts:94-96`
**Issue:** `applyRustSpread` fetches ALL hex cells on every tick:
```typescript
"SELECT h3_index, rust_level, distance_from_center FROM hex_cells"
```
**Impact:** Scales poorly with region size.
**Fix Needed:** Limit to cells that actually need updates (neighbors of rust > 0).

---

## Priority 8: Architecture Improvements

### 8.1 SSE Backpressure Strategy Missing
**Location:** `TODO.md:11`
**Issue:** No handling for slow clients or event backlog.
**Impact:** Memory can grow unbounded if clients can't keep up.

### 8.2 No Health Check for Ticker
**Issue:** API has `/health` and `/health/db` endpoints, but Ticker has no way to report its status.
**Impact:** Difficult to monitor if ticker is running and processing.
**Fix Needed:** Add Ticker health reporting (could write to `world_meta`).

### 8.3 Configuration Scattered Across Files
**Locations:**
- `packages/config/src/index.ts` - Shared config
- `apps/api/src/config.ts` - API config
- `apps/ticker/src/config.ts` - Ticker config
- Various `process.env` reads in code

**Fix Needed:** Centralize all configuration with validation.

---

## Priority 9: Future Enhancements (from TODO.md)

### Gameplay
- [ ] Contribution Minigame - Interactive element when contributing
- [ ] Contribution Limits - Daily/hourly contribution caps
- [ ] Region Resizing - Reduce active region size
- [ ] Expanded Resources - Food, Equipment resource types

### Immersion
- [ ] Regional Broadcast Channels - Per-region SSE for animations
- [ ] Soundscape - Dynamic ambient audio for day/night
- [ ] Real-time Feedback - Optimistic UI with framer-motion
- [ ] Onboarding - "How to Play" overlay

### Completed (from TODO.md)
- [x] Map Visibility - Reduced UI component sizes
- [x] MapLibre lifecycle test harness
- [x] UI test for map pan/zoom with overlays

---

## Summary by Priority

| Priority | Count | Category |
|----------|-------|----------|
| P1 | 4 | Critical Bugs |
| P2 | 6 | UI Architecture |
| P3 | 3 | Data Consistency |
| P4 | 3 | Type Safety |
| P5 | 4 | Security |
| P6 | 3 | Testing Gaps |
| P7 | 3 | Performance |
| P8 | 3 | Architecture |
| P9 | 8 | Future Enhancements |

**Total Issues Identified:** 37

---

## Recommended Action Order

1. ✅ **Fix SSE reliability** (P1.1) - FIXED
2. **Add CORS allowlist** (P5.1) - Security vulnerability
3. ✅ **Fix voting real-time updates** (P1.3) - FIXED
4. **Add task spawn locking** (P3.1) - Prevents duplicate tasks
5. ✅ **Refactor DemoMap.tsx** (P2.5) - FIXED (46% size reduction)
6. **Add integration tests** (P6.2) - Prevents regressions
