# M8 Native HUD Integration

Implemented:

1. Replaced floating debug overlay with native UI elements in `index.html`:
   - `#netHudNative` (topbar telemetry)
   - `#apexBanner` (current apex status)
   - `#territoryPanel` (zone controller/pressure summary)

2. Updated `world_client_bridge.js` to drive these native HUD components:
   - online/offline state
   - player ID, level/xp, hp, evolution count, player count
   - apex updates
   - territory updates + resource pressure notices

3. Kept existing replication controls and reconnect behavior:
   - movement sync
   - feed/combat test hooks
   - zone test hotkeys (1..4)

Outcome:
- Multiplayer/server telemetry now appears as part of the game HUD shell instead of an external floating debug card.
