import { DEFAULTS } from "../../game/constants";

const TICK_MS = Math.floor(1000 / 60);
const SNAPSHOT_INTERVAL_SEC = 1 / 15;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const normalize2D = (x, z) => {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
};

const roundPos = (v) => Math.round(v * 100) / 100;
const roundYaw = (v) => Math.round(v * 1000) / 1000;

const sanitizeRotation = (rotation) => {
  if (!rotation || typeof rotation.yaw !== "number" || !Number.isFinite(rotation.yaw)) {
    return { yaw: 0 };
  }
  return { yaw: clamp(rotation.yaw, -Math.PI * 2, Math.PI * 2) };
};

const sanitizePosition = (position) => {
  if (!position || typeof position.x !== "number" || typeof position.z !== "number") {
    return null;
  }
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    return null;
  }
  return {
    x: clamp(position.x, -DEFAULTS.worldWidth * 0.5, DEFAULTS.worldWidth * 0.5),
    y: 0,
    z: clamp(position.z, -DEFAULTS.worldDepth * 0.5, DEFAULTS.worldDepth * 0.5)
  };
};

const sanitizeDirection = (direction) => {
  if (!direction) return null;
  const x = direction.x;
  const z = direction.z;
  const y = typeof direction.y === "number" ? direction.y : 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  const len = Math.hypot(x, y, z);
  if (len < 0.01 || len > 2) return null;
  return { x: x / len, y: y / len, z: z / len };
};

const blankPlayer = () => ({
  position: { x: 0, y: 0, z: 0 },
  rotation: { yaw: 0 },
  hp: DEFAULTS.playerHp,
  score: 0,
  isDead: false,
  lastMoveAt: Date.now(),
  lastShootAt: 0,
  lastDamagedAt: 0,
  seq: 0,
  ping: 0
});

const randomSpawnPoint = () => ({
  x: (Math.random() - 0.5) * DEFAULTS.worldWidth,
  y: DEFAULTS.zombieSpawnHeightMin + Math.random() * (DEFAULTS.zombieSpawnHeightMax - DEFAULTS.zombieSpawnHeightMin),
  z: (Math.random() - 0.5) * DEFAULTS.worldDepth
});

const isEveryoneDead = (players) => {
  const list = Object.values(players);
  return list.length > 0 && list.every((p) => p.isDead);
};

