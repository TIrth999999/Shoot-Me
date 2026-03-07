import { ZOMBIE_TYPES } from "./zombieTypes";

export const MESSAGE_TYPES = {
  CREATE_ROOM: "CREATE_ROOM",
  JOIN_ROOM: "JOIN_ROOM",
  LEAVE_ROOM: "LEAVE_ROOM",
  PLAYER_MOVE: "PLAYER_MOVE",
  SHOOT: "SHOOT",
  RESTART: "RESTART",
  PING: "PING",
  PONG: "PONG",
  ROOM_JOINED: "ROOM_JOINED",
  PLAYER_LEFT: "PLAYER_LEFT",
  STATE_UPDATE: "STATE_UPDATE",
  ROOM_LIST: "ROOM_LIST",
  GAME_OVER: "GAME_OVER",
  ERROR: "ERROR"
};

export const DEFAULTS = {
  worldWidth: 140,
  worldDepth: 140,
  playerSpeed: 7,
  sprintMult: 1.6,
  cameraDistance: 8,
  cameraHeight: 4,
  firstPerson: true,
  eyeHeight: 2.5,
  playerBodyCenterHeight: 0.9,
  playerHealthBarOffset: 2.05,
  zombieBodyHeight: 2.35,
  zombieHealthBarHeadroom: 0.28,
  zombieHitboxBaseOffset: 0.05,
  weaponMagSize: 20,
  weaponReserveStart: 90,
  weaponReloadMs: 3000,
  bulletRange: 95,
  zombieFallGravity: 24,
  zombieSpawnHeightMin: 14,
  zombieSpawnHeightMax: 26,
  zombieBaseSpeed: 1.8,
  zombieSpeedRampPerMin: 0.45,
  zombieOrbitMoveMult: 1.15,
  zombieTypeHp: {
    [ZOMBIE_TYPES.SKINNER]: 50,
    [ZOMBIE_TYPES.SKINNER_FRIENDLY]: 50,
    [ZOMBIE_TYPES.ZOMBIE_DOG]: 10,
    [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: 40
  },
  zombieTypeSpeedMult: {
    [ZOMBIE_TYPES.SKINNER]: 4.35
  },
  zombieFriendlyOrbit: {
    radiusMin: 5,
    radiusMax: 10,
    speedMin: 1.4,
    speedMax: 2.8
  },
  pingIntervalMs: 1200,
  interpAlpha: 0.18,
  netSendIntervalMs: 20,
  netMinMoveDelta: 0.035,
  netMinYawDelta: 0.015,
  netPositionQuantize: 100,
  netYawQuantize: 1000,
  netReconcileSnapDist: 1.6,
  netReconcileLerp: 0.35,
  netReconcileMinError: 2.5,
  remoteInterpolationDelayMs: 100,
  zombieHp: 45,
  playerHp: 100
};
