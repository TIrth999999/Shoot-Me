import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DEFAULTS } from "./constants";
import { useGameStore } from "../state/useGameStore";
import { ZOMBIE_TYPE_SPAWN_WEIGHTS, ZOMBIE_TYPES } from "./zombieTypes";
import { ZOMBIE_HITBOX, ZOMBIE_HITBOX_BASE_LIFT, ZOMBIE_HITBOX_HEIGHT_BONUS } from "./zombieCombatTuning";
import { getZombieTypeHitbox } from "./zombieHitboxRegistry";
import { getTerrainRuntime } from "./terrainRuntime";
import { pickTerrainSpawnPosition } from "./terrainSpawn";

const randIn = (min, max) => min + Math.random() * (max - min);
const BULLET_DAMAGE = 5;
const MIN_SPAWN_DIST_FROM_PLAYER = 18;
const MAX_SPAWN_TRIES = 20;

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

const rayIntersectsAabb = (origin, direction, min, max, maxDistance) => {
  let tMin = 0;
  let tMax = maxDistance;
  const axes = ["x", "y", "z"];

  for (const axis of axes) {
    const o = origin[axis];
    const d = direction[axis];
    const aMin = min[axis];
    const aMax = max[axis];
    if (Math.abs(d) < 1e-6) {
      if (o < aMin || o > aMax) return null;
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
    if (tMax < tMin) return null;
  }

  return tMin;
};

const pickZombieType = () => {
  let roll = Math.random();
  for (const entry of ZOMBIE_TYPE_SPAWN_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return ZOMBIE_TYPES.ZOMBIE_DOG_LONG;
};

const getZombieCollisionRadius = (type) =>
  DEFAULTS.zombieCollisionRadiusByType[type] ??
  DEFAULTS.zombieCollisionRadiusByType.default ??
  0.62;

const settleZombieToGround = (zombie, groundY, dt) => {
  const safeGroundY = Number.isFinite(groundY) ? groundY : 0;
  if ((zombie.position.y || 0) > safeGroundY + 0.04) {
    zombie.velocityY = (zombie.velocityY || 0) - DEFAULTS.zombieFallGravity * dt;
    zombie.position.y = Math.max(safeGroundY, zombie.position.y + zombie.velocityY * dt);
    if (zombie.position.y <= safeGroundY + 1e-4) {
      zombie.position.y = safeGroundY;
      zombie.velocityY = 0;
    }
    return;
  }
  zombie.position.y = safeGroundY;
  zombie.velocityY = 0;
};

export const useSoloSimulation = (enabled) => {
  const zombieCounter = useRef(0);
  const spawnAcc = useRef(0);
  const lastDamageAt = useRef(0);

  useFrame((_, dt) => {
    const state = useGameStore.getState();
    if (!enabled || state.mode !== "playing" || state.netMode !== "solo" || state.gameOver) return;

    const self = state.players[state.selfId];
    if (!self || self.isDead) return;
    const terrainRuntime = getTerrainRuntime();

    const mins = state.gameTime / 60;
    const spawnRate = Math.max(0.8, 4.2 - mins * 0.22);
    const maxZombies = Math.floor(35 + mins * 10);
    const zombieSpeed = DEFAULTS.zombieBaseSpeed * (1 + mins * DEFAULTS.zombieSpeedRampPerMin);

    spawnAcc.current += dt;
    const zombies = { ...state.zombies };
    let activeFriendlyCount = Object.values(zombies).filter(
      (z) => !z.removed && z.type === ZOMBIE_TYPES.SKINNER_FRIENDLY
    ).length;

    while (spawnAcc.current >= spawnRate && Object.keys(zombies).length < maxZombies) {
      spawnAcc.current -= spawnRate;
      const id = `solo_${zombieCounter.current++}`;
      let type = pickZombieType();
      if (activeFriendlyCount === 0 && Math.random() < 0.35) {
        type = ZOMBIE_TYPES.SKINNER_FRIENDLY;
      }
      if (type === ZOMBIE_TYPES.SKINNER_FRIENDLY && activeFriendlyCount > 0) {
        type = pickNonFriendlyType();
      }
      const isFriendly = type === ZOMBIE_TYPES.SKINNER_FRIENDLY;
      if (isFriendly) activeFriendlyCount += 1;
      const spawnPos = pickTerrainSpawnPosition({
        isFriendly,
        players: [self.position],
        minDistance: MIN_SPAWN_DIST_FROM_PLAYER,
        maxTries: MAX_SPAWN_TRIES,
        radius: getZombieCollisionRadius(type)
      });
      zombies[id] = {
        id,
        type,
        behavior: isFriendly ? "orbit" : "chase",
        hp: DEFAULTS.zombieTypeHp[type] ?? DEFAULTS.zombieHp,
        position: {
          x: spawnPos.x,
          y: spawnPos.groundY ?? 0,
          z: spawnPos.z
        },
        velocityY: 0,
        targetPlayerId: state.selfId,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitRadius: randIn(DEFAULTS.zombieFriendlyOrbit.radiusMin, DEFAULTS.zombieFriendlyOrbit.radiusMax),
        orbitSpeed: randIn(DEFAULTS.zombieFriendlyOrbit.speedMin, DEFAULTS.zombieFriendlyOrbit.speedMax),
        orbitTravel: 0,
        orbitGoal: Math.PI * 2
      };
    }

    let damaged = false;
    for (const zombie of Object.values(zombies)) {
      if (zombie.removed) {
        zombie.targetPlayerId = null;
        continue;
      }

      const radius = getZombieCollisionRadius(zombie.type);
      const typeSpeed = DEFAULTS.zombieTypeSpeedMult[zombie.type] || 1;

      if (zombie.behavior === "orbit") {
        const orbitSpeed = zombie.orbitSpeed || DEFAULTS.zombieFriendlyOrbit.speedMin;
        const orbitRadius = zombie.orbitRadius || DEFAULTS.zombieFriendlyOrbit.radiusMin;
        zombie.orbitAngle = (zombie.orbitAngle || 0) + orbitSpeed * dt;
        zombie.orbitTravel = (zombie.orbitTravel || 0) + Math.abs(orbitSpeed * dt);
        const tx = self.position.x + Math.cos(zombie.orbitAngle) * orbitRadius;
        const tz = self.position.z + Math.sin(zombie.orbitAngle) * orbitRadius;
        const dx = tx - zombie.position.x;
        const dz = tz - zombie.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const orbitMoveSpeed = zombieSpeed * DEFAULTS.zombieOrbitMoveMult * typeSpeed;
        const desired = {
          x: zombie.position.x + (dx / len) * orbitMoveSpeed * dt,
          z: zombie.position.z + (dz / len) * orbitMoveSpeed * dt
        };
        const resolved = terrainRuntime.resolveMove("zombie", zombie.position, desired, radius);
        zombie.position.x = resolved.x;
        zombie.position.z = resolved.z;
        settleZombieToGround(zombie, resolved.groundY, dt);
        zombie.targetPlayerId = null;
        if ((zombie.orbitTravel || 0) >= (zombie.orbitGoal || Math.PI * 2)) {
          zombie.removed = true;
          zombie.removedAt = Date.now();
          zombie.targetPlayerId = null;
        }
        continue;
      }

      const dx = self.position.x - zombie.position.x;
      const dz = self.position.z - zombie.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const desired = {
        x: zombie.position.x + (dx / len) * zombieSpeed * typeSpeed * dt,
        z: zombie.position.z + (dz / len) * zombieSpeed * typeSpeed * dt
      };
      const resolved = terrainRuntime.resolveMove("zombie", zombie.position, desired, radius);
      zombie.position.x = resolved.x;
      zombie.position.z = resolved.z;
      settleZombieToGround(zombie, resolved.groundY, dt);

      const distToPlayer = Math.hypot(self.position.x - zombie.position.x, self.position.z - zombie.position.z);
      if (distToPlayer < 2.1 && performance.now() - lastDamageAt.current > 700) {
        lastDamageAt.current = performance.now();
        damaged = true;
      }
    }

    const nextPlayer = { ...self };
    if (damaged) {
      nextPlayer.hp = Math.max(0, nextPlayer.hp - 10);
      if (nextPlayer.hp <= 0) {
        nextPlayer.isDead = true;
      }
      state.touchDamageKick();
    }

    useGameStore.setState((s) => ({
      gameTime: s.gameTime + dt,
      spawnRateSec: spawnRate,
      zombies,
      players: {
        ...s.players,
        [s.selfId]: nextPlayer
      },
      gameOver: nextPlayer.isDead
    }));
  });

  const shootLocal = (origin, direction) => {
    const state = useGameStore.getState();
    if (!enabled || state.netMode !== "solo" || state.gameOver) return;
    const terrainRuntime = getTerrainRuntime();
    const blockedAt = terrainRuntime.raycastObstacle?.(origin, direction, DEFAULTS.bulletRange);

    let nearest = null;
    let nearestDist = Number.POSITIVE_INFINITY;

    for (const zombie of Object.values(state.zombies)) {
      if (zombie.removed) continue;

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
      const hitT = rayIntersectsAabb(origin, direction, min, max, DEFAULTS.bulletRange);
      if (hitT !== null && hitT < nearestDist) {
        nearestDist = hitT;
        nearest = zombie.id;
      }
    }

    if (!nearest) return;
    if (Number.isFinite(blockedAt) && blockedAt <= nearestDist) return;

    useGameStore.setState((s) => {
      const z = s.zombies[nearest];
      if (!z) return {};
      const updated = { ...s.zombies };
      const hp = z.hp - BULLET_DAMAGE;
      if (hp <= 0) {
        updated[nearest] = {
          ...z,
          hp: 0,
          removed: true,
          removedAt: Date.now()
        };
      } else {
        updated[nearest] = { ...z, hp };
      }
      const p = s.players[s.selfId];
      return {
        zombies: updated,
        players: {
          ...s.players,
          [s.selfId]: {
            ...p,
            score: p.score + (hp <= 0 ? 10 : 0)
          }
        }
      };
    });
  };

  return { shootLocal };
};