export class HostAuthority {
  constructor({ hostId, onStateDiff, onGameOver }) {
    this.hostId = hostId;
    this.onStateDiff = onStateDiff;
    this.onGameOver = onGameOver;
    this.timer = null;
    this.room = {
      players: {},
      zombies: {},
      zombieCounter: 0,
      gameTime: 0,
      spawnRateSec: 2.5,
      maxZombies: 35,
      zombieSpawnAccumulator: 0,
      snapshotAccumulator: 0,
      removedZombieIds: [],
      dirtyPlayers: new Set(),
      dirtyZombies: new Set(),
      gameOver: false,
      gameOverAnnounced: false
    };
    this.addPlayer(hostId);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getJoinSnapshot() {
    const players = {};
    for (const [id, p] of Object.entries(this.room.players)) {
      players[id] = {
        id,
        position: p.position,
        rotation: p.rotation,
        hp: p.hp,
        score: p.score,
        isDead: p.isDead,
        ping: p.ping,
        seq: p.seq
      };
    }
    return {
      players,
      zombies: this.room.zombies,
      gameTime: this.room.gameTime,
      spawnRateSec: this.room.spawnRateSec
    };
  }

  addPlayer(playerId) {
    if (this.room.players[playerId]) return;
    this.room.players[playerId] = blankPlayer();
    this.room.dirtyPlayers.add(playerId);
  }

  removePlayer(playerId) {
    if (!this.room.players[playerId]) return;
    delete this.room.players[playerId];
    this.room.dirtyPlayers.add(playerId);
  }

  setPlayerPing(playerId, latency) {
    const p = this.room.players[playerId];
    if (!p) return;
    p.ping = clamp(latency, 0, 9999);
    this.room.dirtyPlayers.add(playerId);
  }

  handleMove(playerId, { position, rotation, seq }) {
    const player = this.room.players[playerId];
    if (!player || player.isDead) return;

    const nextPos = sanitizePosition(position);
    if (!nextPos) return;
    const nextRot = sanitizeRotation(rotation);
    const delta = dist2D(player.position, nextPos);
    const yawDelta = Math.abs((player.rotation?.yaw || 0) - (nextRot?.yaw || 0));
    if (delta < DEFAULTS.netMinMoveDelta && yawDelta < DEFAULTS.netMinYawDelta) return;
    if (delta > 2.2) return;

    player.position = nextPos;
    player.rotation = nextRot;
    player.seq = typeof seq === "number" ? seq : player.seq;
    player.lastMoveAt = Date.now();
    this.room.dirtyPlayers.add(playerId);
  }

  handleShoot(playerId, { direction, origin }) {
    const shooter = this.room.players[playerId];
    if (!shooter || shooter.isDead) return;
    const safeDirection = sanitizeDirection(direction);
    if (!safeDirection) return;

    const now = Date.now();
    if (now - shooter.lastShootAt < 180) return;
    shooter.lastShootAt = now;

    const shootOrigin = origin || {
      x: shooter.position.x,
      y: (shooter.position.y || 0) + DEFAULTS.eyeHeight,
      z: shooter.position.z
    };

    let nearestHit = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const zombie of Object.values(this.room.zombies)) {
      const bodyBaseY = (zombie.position.y || 0) + DEFAULTS.zombieHitboxBaseOffset;
      const bodyTopY = bodyBaseY + 1.85;
      const bodyMidY = (bodyBaseY + bodyTopY) * 0.5;
      const toZombieX = zombie.position.x - shootOrigin.x;
      const toZombieY = bodyMidY - shootOrigin.y;
      const toZombieZ = zombie.position.z - shootOrigin.z;
      const projected = toZombieX * safeDirection.x + toZombieY * safeDirection.y + toZombieZ * safeDirection.z;
      if (projected < 0 || projected > DEFAULTS.bulletRange) continue;

      const closestX = shootOrigin.x + safeDirection.x * projected;
      const closestY = shootOrigin.y + safeDirection.y * projected;
      const closestZ = shootOrigin.z + safeDirection.z * projected;
      const horizontalMiss = Math.hypot(zombie.position.x - closestX, zombie.position.z - closestZ);
      const withinBodyY = closestY >= bodyBaseY && closestY <= bodyTopY;

      if (horizontalMiss <= 0.48 && withinBodyY && projected < nearestDist) {
        nearestDist = projected;
        nearestHit = zombie;
      }
    }

    if (!nearestHit) return;
    nearestHit.hp -= 25;
    if (nearestHit.hp <= 0) {
      this.room.removedZombieIds.push(nearestHit.id);
      delete this.room.zombies[nearestHit.id];
      this.room.dirtyZombies.delete(nearestHit.id);
      if (this.room.players[playerId]) {
        this.room.players[playerId].score += 10;
        this.room.dirtyPlayers.add(playerId);
      }
    } else {
      this.room.dirtyZombies.add(nearestHit.id);
    }
  }

  restart() {
    this.room.zombies = {};
    this.room.gameTime = 0;
    this.room.spawnRateSec = 2.5;
    this.room.maxZombies = 35;
    this.room.zombieSpawnAccumulator = 0;
    this.room.snapshotAccumulator = 0;
    this.room.gameOver = false;
    this.room.gameOverAnnounced = false;
    this.room.removedZombieIds.length = 0;
    for (const [id, p] of Object.entries(this.room.players)) {
      p.hp = DEFAULTS.playerHp;
      p.score = 0;
      p.isDead = false;
      p.position = { x: 0, y: 0, z: 0 };
      p.rotation = { yaw: 0 };
      this.room.dirtyPlayers.add(id);
    }
    this.flushSnapshot(true);
  }

  spawnZombie() {
    const id = `z_${this.room.zombieCounter++}`;
    this.room.zombies[id] = {
      id,
      position: randomSpawnPoint(),
      velocityY: 0,
      hp: DEFAULTS.zombieHp,
      targetPlayerId: null,
      idle: Math.random() < 0.12
    };
    this.room.dirtyZombies.add(id);
  }

  updateDifficulty() {
    const mins = this.room.gameTime / 60;
    this.room.spawnRateSec = Math.max(0.25, 2.5 - mins * 0.35);
    this.room.maxZombies = Math.floor(35 + mins * 10);
  }

