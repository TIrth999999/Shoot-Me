import { getTerrainRuntime } from "./terrainRuntime";

const randIn = (min, max) => min + Math.random() * (max - min);

const getPlayerPositions = (players) => {
  if (!players) return [];
  if (Array.isArray(players)) return players.filter(Boolean);
  return Object.values(players)
    .filter((player) => player && !player.isDead && player.position)
    .map((player) => player.position);
};

const isFarEnoughFromPlayers = (candidate, players, minDistance) => {
  if (!candidate || !players?.length) return true;
  const minDist = Math.max(0, minDistance || 0);
  for (const pos of players) {
    if (!pos) continue;
    const dx = candidate.x - pos.x;
    const dz = candidate.z - pos.z;
    if (Math.hypot(dx, dz) < minDist) return false;
  }
  return true;
};

const samplePerimeterPoint = (bounds, inset = 0.6) => {
  const minX = Math.min(bounds.minX + inset, bounds.maxX - inset);
  const maxX = Math.max(bounds.minX + inset, bounds.maxX - inset);
  const minZ = Math.min(bounds.minZ + inset, bounds.maxZ - inset);
  const maxZ = Math.max(bounds.minZ + inset, bounds.maxZ - inset);
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: minX, z: randIn(minZ, maxZ) };
  if (side === 1) return { x: maxX, z: randIn(minZ, maxZ) };
  if (side === 2) return { x: randIn(minX, maxX), z: minZ };
  return { x: randIn(minX, maxX), z: maxZ };
};

const sampleInside = (bounds, inset = 0.6) => ({
  x: randIn(
    Math.min(bounds.minX + inset, bounds.maxX - inset),
    Math.max(bounds.minX + inset, bounds.maxX - inset)
  ),
  z: randIn(
    Math.min(bounds.minZ + inset, bounds.maxZ - inset),
    Math.max(bounds.minZ + inset, bounds.maxZ - inset)
  )
});

export const pickTerrainSpawnPosition = ({
  isFriendly = false,
  players,
  minDistance = 18,
  maxTries = 20,
  radius = 0.5
} = {}) => {
  const runtime = getTerrainRuntime();
  const bounds = runtime.getBounds();
  const playerPositions = getPlayerPositions(players);
  let fallback = null;

  for (let i = 0; i < maxTries; i += 1) {
    const candidate = isFriendly
      ? samplePerimeterPoint(bounds, radius + 0.45)
      : sampleInside(bounds, radius + 0.4);
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) continue;
    if (!runtime.isWalkableSpawn(candidate.x, candidate.z, radius)) continue;
    if (!isFarEnoughFromPlayers(candidate, playerPositions, minDistance)) continue;
    const ground = runtime.sampleGround(candidate.x, candidate.z);
    if (!ground) continue;
    return {
      x: candidate.x,
      z: candidate.z,
      groundY: ground.y
    };
  }

  if (!fallback) {
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
    const centerGround = runtime.sampleGround(centerX, centerZ);
    fallback = {
      x: centerX,
      z: centerZ,
      groundY: centerGround?.y ?? 0
    };
  }

  return fallback;
};
