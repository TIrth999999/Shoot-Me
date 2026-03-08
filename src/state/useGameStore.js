import { create } from "zustand";
import { DEFAULTS } from "../game/constants";
import { ZOMBIE_TYPES } from "../game/zombieTypes";

const REBASE_EPS = 1e-6;

const blankWorldOffset = () => ({ x: 0, y: 0, z: 0 });

const normalizeWorldOffset = (value, fallback = blankWorldOffset()) => ({
  x: Number.isFinite(value?.x) ? value.x : fallback.x ?? 0,
  y: Number.isFinite(value?.y) ? value.y : fallback.y ?? 0,
  z: Number.isFinite(value?.z) ? value.z : fallback.z ?? 0
});

const computeOffsetDelta = (nextOffset, prevOffset) => ({
  x: (nextOffset?.x ?? 0) - (prevOffset?.x ?? 0),
  y: (nextOffset?.y ?? 0) - (prevOffset?.y ?? 0),
  z: (nextOffset?.z ?? 0) - (prevOffset?.z ?? 0)
});

const hasOffsetDelta = (delta) =>
  Math.abs(delta?.x || 0) > REBASE_EPS ||
  Math.abs(delta?.y || 0) > REBASE_EPS ||
  Math.abs(delta?.z || 0) > REBASE_EPS;

const shiftPosition = (position, delta) => {
  if (!position) return position;
  return {
    ...position,
    x: (position.x || 0) + (delta?.x || 0),
    y: (position.y || 0) + (delta?.y || 0),
    z: (position.z || 0) + (delta?.z || 0)
  };
};

const shiftSampleList = (samples, delta) =>
  Array.isArray(samples)
    ? samples.map((sample) => ({
        ...sample,
        position: shiftPosition(sample?.position, delta)
      }))
    : samples;

const shiftPlayersMap = (players, delta) => {
  const shifted = {};
  for (const [id, player] of Object.entries(players || {})) {
    shifted[id] = {
      ...player,
      position: shiftPosition(player?.position, delta),
      serverPosition: shiftPosition(player?.serverPosition, delta),
      netSamples: shiftSampleList(player?.netSamples, delta)
    };
  }
  return shifted;
};

const shiftZombiesMap = (zombies, delta) => {
  const shifted = {};
  for (const [id, zombie] of Object.entries(zombies || {})) {
    shifted[id] = {
      ...zombie,
      position: shiftPosition(zombie?.position, delta),
      netSamples: shiftSampleList(zombie?.netSamples, delta)
    };
  }
  return shifted;
};

const blankPlayer = () => ({
  position: { x: 0, y: 0, z: 0 },
  rotation: { yaw: 0 },
  hp: DEFAULTS.playerHp,
  score: 0,
  isDead: false,
  ping: 0
});

const blankCombat = () => ({
  mag: DEFAULTS.weaponMagSize,
  reserve: DEFAULTS.weaponReserveStart,
  magSize: DEFAULTS.weaponMagSize,
  reloadMs: DEFAULTS.weaponReloadMs,
  isReloading: false
});

