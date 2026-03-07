import { DEFAULTS } from "../../game/constants";
import { ZOMBIE_TYPE_SPAWN_WEIGHTS, ZOMBIE_TYPES } from "../../game/zombieTypes";
import { ZOMBIE_HITBOX, ZOMBIE_HITBOX_BASE_LIFT, ZOMBIE_HITBOX_HEIGHT_BONUS } from "../../game/zombieCombatTuning";
import { getZombieTypeHitbox } from "../../game/zombieHitboxRegistry";

const TICK_MS = Math.floor(1000 / 60);
const SNAPSHOT_INTERVAL_SEC = 1 / 20;
const MIN_SPAWN_DIST_FROM_PLAYER = 18;
const MAX_SPAWN_TRIES = 20;

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
  if (!position || typeof position.x !== "number" || typeof position.z !== "number") return null;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
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
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const len = Math.hypot(x, y, z);
  if (len < 0.01 || len > 2) return null;
  return { x: x / len, y: y / len, z: z / len };
};

const rand = (n) => (Math.random() - 0.5) * n;
const randIn = (min, max) => min + Math.random() * (max - min);

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

const isEveryoneDead = (players) => {
  const list = Object.values(players);
  return list.length > 0 && list.every((p) => p.isDead);
};

const pickZombieType = () => {
  let roll = Math.random();
  for (const entry of ZOMBIE_TYPE_SPAWN_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return ZOMBIE_TYPES.ZOMBIE_DOG_LONG;
};

const pickNonFriendlyType = () => {
  let roll = Math.random();
  const pool = ZOMBIE_TYPE_SPAWN_WEIGHTS.filter((entry) => entry.type !== ZOMBIE_TYPES.SKINNER_FRIENDLY);
  const total = pool.reduce((acc, entry) => acc + entry.weight, 0) || 1;
  for (const entry of pool) {
    roll -= entry.weight / total;
    if (roll <= 0) return entry.type;
  }
  return ZOMBIE_TYPES.ZOMBIE_DOG_LONG;
};

const randomEdgeSpawn = () => {
  const halfW = DEFAULTS.worldWidth * 0.5;
  const halfD = DEFAULTS.worldDepth * 0.5;
  const margin = 2.5;
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: -halfW + margin, z: rand(DEFAULTS.worldDepth) };
  if (side === 1) return { x: halfW - margin, z: rand(DEFAULTS.worldDepth) };
  if (side === 2) return { x: rand(DEFAULTS.worldWidth), z: -halfD + margin };
  return { x: rand(DEFAULTS.worldWidth), z: halfD - margin };
};

const isFarEnoughFromAnyLivingPlayer = (spawnPos, players) => {
  for (const player of Object.values(players)) {
    if (!player || player.isDead || !player.position) continue;
    const dx = spawnPos.x - player.position.x;
    const dz = spawnPos.z - player.position.z;
    if (Math.hypot(dx, dz) < MIN_SPAWN_DIST_FROM_PLAYER) {
      return false;
    }
  }
  return true;
};

