# M2_WORLD.md — Server World Skeleton

Implemented in this milestone:

## 1) Zone graph + resource ticks
- `server-world/world-server.js`
- Built-in zone graph with 4 connected biomes
- Resource regen tick every 1s per zone

## 2) Player state replication
- Server-authoritative player map
- Input messages (`dx`,`dy`) update velocity
- Simulation tick (100ms) updates positions
- Broadcast state deltas every 250ms

## 3) Reconnect/resync behavior
- Reconnect token issued on first join
- Rejoin path validates `playerId + reconnectToken`
- Ghost retention window: 60s
- Explicit `resync` message returns full snapshot

## Validation
- `npm run world:smoke` passes (join, state delta, reconnect+resync)
