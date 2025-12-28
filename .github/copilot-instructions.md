# GitHub Copilot Instructions for Nightfall

## Project Overview

Nightfall is a persistent city-scale infrastructure sim built as a monorepo with pnpm workspaces:
- `apps/web` — Next.js App Router frontend (MapLibre GL, Tailwind, Zustand)
- `apps/api` — Fastify API server with SSE for realtime updates
- `apps/ticker` — Node.js tick worker (game loop, decay, resource generation)
- `packages/*` — Shared libraries (pathfinding, config, ingest)

## Code Review Focus Areas

### Security

- **Never expose secrets via `NEXT_PUBLIC_`** — Environment variables prefixed with `NEXT_PUBLIC_` are bundled into client JavaScript. Admin secrets, API keys, and database credentials must only be used server-side.
- **Validate admin endpoints** — All `/api/admin/*` routes must verify `ADMIN_SECRET` header.
- **Sanitize user inputs** — Flag raw SQL queries without parameterization and unescaped user content in rendered output.

### Resource Constraints

This application runs on a very small machine with limited CPU and memory:
- Flag heavy in-memory caches or large data structures
- Avoid unbounded loops or recursive operations without limits
- Prefer streaming over loading entire datasets into memory
- Watch for N+1 query patterns in database operations

### React & Frontend Patterns

- **Async cleanup in effects** — Async operations in useEffect must track mounted state to prevent updates on unmounted components
- **Missing dependencies** — useEffect, useCallback, and useMemo must include all referenced variables in dependency arrays
- **Cleanup functions** — Effects with subscriptions, timers, or event listeners need proper cleanup
- **Accessibility** — Interactive elements need keyboard support (onKeyDown handlers) and ARIA attributes

### Database & API

- **Verify rowCount** — UPDATE and DELETE operations should check `result.rowCount` to confirm expected rows were affected
- **Migrations must be reversible** — Avoid destructive schema changes; provide rollback capability
- **Advisory locks** — Ticker operations use Postgres advisory locks to prevent duplicate processing
- **SSE patterns** — Feature deltas should use threshold-based filtering to avoid flooding clients with minor changes

### Testing

- **Tests must verify actual behavior** — Don't just mock filtered results; test that filtering logic works correctly
- **Cover edge cases** — Zero values, boundary conditions, empty arrays, null inputs
- **Test cleanup and error paths** — Not just happy paths
- **Update tests when behavior changes** — Tests should accompany all behavior modifications

### Code Quality

- **Avoid configuration drift** — Import shared constants from `packages/config` instead of hardcoding values that exist elsewhere
- **Reduce duplication** — Extract repeated patterns (like authorization headers) into shared utilities
- **Consistent error handling** — Use appropriate HTTP status codes and error messages
- **SVG structure** — Place `<defs>` elements at the beginning of SVG markup, before elements that reference them

### Pull Request Standards

- Prefer small, focused PRs that include code, tests, and necessary docs
- PR descriptions should explain the "why" not just the "what"
- Breaking changes need migration guidance
- UI changes should consider mobile viewports

## Commands Reference

```bash
pnpm test        # Run all tests (db + unit + UI)
pnpm test:unit   # Run unit tests only
pnpm lint        # Lint all packages
pnpm build       # Build all packages
```
