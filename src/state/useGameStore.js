import { create } from "zustand";
import { DEFAULTS } from "../game/constants";

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
      localSeq: 0
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
  setSnapshot: ({ players, zombies, gameTime, spawnRateSec, gameOver }) =>
    set((s) => ({
      players: players ?? s.players,
      zombies: zombies ?? s.zombies,
      gameTime: typeof gameTime === "number" ? gameTime : s.gameTime,
      spawnRateSec: typeof spawnRateSec === "number" ? spawnRateSec : s.spawnRateSec,
      gameOver: typeof gameOver === "boolean" ? gameOver : s.gameOver
    })),
  applyStateDiff: ({ players, zombies, removedZombieIds, gameTime, spawnRateSec, gameOver, serverTs }) =>
    set((s) => {
      const mergedPlayers = { ...s.players };
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

      const mergedZombies = { ...s.zombies };
      for (const [id, z] of Object.entries(zombies || {})) {
        mergedZombies[id] = {
          ...(mergedZombies[id] || {}),
          ...z,
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
        gameOver: typeof gameOver === "boolean" ? gameOver : s.gameOver
      };
    }),
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
  hydrateJoin: ({ roomId, selfId, players, zombies, gameTime, spawnRateSec }) =>
    set({
      mode: "playing",
      netMode: "multiplayer",
      roomId,
      selfId,
      players,
      zombies,
      gameTime,
      spawnRateSec,
      gameOver: false
    })
}));
