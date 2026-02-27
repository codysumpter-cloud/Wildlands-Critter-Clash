# DEMO_SCRIPT.md — Reboot PvP Foundation

## Demo setup (local)
1. Terminal A:
   - `npm run world:server`
2. Terminal B:
   - `python -m http.server 8000` (or `start_server_windows.bat`)
3. Open two browser windows to:
   - `http://127.0.0.1:8000/PLAY_WILDLANDS.html`

## Demo flow

1. **Connect + spawn**
   - Confirm NET is ONLINE
   - Confirm player IDs appear

2. **Darwin progression**
   - Press `F` to feed XP
   - Observe level/xp updates
   - Confirm evolution draft/chosen events reflected

3. **Combat loop**
   - Press `H` for combat XP
   - Press `K` to force damage/death path
   - Confirm respawn event after timer

4. **Territory + Apex**
   - Use `1..4` to switch zones
   - Observe territory panel updates
   - Observe apex banner changes based on score/level/xp

5. **Reconnect persistence**
   - Refresh one client tab
   - Confirm rejoin keeps level/evolutions (token-based resume)

## Validation commands
- `npm run world:smoke`
- `npm run world:soak`
- `npm run play:pack:zip`
