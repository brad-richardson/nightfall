# Nightfall Build Plan

## Production Minigames
The minigame system is in place with KitchenRush implemented. Remaining minigames to build:

- [x] Fresh Check (Food): Conveyor sort minigame - swipe left/right to sort fresh vs spoiled ingredients
- [x] Gear Up (Equipment): Alignment minigame - drag spinning gear to mesh with fixed gear at right moment
- [ ] Patch Job (Equipment): Tracing minigame - trace welding line along cracks before they spread
- [x] Power Up (Energy): Rhythm minigame - tap to spin generator, maintain RPM in sweet spot
- [ ] Salvage Run (Materials): Timing windows minigame - hit action when oscillating marker is in clean zone

## Mechanics & Balancing
- [ ] Region Resizing: Reduce the default size of the active region area for tighter gameplay

## Player Scoring & Tier System
The basic scoring system and tier badges are implemented. Next steps for enhancement:

- [ ] Server-side score tracking: Move score tracking from localStorage to the database for persistence across devices
- [ ] Leaderboard UI: Build a full leaderboard component with pagination and filtering by region
- [ ] Apply tier bonuses server-side: Currently tier bonuses are displayed but not applied. Implement:
  - Resource bonus multiplier when contributing resources
  - Transfer speed bonus when calculating travel times
  - Emergency repair deploy ability (instant task completion)
- [ ] Tier-up notifications: Show celebratory animation/toast when player reaches a new tier
- [ ] Score for completed tasks: Award bonus points when tasks the player voted on are successfully completed
- [ ] Display name setting: Allow players to set a custom display name for leaderboard
- [ ] Region-specific leaderboards: Track and display scores per-region as well as global

## Future Immersion & Polish (Post-MVP)
- [ ] Regional Broadcast Channels: Implement a second SSE channel per-region for real-time animations
- [ ] Map Performance: Implement clustering or advanced MapLibre styling for high feature density
- [ ] Soundscape: Add dynamic ambient audio that shifts with the day/night cycle
