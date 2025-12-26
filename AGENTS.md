# Nightfall Engineering Practices

- Always add or update tests alongside behavior changes. If a change is hard to test, document why and add a follow-up task.
- Run the full test suite before shipping: `npm run test` (db + unit + UI).
- Keep migrations additive and reversible; avoid destructive changes without explicit review.
- Prefer small, focused PRs that include code, tests, and any necessary docs.
- When touching API behavior, update `scripts/check-db.mjs` or relevant test fixtures as needed.
- This runs on a very small machine (low CPU + memory); design for minimal resource usage and avoid heavy in-memory caches or background work.