export const useGameStore = create((set, get) => ({
  mode: "menu",
  netMode: "solo",
  connection: "disconnected",
  roomId: null,
  selfId: "local",
  rooms: [],
  error: null,
  gameOver: false,
  gameTime: 0,
  spawnRateSec: 2.5,
  terrainSeed: DEFAULTS.terrainSeed,
  worldOriginOffset: blankWorldOffset(),
  zombieScales: {
    [ZOMBIE_TYPES.SKINNER]: 0.035,
    [ZOMBIE_TYPES.ZOMBIE_DOG]: 0.0003,
    [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: 0.13,
    [ZOMBIE_TYPES.SKINNER_FRIENDLY]: 0.035
  },
  combat: blankCombat(),
  players: { local: blankPlayer() },
  zombies: {},
  localSeq: 0,
  damageKick: 0,
  setMode: (mode) => set({ mode }),
  setNetMode: (netMode) => set({ netMode }),
  setConnection: (connection) => set({ connection }),
  setRoomId: (roomId) => set({ roomId }),
  setRooms: (rooms) => set({ rooms }),
  setError: (error) => set({ error }),
  setTerrainSeed: (terrainSeed) =>
    set((s) => ({
      terrainSeed: Number.isFinite(terrainSeed) ? terrainSeed : s.terrainSeed
    })),
  setWorldOriginOffset: (worldOriginOffset) =>
    set((s) => ({
      worldOriginOffset: normalizeWorldOffset(worldOriginOffset, s.worldOriginOffset)
    })),
  applyWorldRebase: ({ delta, worldOriginOffset } = {}) => {
    let emittedDelta = null;
    set((s) => {
      const appliedDelta = {
        x: Number.isFinite(delta?.x) ? delta.x : 0,
        y: Number.isFinite(delta?.y) ? delta.y : 0,
        z: Number.isFinite(delta?.z) ? delta.z : 0
      };
      const nextOffset = worldOriginOffset
        ? normalizeWorldOffset(worldOriginOffset, s.worldOriginOffset)
        : {
            x: s.worldOriginOffset.x + appliedDelta.x,
            y: s.worldOriginOffset.y + appliedDelta.y,
            z: s.worldOriginOffset.z + appliedDelta.z
          };

      if (!hasOffsetDelta(appliedDelta)) {
        return { worldOriginOffset: nextOffset };
      }
      emittedDelta = appliedDelta;

      return {
        worldOriginOffset: nextOffset,
        players: shiftPlayersMap(s.players, appliedDelta),
        zombies: shiftZombiesMap(s.zombies, appliedDelta)
      };
    });
    if (
      emittedDelta &&
      typeof window !== "undefined" &&
      (Math.abs(emittedDelta.x) > REBASE_EPS ||
        Math.abs(emittedDelta.y) > REBASE_EPS ||
        Math.abs(emittedDelta.z) > REBASE_EPS)
    ) {
      window.dispatchEvent(new CustomEvent("world_rebase", { detail: { delta: emittedDelta } }));
    }
  },
  touchDamageKick: () => set((s) => ({ damageKick: s.damageKick + 1 })),
  purgeZombie: (zombieId) =>
    set((s) => {
      if (!s.zombies[zombieId]) return s;
      const next = { ...s.zombies };
      delete next[zombieId];
      return { zombies: next };
    }),
  resetSession: () =>
    set({
      gameOver: false,
      gameTime: 0,
      spawnRateSec: 2.5,
      combat: blankCombat(),
      players: { [get().selfId || "local"]: blankPlayer() },
      zombies: {},
      localSeq: 0,
      worldOriginOffset: blankWorldOffset()
    }),
  consumeLocalAmmo: () =>
    set((s) => {
      const combat = s.combat || blankCombat();
      if (combat.isReloading || combat.mag <= 0) return s;
      return {
        combat: {
          ...combat,
          mag: combat.mag - 1
        }
      };
    }),
  startLocalReload: () =>
    set((s) => {
      const combat = s.combat || blankCombat();
      if (combat.isReloading || combat.reserve <= 0 || combat.mag >= combat.magSize) return s;
      return {
        combat: {
          ...combat,
          isReloading: true
        }
      };
    }),
  finishLocalReload: () =>
    set((s) => {
      const combat = s.combat || blankCombat();
      if (!combat.isReloading) return s;
      const needed = combat.magSize - combat.mag;
      const load = Math.min(needed, combat.reserve);
      return {
        combat: {
          ...combat,
          mag: combat.mag + load,
          reserve: combat.reserve - load,
          isReloading: false
        }
      };
    }),
  cancelLocalReload: () =>
    set((s) => ({
      combat: {
        ...(s.combat || blankCombat()),
        isReloading: false
      }
    })),
  setSnapshot: ({
    players,
    zombies,
    gameTime,
    spawnRateSec,
    gameOver,
    terrainSeed,
    worldOriginOffset
  }) =>
    set((s) => ({
      players: players ?? s.players,
      zombies: zombies ?? s.zombies,
      gameTime: typeof gameTime === "number" ? gameTime : s.gameTime,
      spawnRateSec: typeof spawnRateSec === "number" ? spawnRateSec : s.spawnRateSec,
      gameOver: typeof gameOver === "boolean" ? gameOver : s.gameOver,
      terrainSeed: Number.isFinite(terrainSeed) ? terrainSeed : s.terrainSeed,
      worldOriginOffset: worldOriginOffset
        ? normalizeWorldOffset(worldOriginOffset, s.worldOriginOffset)
        : s.worldOriginOffset
    })),
  applyStateDiff: ({
    players,
    zombies,
    removedZombieIds,
    gameTime,
    spawnRateSec,
    gameOver,
    serverTs,
    terrainSeed,
    worldOriginOffset
  }) => {
    let emittedDelta = null;
    set((s) => {
      const nextOffset = worldOriginOffset
        ? normalizeWorldOffset(worldOriginOffset, s.worldOriginOffset)
        : s.worldOriginOffset;
      const offsetDelta = computeOffsetDelta(nextOffset, s.worldOriginOffset);
      const rebaseApplied = hasOffsetDelta(offsetDelta);
      if (rebaseApplied) {
        emittedDelta = offsetDelta;
      }
      const basePlayers = rebaseApplied ? shiftPlayersMap(s.players, offsetDelta) : { ...s.players };
      const baseZombies = rebaseApplied ? shiftZombiesMap(s.zombies, offsetDelta) : { ...s.zombies };

      const mergedPlayers = { ...basePlayers };
      for (const [id, p] of Object.entries(players || {})) {
        if (p.removed) {
          delete mergedPlayers[id];
        } else {
          const prev = mergedPlayers[id] || blankPlayer();
          if (id === s.selfId && s.netMode === "multiplayer") {
            mergedPlayers[id] = {
              ...prev,
              ...p,
              position: prev.position,
              rotation: prev.rotation,
              serverPosition: p.position ?? prev.serverPosition ?? prev.position,
              serverRotation: p.rotation ?? prev.serverRotation ?? prev.rotation,
              serverSeq: typeof p.seq === "number" ? p.seq : prev.serverSeq
            };
          } else {
            const nextSamples = prev.netSamples ? prev.netSamples.slice(-19) : [];
            if (p.position || p.rotation) {
              nextSamples.push({
                ts: typeof serverTs === "number" ? serverTs : Date.now(),
                position: p.position ?? prev.position,
                rotation: p.rotation ?? prev.rotation
              });
            }
            mergedPlayers[id] = {
              ...prev,
              ...p,
              netSamples: nextSamples
            };
          }
        }
      }

      const mergedZombies = { ...baseZombies };
      for (const [id, z] of Object.entries(zombies || {})) {
        const prev = mergedZombies[id] || {};
        const nextSamples = prev.netSamples ? prev.netSamples.slice(-19) : [];
        if (z.position) {
          nextSamples.push({
            ts: typeof serverTs === "number" ? serverTs : Date.now(),
            position: z.position
          });
        }
        mergedZombies[id] = {
          ...prev,
          ...z,
          netSamples: nextSamples,
          removed: false
        };
      }
      for (const id of removedZombieIds || []) {
        const prev = mergedZombies[id];
        if (!prev) continue;
        mergedZombies[id] = {
          ...prev,
          removed: true,
          removedAt: Date.now()
        };
      }

      return {
        players: mergedPlayers,
        zombies: mergedZombies,
        gameTime: typeof gameTime === "number" ? gameTime : s.gameTime,
        spawnRateSec: typeof spawnRateSec === "number" ? spawnRateSec : s.spawnRateSec,
        gameOver: typeof gameOver === "boolean" ? gameOver : s.gameOver,
        terrainSeed: Number.isFinite(terrainSeed) ? terrainSeed : s.terrainSeed,
        worldOriginOffset: nextOffset
      };
    });
    if (
      emittedDelta &&
      typeof window !== "undefined" &&
      (Math.abs(emittedDelta.x) > REBASE_EPS ||
        Math.abs(emittedDelta.y) > REBASE_EPS ||
        Math.abs(emittedDelta.z) > REBASE_EPS)
    ) {
      window.dispatchEvent(new CustomEvent("world_rebase", { detail: { delta: emittedDelta } }));
    }
  },
  updateLocalPlayer: (updater) =>
    set((s) => {
      const selfId = s.selfId;
      const prev = s.players[selfId] || blankPlayer();
      const next = updater(prev);
      return {
        players: {
          ...s.players,
          [selfId]: next
        },
        localSeq: s.localSeq + 1
      };
    }),
  reconcileLocalPlayer: ({ position, rotation, serverSeq }) =>
    set((s) => {
      const selfId = s.selfId;
      const prev = s.players[selfId];
      if (!prev) return s;
      return {
        players: {
          ...s.players,
          [selfId]: {
            ...prev,
            position: position ?? prev.position,
            rotation: rotation ?? prev.rotation,
            serverSeq: typeof serverSeq === "number" ? serverSeq : prev.serverSeq
          }
        }
      };
    }),
  hydrateJoin: ({
    roomId,
    selfId,
    players,
    zombies,
    gameTime,
    spawnRateSec,
    terrainSeed,
    worldOriginOffset
  }) =>
    set({
      mode: "playing",
      netMode: "multiplayer",
      roomId,
      selfId,
      players,
      zombies,
      gameTime,
      spawnRateSec,
      gameOver: false,
      terrainSeed: Number.isFinite(terrainSeed) ? terrainSeed : DEFAULTS.terrainSeed,
      worldOriginOffset: normalizeWorldOffset(worldOriginOffset, blankWorldOffset())
    })
}));