  updateZombies(dtSec) {
    const speed = DEFAULTS.zombieBaseSpeed * (1 + (this.room.gameTime / 60) * DEFAULTS.zombieSpeedRampPerMin);
    for (const zombie of Object.values(this.room.zombies)) {
      if (zombie.idle) {
        zombie.targetPlayerId = null;
        continue;
      }

      if (zombie.position.y > 0) {
        zombie.velocityY -= DEFAULTS.zombieFallGravity * dtSec;
        zombie.position.y = Math.max(0, zombie.position.y + zombie.velocityY * dtSec);
        this.room.dirtyZombies.add(zombie.id);
        if (zombie.position.y > 0) continue;
        zombie.velocityY = 0;
      }

      let nearestId = null;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (const [pid, player] of Object.entries(this.room.players)) {
        if (player.isDead) continue;
        const d = dist2D(player.position, zombie.position);
        if (d < nearestDist) {
          nearestDist = d;
          nearestId = pid;
        }
      }
      zombie.targetPlayerId = nearestId;
      if (!nearestId) continue;

      const target = this.room.players[nearestId];
      const dir = normalize2D(target.position.x - zombie.position.x, target.position.z - zombie.position.z);
      zombie.position.x += dir.x * speed * dtSec;
      zombie.position.z += dir.z * speed * dtSec;
      this.room.dirtyZombies.add(zombie.id);

      if (nearestDist <= 2.1) {
        const now = Date.now();
        if (!target.isDead && now - target.lastDamagedAt >= 700) {
          target.lastDamagedAt = now;
          target.hp = clamp(target.hp - 10, 0, DEFAULTS.playerHp);
          if (target.hp <= 0) target.isDead = true;
          this.room.dirtyPlayers.add(nearestId);
        }
      }
    }
  }

  flushSnapshot(force = false) {
    const players = {};
    const zombies = {};
    for (const playerId of this.room.dirtyPlayers) {
      const p = this.room.players[playerId];
      players[playerId] = p
        ? {
            id: playerId,
            position: {
              x: roundPos(p.position.x),
              y: roundPos(p.position.y || 0),
              z: roundPos(p.position.z)
            },
            rotation: { yaw: roundYaw(p.rotation.yaw || 0) },
            hp: p.hp,
            score: p.score,
            isDead: p.isDead,
            ping: p.ping,
            seq: p.seq
          }
        : { id: playerId, removed: true };
    }
    for (const zombieId of this.room.dirtyZombies) {
      const z = this.room.zombies[zombieId];
      if (!z) continue;
      zombies[zombieId] = {
        id: zombieId,
        position: {
          x: roundPos(z.position.x),
          y: roundPos(z.position.y || 0),
          z: roundPos(z.position.z)
        },
        hp: z.hp,
        targetPlayerId: z.targetPlayerId,
        idle: !!z.idle
      };
    }

    const removedZombieIds = this.room.removedZombieIds.slice();
    this.room.dirtyPlayers.clear();
    this.room.dirtyZombies.clear();
    this.room.removedZombieIds.length = 0;

    if (!force && Object.keys(players).length === 0 && Object.keys(zombies).length === 0 && removedZombieIds.length === 0 && !this.room.gameOver) {
      return;
    }

    this.onStateDiff?.({
      players,
      zombies,
      removedZombieIds,
      gameTime: this.room.gameTime,
      spawnRateSec: this.room.spawnRateSec,
      gameOver: this.room.gameOver,
      serverTs: Date.now()
    });
  }

  tick(dtSec) {
    this.room.gameTime += dtSec;
    this.room.snapshotAccumulator += dtSec;

    this.updateDifficulty();
    this.room.zombieSpawnAccumulator += dtSec;
    while (this.room.zombieSpawnAccumulator >= this.room.spawnRateSec && Object.keys(this.room.zombies).length < this.room.maxZombies) {
      this.room.zombieSpawnAccumulator -= this.room.spawnRateSec;
      this.spawnZombie();
    }

    this.updateZombies(dtSec);
    if (!this.room.gameOver && isEveryoneDead(this.room.players)) {
      this.room.gameOver = true;
    }

    if (this.room.snapshotAccumulator >= SNAPSHOT_INTERVAL_SEC) {
      this.room.snapshotAccumulator = 0;
      this.flushSnapshot(false);
    }

    if (this.room.gameOver && !this.room.gameOverAnnounced) {
      this.room.gameOverAnnounced = true;
      this.onGameOver?.({ gameTime: this.room.gameTime });
    }
  }
}
