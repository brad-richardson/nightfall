# Nightfall Build Plan

## Code Review Follow-ups
- [ ] Prevent rust spread lost updates (transaction or update-in-DB strategy).
- [ ] Guard task spawn with locking to avoid duplicate degraded-road tasks.
- [ ] Clean up SSE listeners and add reconnect handling/backpressure strategy.
- [ ] Add a MapLibre lifecycle test harness (Strict Mode mount/unmount) to catch map init regressions.
- [ ] Add a UI test that asserts map pan/zoom still work with overlays active (pointer-events guard).

## Security & Abuse Protection (Week 4-5)
- [ ] Re-enable CORS with explicit allowlist + tests once deployment targets are stable.

## Future Immersion & Polish (Post-MVP)
- [ ] Regional Broadcast Channels: Implement a second SSE channel per-region that broadcasts resource and crew movements specifically for real-time animations.
- [ ] Map Performance: Implement clustering or advanced MapLibre styling for high feature density.
- [ ] Soundscape: Add dynamic ambient audio that shifts with the day/night cycle.
- [ ] Real-time Feedback: Implement optimistic UI and animations (e.g., framer-motion) for user actions.
- [ ] Onboarding: Create a "How to Play" overlay for first-time users explaining mechanics.