const pickSpawnPos = ({ isFriendly, players }) => {
  let candidate = null;
  for (let i = 0; i < MAX_SPAWN_TRIES; i += 1) {
    candidate = isFriendly
      ? randomEdgeSpawn()
      : {
          x: rand(DEFAULTS.worldWidth),
          z: rand(DEFAULTS.worldDepth)
        };
    if (isFarEnoughFromAnyLivingPlayer(candidate, players)) return candidate;
  }
  return candidate || { x: 0, z: 0 };
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
      spawnRateSec: 4.2,
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
      const runtimeHitbox = getZombieTypeHitbox(zombie.type);
      const fallbackHitbox = ZOMBIE_HITBOX[zombie.type] || ZOMBIE_HITBOX.default;
      const halfWidth = runtimeHitbox?.halfWidth ?? fallbackHitbox.halfWidth;
      const fallbackHeightBonus = ZOMBIE_HITBOX_HEIGHT_BONUS[zombie.type] ?? ZOMBIE_HITBOX_HEIGHT_BONUS.default;
      const bodyHeight = runtimeHitbox?.height ?? (fallbackHitbox.height + fallbackHeightBonus);
      const typeLift = runtimeHitbox?.baseLift ?? (ZOMBIE_HITBOX_BASE_LIFT[zombie.type] ?? ZOMBIE_HITBOX_BASE_LIFT.default);
      const baseY = (zombie.position.y || 0) + typeLift;
      const min = {
        x: zombie.position.x - halfWidth,
        y: baseY,
        z: zombie.position.z - halfWidth
      };
      const max = {
        x: zombie.position.x + halfWidth,
        y: baseY + bodyHeight,
        z: zombie.position.z + halfWidth
      };

      let tMin = 0;
      let tMax = DEFAULTS.bulletRange;
      let hit = true;
      for (const axis of ["x", "y", "z"]) {
        const o = shootOrigin[axis];
        const d = safeDirection[axis];
        const aMin = min[axis];
        const aMax = max[axis];
        if (Math.abs(d) < 1e-6) {
          if (o < aMin || o > aMax) {
            hit = false;
            break;
          }
          continue;
        }
        const inv = 1 / d;
        let t1 = (aMin - o) * inv;
        let t2 = (aMax - o) * inv;
        if (t1 > t2) {
          const temp = t1;
          t1 = t2;
          t2 = temp;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMax < tMin) {
          hit = false;
          break;
        }
      }
      if (hit && tMin < nearestDist) {
        nearestDist = tMin;
        nearestHit = zombie;
      }
    }

    if (!nearestHit) return;
    nearestHit.hp -= 5;
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
    this.room.spawnRateSec = 4.2;
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
      p.lastDamagedAt = 0;
      p.lastShootAt = 0;
      this.room.dirtyPlayers.add(id);
    }
    this.flushSnapshot(true);
  }

  spawnZombies(dtSec) {
    this.room.zombieSpawnAccumulator += dtSec;
    let activeFriendlyCount = Object.values(this.room.zombies).filter(
      (z) => !z.removed && z.type === ZOMBIE_TYPES.SKINNER_FRIENDLY
    ).length;

    while (this.room.zombieSpawnAccumulator >= this.room.spawnRateSec && Object.keys(this.room.zombies).length < this.room.maxZombies) {
      this.room.zombieSpawnAccumulator -= this.room.spawnRateSec;
      const id = `z_${this.room.zombieCounter++}`;
      let type = pickZombieType();
      if (activeFriendlyCount === 0 && Math.random() < 0.35) {
        type = ZOMBIE_TYPES.SKINNER_FRIENDLY;
      }
      if (type === ZOMBIE_TYPES.SKINNER_FRIENDLY && activeFriendlyCount > 0) {
        type = pickNonFriendlyType();
      }
      const isFriendly = type === ZOMBIE_TYPES.SKINNER_FRIENDLY;
      if (isFriendly) activeFriendlyCount += 1;
      const spawnPos = pickSpawnPos({ isFriendly, players: this.room.players });
      this.room.zombies[id] = {
        id,
        type,
        behavior: isFriendly ? "orbit" : "chase",
        hp: DEFAULTS.zombieTypeHp[type] ?? DEFAULTS.zombieHp,
        position: {
          x: spawnPos.x,
          y: 0,
          z: spawnPos.z
        },
        velocityY: 0,
        targetPlayerId: null,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitRadius: randIn(DEFAULTS.zombieFriendlyOrbit.radiusMin, DEFAULTS.zombieFriendlyOrbit.radiusMax),
        orbitSpeed: randIn(DEFAULTS.zombieFriendlyOrbit.speedMin, DEFAULTS.zombieFriendlyOrbit.speedMax),
        orbitTravel: 0,
        orbitGoal: Math.PI * 2,
        idle: false
      };
      this.room.dirtyZombies.add(id);
    }
  }

  updateDifficulty() {
    const mins = this.room.gameTime / 60;
    this.room.spawnRateSec = Math.max(0.8, 4.2 - mins * 0.22);
    this.room.maxZombies = Math.floor(35 + mins * 10);
  }

  updateZombies(dtSec) {
    const zombieSpeed = DEFAULTS.zombieBaseSpeed * (1 + (this.room.gameTime / 60) * DEFAULTS.zombieSpeedRampPerMin);
    for (const zombie of Object.values(this.room.zombies)) {
      if (zombie.removed) continue;

      if (zombie.position.y > 0) {
        zombie.velocityY -= DEFAULTS.zombieFallGravity * dtSec;
        zombie.position.y = Math.max(0, zombie.position.y + zombie.velocityY * dtSec);
        this.room.dirtyZombies.add(zombie.id);
        if (zombie.position.y > 0) continue;
        zombie.velocityY = 0;
      }

      const typeSpeed = DEFAULTS.zombieTypeSpeedMult[zombie.type] || 1;
      if (zombie.behavior === "orbit") {
        const orbitSpeed = zombie.orbitSpeed || DEFAULTS.zombieFriendlyOrbit.speedMin;
        const orbitRadius = zombie.orbitRadius || DEFAULTS.zombieFriendlyOrbit.radiusMin;
        const nearest = pickNearestLivingPlayer(this.room.players, zombie);
        if (!nearest.playerId) continue;
        const target = this.room.players[nearest.playerId];
        zombie.orbitAngle = (zombie.orbitAngle || 0) + orbitSpeed * dtSec;
        zombie.orbitTravel = (zombie.orbitTravel || 0) + Math.abs(orbitSpeed * dtSec);
        const tx = target.position.x + Math.cos(zombie.orbitAngle) * orbitRadius;
        const tz = target.position.z + Math.sin(zombie.orbitAngle) * orbitRadius;
        const dx = tx - zombie.position.x;
        const dz = tz - zombie.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const orbitMoveSpeed = zombieSpeed * DEFAULTS.zombieOrbitMoveMult * typeSpeed;
        zombie.position.x += (dx / len) * orbitMoveSpeed * dtSec;
        zombie.position.z += (dz / len) * orbitMoveSpeed * dtSec;
        zombie.targetPlayerId = null;
        this.room.dirtyZombies.add(zombie.id);
        if ((zombie.orbitTravel || 0) >= (zombie.orbitGoal || Math.PI * 2)) {
          this.room.removedZombieIds.push(zombie.id);
          delete this.room.zombies[zombie.id];
          this.room.dirtyZombies.delete(zombie.id);
        }
        continue;
      }

      const nearest = pickNearestLivingPlayer(this.room.players, zombie);
      zombie.targetPlayerId = nearest.playerId;
      if (!nearest.playerId) continue;
      const target = this.room.players[nearest.playerId];
      const dir = normalize2D(target.position.x - zombie.position.x, target.position.z - zombie.position.z);
      zombie.position.x += dir.x * zombieSpeed * typeSpeed * dtSec;
      zombie.position.z += dir.z * zombieSpeed * typeSpeed * dtSec;
      this.room.dirtyZombies.add(zombie.id);

      if (nearest.distance < 2.1) {
        const now = Date.now();
        if (!target.isDead && now - target.lastDamagedAt > 700) {
          target.lastDamagedAt = now;
          target.hp = clamp(target.hp - 10, 0, DEFAULTS.playerHp);
          if (target.hp <= 0) target.isDead = true;
          this.room.dirtyPlayers.add(nearest.playerId);
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
        type: z.type,
        behavior: z.behavior,
        position: {
          x: roundPos(z.position.x),
          y: roundPos(z.position.y || 0),
          z: roundPos(z.position.z)
        },
        hp: z.hp,
        targetPlayerId: z.targetPlayerId,
        orbitAngle: z.orbitAngle,
        orbitRadius: z.orbitRadius,
        orbitSpeed: z.orbitSpeed,
        orbitTravel: z.orbitTravel,
        orbitGoal: z.orbitGoal,
        idle: !!z.idle
      };
    }

    const removedZombieIds = this.room.removedZombieIds.slice();
    this.room.dirtyPlayers.clear();
    this.room.dirtyZombies.clear();
    this.room.removedZombieIds.length = 0;

    if (
      !force &&
      Object.keys(players).length === 0 &&
      Object.keys(zombies).length === 0 &&
      removedZombieIds.length === 0 &&
      !this.room.gameOver
    ) {
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
    this.spawnZombies(dtSec);
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
