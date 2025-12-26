# Nightfall Build Plan

## Immediate Bug Fixes & Refinement
- [ ] Fix Event Streaming: Investigate why live/streaming updates stop after the initial connection.
- [ ] Fix Voting System: Ensure votes are correctly tallied and reflected in real-time.
- [ ] Fix Cycle Visuals: Resolve issue where the night/day transition visual gets stuck.
- [ ] Fix Region Health UI: Restore functionality to the region health display.
- [ ] Refactor Health Stats: Fold Network Health into Region Health and remove the redundant feature count.
- [ ] Prevent rust spread lost updates (transaction or update-in-DB strategy).
- [ ] Guard task spawn with locking to avoid duplicate degraded-road tasks.
- [ ] Clean up SSE listeners and add reconnect handling/backpressure strategy.

## UI/UX Polish
- [ ] Map Visibility: Reduce UI component sizes or increase translucency to minimize map obscuration.
- [ ] Add a MapLibre lifecycle test harness (Strict Mode mount/unmount) to catch map init regressions.
- [ ] Add a UI test that asserts map pan/zoom still work with overlays active (pointer-events guard).

## Mechanics & Balancing
- [ ] Contribution Minigame: Implement a quick interactive element when contributing resources.
- [ ] Contribution Limits: Add a daily/hourly limit on the number of times a user can contribute resources.
- [ ] Region Resizing: Reduce the default size of the active region area for tighter gameplay.
- [ ] Expanded Resources: Consider adding more resource types (e.g., Food, Equipment) beyond Labor and Materials.

## Security & Abuse Protection (Week 4-5)
- [ ] Re-enable CORS with explicit allowlist + tests once deployment targets are stable.

## Future Immersion & Polish (Post-MVP)
- [ ] Regional Broadcast Channels: Implement a second SSE channel per-region that broadcasts resource and crew movements specifically for real-time animations.
- [ ] Map Performance: Implement clustering or advanced MapLibre styling for high feature density.
- [ ] Soundscape: Add dynamic ambient audio that shifts with the day/night cycle.
- [ ] Real-time Feedback: Implement optimistic UI and animations (e.g., framer-motion) for user actions.
- [ ] Onboarding: Create a "How to Play" overlay for first-time users explaining mechanics.
