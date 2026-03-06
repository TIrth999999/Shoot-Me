import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DEFAULTS } from "./constants";
import { useGameStore } from "../state/useGameStore";

const rand = (n) => (Math.random() - 0.5) * n;

export const useSoloSimulation = (enabled) => {
  const zombieCounter = useRef(0);
  const spawnAcc = useRef(0);
  const lastDamageAt = useRef(0);

  useFrame((_, dt) => {
    const state = useGameStore.getState();
    if (!enabled || state.mode !== "playing" || state.netMode !== "solo" || state.gameOver) return;

    const self = state.players[state.selfId];
    if (!self || self.isDead) return;

    const mins = state.gameTime / 60;
    const spawnRate = Math.max(0.25, 2.5 - mins * 0.35);
    const maxZombies = Math.floor(35 + mins * 10);
    const zombieSpeed = 1.8 * (1 + mins * 0.45);

    spawnAcc.current += dt;
    const zombies = { ...state.zombies };

    while (spawnAcc.current >= spawnRate && Object.keys(zombies).length < maxZombies) {
      spawnAcc.current -= spawnRate;
      const id = `solo_${zombieCounter.current++}`;
      zombies[id] = {
        id,
        hp: DEFAULTS.zombieHp,
        position: {
          x: rand(DEFAULTS.worldWidth),
          y:
            DEFAULTS.zombieSpawnHeightMin +
            Math.random() * (DEFAULTS.zombieSpawnHeightMax - DEFAULTS.zombieSpawnHeightMin),
          z: rand(DEFAULTS.worldDepth)
        },
        velocityY: 0,
        targetPlayerId: state.selfId
      };
    }

    let damaged = false;
    for (const zombie of Object.values(zombies)) {
      if (zombie.removed) {
        zombie.targetPlayerId = null;
        continue;
      }

      if (zombie.position.y > 0) {
        zombie.velocityY -= DEFAULTS.zombieFallGravity * dt;
        zombie.position.y = Math.max(0, zombie.position.y + zombie.velocityY * dt);
        if (zombie.position.y > 0) {
          continue;
        }
        zombie.velocityY = 0;
      }

      const dx = self.position.x - zombie.position.x;
      const dz = self.position.z - zombie.position.z;
      const len = Math.hypot(dx, dz) || 1;
      zombie.position.x += (dx / len) * zombieSpeed * dt;
      zombie.position.z += (dz / len) * zombieSpeed * dt;

      if (len < 2.1 && performance.now() - lastDamageAt.current > 700) {
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

    let nearest = null;
    let nearestDist = Number.POSITIVE_INFINITY;

    for (const zombie of Object.values(state.zombies)) {
      const baseY = (zombie.position.y || 0) + 0.05;
      const topY = baseY + 1.85;
      const toX = zombie.position.x - origin.x;
      const toY = (baseY + 0.95) - origin.y;
      const toZ = zombie.position.z - origin.z;
      const projected = toX * direction.x + toY * direction.y + toZ * direction.z;
      if (projected < 0 || projected > DEFAULTS.bulletRange) continue;

      const cx = origin.x + direction.x * projected;
      const cy = origin.y + direction.y * projected;
      const cz = origin.z + direction.z * projected;
      const horizontalMiss = Math.hypot(zombie.position.x - cx, zombie.position.z - cz);
      const withinBodyY = cy >= baseY && cy <= topY;
      if (horizontalMiss <= 0.48 && withinBodyY && projected < nearestDist) {
        nearestDist = projected;
        nearest = zombie.id;
      }
    }

    if (!nearest) return;

    useGameStore.setState((s) => {
      const z = s.zombies[nearest];
      if (!z) return {};
      const updated = { ...s.zombies };
      const hp = z.hp - 25;
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
