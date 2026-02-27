# M7 Client Hookup (Playable)

Implemented:

1. In-game world-server hookup (`world_client_bridge.js`)
   - Connects to `ws://127.0.0.1:8799`
   - Joins/rejoins using reconnect token
   - Receives snapshot/state/apex/territory updates

2. Live Darwin HUD fields in client overlay
   - level/xp/hp/evolution count
   - player count
   - apex current leader
   - territory summary

3. Input replication bridge
   - Sends movement input (`input`) continuously
   - Test hooks:
     - `F` feed XP
     - `H` combat XP
     - `K` self-damage test
     - `1..4` zone move for territory objective

4. Basic two-player local test checklist
   - Open two browser windows to game page
   - Confirm two unique player IDs in HUD
   - Move both players (WASD)
   - Trigger feed/evolution with `F`
   - Trigger territory updates with `1..4`
   - Confirm apex updates in both windows

Notes:
- This is a bridge layer; deeper render-authoritative multiplayer visuals can be folded into core client systems in a follow-up milestone.
