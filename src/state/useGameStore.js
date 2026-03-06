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
  resetSession: () =>
    set({
      gameOver: false,
      gameTime: 0,
      spawnRateSec: 2.5,
      players: { [get().selfId || "local"]: blankPlayer() },
      zombies: {},
      localSeq: 0
    }),
  setSnapshot: ({ players, zombies, gameTime, spawnRateSec, gameOver }) =>
    set((s) => ({
      players: players ?? s.players,
      zombies: zombies ?? s.zombies,
      gameTime: typeof gameTime === "number" ? gameTime : s.gameTime,
      spawnRateSec: typeof spawnRateSec === "number" ? spawnRateSec : s.spawnRateSec,
      gameOver: typeof gameOver === "boolean" ? gameOver : s.gameOver
    })),
  applyStateDiff: ({ players, zombies, removedZombieIds, gameTime, spawnRateSec, gameOver }) =>
    set((s) => {
      const mergedPlayers = { ...s.players };
      for (const [id, p] of Object.entries(players || {})) {
        if (p.removed) {
          delete mergedPlayers[id];
        } else {
          const prev = mergedPlayers[id] || blankPlayer();
          mergedPlayers[id] = { ...prev, ...p };
        }
      }

      const mergedZombies = { ...s.zombies };
      for (const [id, z] of Object.entries(zombies || {})) {
        mergedZombies[id] = {
          ...(mergedZombies[id] || {}),
          ...z
        };
      }
      for (const id of removedZombieIds || []) {
        delete mergedZombies[id];
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