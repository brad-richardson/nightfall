# Nightfall Build Plan

## Production Minigames
The minigame system is in place with KitchenRush implemented. Remaining minigames to build:

- [x] Fresh Check (Food): Conveyor sort minigame - swipe left/right to sort fresh vs spoiled ingredients
- [x] Gear Up (Equipment): Alignment minigame - drag spinning gear to mesh with fixed gear at right moment
- [x] Patch Job (Equipment): Tracing minigame - trace welding line along cracks before they spread
- [x] Power Up (Energy): Rhythm minigame - tap to spin generator, maintain RPM in sweet spot
- [x] Salvage Run (Materials): Timing windows minigame - hit action when oscillating marker is in clean zone

### Additional Minigame Ideas (Mario Party-inspired)
Energy and Materials currently only have one minigame each. Ideas for more variety:

**Energy minigames:**
- [ ] Surge Stopper: Whack-a-mole style - tap surging outlets before they overload
- [ ] Circuit Race: Connect wires in order before time runs out (like tracing a path)
- [ ] Turbine Spin: Rhythm game - tap to keep turbines spinning at optimal speed
- [ ] Solar Catcher: Move panels to catch moving sunbeams, avoid shadows
- [ ] Battery Bounce: Pong-like game bouncing energy between battery poles

**Materials minigames:**
- [ ] Lumber Stack: Jenga-style - carefully stack lumber without toppling
- [ ] Conveyor Sort: Sort falling materials onto correct conveyor belts
- [ ] Blueprint Match: Memory match pairs of construction materials
- [ ] Excavator Dig: Dig for buried materials, avoid hitting pipes/cables
- [ ] Pallet Tetris: Tetris-like game fitting materials onto pallets efficiently

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

## Technical Improvements
- [ ] Optimize SSE Payloads: Reduce crew_delta payload size by sending minimal waypoint data (e.g., simplified paths or just start/end with duration) instead of full coordinate arrays
- [ ] Investigate pulsing roads filter: Debug why repair-pulse layer may be matching too many roads (filter logic or stale state issue)

## Future Immersion & Polish (Post-MVP)
- [ ] Regional Broadcast Channels: Implement a second SSE channel per-region for real-time animations
- [ ] Map Performance: Implement clustering or advanced MapLibre styling for high feature density
- [ ] Soundscape: Add dynamic ambient audio that shifts with the day/night cycle
