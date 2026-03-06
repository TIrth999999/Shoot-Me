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
  eyeHeight: 1.55,
  bulletRange: 95,
  zombieFallGravity: 24,
  zombieSpawnHeightMin: 14,
  zombieSpawnHeightMax: 26,
  pingIntervalMs: 1200,
  interpAlpha: 0.18,
  zombieHp: 45,
  playerHp: 100
};
