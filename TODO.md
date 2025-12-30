# Nightfall Build Plan

## Production Minigames
All 6 production minigames are implemented:
- KitchenRush, FreshCheck, GearUp, PatchJob, PowerUp, CraneDrop

### Additional Minigame Ideas (Mario Party-inspired)
Ideas for more variety across resource types:

**Energy minigames:**
- [ ] Surge Stopper: Whack-a-mole style - tap surging outlets before they overload
- [ ] Circuit Race: Connect wires in order before time runs out (like tracing a path)
- [ ] Solar Catcher: Move panels to catch moving sunbeams, avoid shadows

**Materials minigames:**
- [ ] Lumber Stack: Jenga-style - carefully stack lumber without toppling
- [ ] Conveyor Sort: Sort falling materials onto correct conveyor belts
- [ ] Blueprint Match: Memory match pairs of construction materials

## Repair Minigames
3 repair minigames are implemented for player-initiated road repairs:
- PotholePatrol, RoadRoller, TrafficDirector

Ideas for more variety:
- [ ] Crack Sealer: Trace along road cracks to seal them before they spread
- [ ] Traffic Tapper: Whack-a-mole style - direct cars through construction zone

## Mechanics & Balancing
- [ ] Region Resizing: Reduce the default size of the active region area for tighter gameplay

## Player Scoring & Tier System
Server-side scoring is implemented with `player_scores` and `score_events` tables. 6 tiers defined (newcomer → legend) with tier badges displayed.

Still needed:
- [ ] Leaderboard UI: Build a full leaderboard component with pagination and filtering by region
- [ ] Apply tier bonuses server-side: Tier bonuses are defined but not yet applied to game mechanics:
  - Resource bonus multiplier when contributing resources
  - Transfer speed bonus when calculating travel times
  - Emergency repair deploy ability (instant task completion)
- [ ] Tier-up notifications: Show celebratory animation/toast when player reaches a new tier
- [ ] Display name setting: Allow players to set a custom display name for leaderboard
- [ ] Region-specific leaderboards: Track and display scores per-region as well as global

## Technical Improvements
- [ ] Optimize SSE Payloads: Reduce crew_delta payload size by sending minimal waypoint data (e.g., simplified paths or just start/end with duration) instead of full coordinate arrays
- [ ] Investigate pulsing roads filter: Debug why repair-pulse layer may be matching too many roads (filter logic or stale state issue)

## Future Immersion & Polish (Post-MVP)
- [ ] Regional Broadcast Channels: Implement a second SSE channel per-region for real-time animations
- [ ] Map Performance: Implement clustering or advanced MapLibre styling for high feature density
- [ ] Soundscape: Add dynamic ambient audio that shifts with the day/night cycle
