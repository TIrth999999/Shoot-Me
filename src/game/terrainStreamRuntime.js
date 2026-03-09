import { DEFAULTS } from "./constants";

const UP_NORMAL = Object.freeze({ x: 0, y: 1, z: 0 });
const SEAM_PROBE = 0.12;

const tileKey = (tx, tz) => `${tx}|${tz}`;

const chooseBestRuntimeForPoint = (tileEntries, x, z, radius = 0) => {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of tileEntries) {
    if (!entry?.runtime) continue;
    const bounds = entry.runtime.getBounds?.();
    if (!bounds) continue;
    const inside =
      x >= bounds.minX - radius &&
      x <= bounds.maxX + radius &&
      z >= bounds.minZ - radius &&
      z <= bounds.maxZ + radius;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cz = (bounds.minZ + bounds.maxZ) * 0.5;
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (inside) {
      if (d2 < bestDist) {
        best = entry;
        bestDist = d2;
      }
      continue;
    }
    if (!best && d2 < bestDist) {
      best = entry;
      bestDist = d2;
    }
  }
  return best;
};

const toEntries = (tileMap, keySet = null) => {
  const out = [];
  if (!tileMap?.size) return out;
  if (keySet && keySet.size > 0) {
    for (const key of keySet) {
      const entry = tileMap.get(key);
      if (entry?.runtime) out.push(entry);
    }
    return out;
  }
  for (const entry of tileMap.values()) {
    if (entry?.runtime) out.push(entry);
  }
  return out;
};

export const getTileVariation = () => ({ rotationY: 0 });

export const buildTileCoords = ({
  centerTx,
  centerTz,
  ring = DEFAULTS.terrainTileRing,
  prewarmTiles = DEFAULTS.terrainPrewarmTiles,
  moveX = 0,
  moveZ = 0
}) => {
  const visible = [];
  const cacheWarm = [];
  const r = Math.max(1, ring || 1);
  for (let dz = -r; dz <= r; dz += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      visible.push({ tx: centerTx + dx, tz: centerTz + dz });
    }
  }
  if ((prewarmTiles || 0) <= 0) {
    return { visible, prewarm: cacheWarm };
  }

  const absX = Math.abs(moveX);
  const absZ = Math.abs(moveZ);
  if (absX < 1e-4 && absZ < 1e-4) {
    return { visible, prewarm: cacheWarm };
  }

  const stride = r + Math.max(1, prewarmTiles || 1);
  if (absX >= absZ) {
    const sx = moveX >= 0 ? 1 : -1;
    const tx = centerTx + sx * stride;
    for (let dz = -r; dz <= r; dz += 1) {
      cacheWarm.push({ tx, tz: centerTz + dz });
    }
  } else {
    const sz = moveZ >= 0 ? 1 : -1;
    const tz = centerTz + sz * stride;
    for (let dx = -r; dx <= r; dx += 1) {
      cacheWarm.push({ tx: centerTx + dx, tz });
    }
  }
  return { visible, prewarm: cacheWarm };
};

export const createTerrainStreamRuntime = () => {
  const state = {
    tiles: new Map(),
    activeKeys: new Set(),
    tileSizeX: DEFAULTS.worldWidth,
    tileSizeZ: DEFAULTS.worldDepth,
    centerTx: 0,
    centerTz: 0
  };

  const toActiveEntries = () => {
    return toEntries(state.tiles, state.activeKeys);
  };

  const toCachedEntries = () => {
    const entries = [];
    for (const [key, entry] of state.tiles.entries()) {
      if (state.activeKeys.has(key)) continue;
      if (entry?.runtime) entries.push(entry);
    }
    return entries;
  };

  return {
    ready: false,
    setTileSize(size) {
      if (typeof size === "number") {
        const s = Math.max(1, size || DEFAULTS.worldWidth);
        state.tileSizeX = s;
        state.tileSizeZ = s;
        return;
      }
      state.tileSizeX = Math.max(1, size?.x || DEFAULTS.worldWidth);
      state.tileSizeZ = Math.max(1, size?.z || DEFAULTS.worldDepth);
    },
    setCenterTile(tx, tz) {
      state.centerTx = tx;
      state.centerTz = tz;
    },
    updateTiles({ tileEntries, activeKeys }) {
      state.tiles = tileEntries || new Map();
      state.activeKeys = activeKeys || new Set();
      this.ready = state.activeKeys.size > 0;
    },
    sampleGround(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      const activeEntries = toActiveEntries();
      const cachedEntries = toCachedEntries();
      if (activeEntries.length === 0 && cachedEntries.length === 0) {
        return { y: 0, normal: UP_NORMAL, walkable: true };
      }

      const seamOffsets = [
        [0, 0],
        [SEAM_PROBE, 0],
        [-SEAM_PROBE, 0],
        [0, SEAM_PROBE],
        [0, -SEAM_PROBE],
        [SEAM_PROBE, SEAM_PROBE],
        [SEAM_PROBE, -SEAM_PROBE],
        [-SEAM_PROBE, SEAM_PROBE],
        [-SEAM_PROBE, -SEAM_PROBE]
      ];
      const queryPasses = [activeEntries, cachedEntries];
      for (const entries of queryPasses) {
        if (!entries.length) continue;
        for (const [ox, oz] of seamOffsets) {
          const probeX = x + ox;
          const probeZ = z + oz;
          const preferred = chooseBestRuntimeForPoint(entries, probeX, probeZ, 0);
          const ordered = preferred
            ? [preferred, ...entries.filter((entry) => entry !== preferred)]
            : entries;
          for (const entry of ordered) {
            const sample = entry.runtime.sampleGround(probeX, probeZ);
            if (sample) return sample;
          }
        }
      }
      return null;
    },
    resolveMove(entityType, from, to, radius = 0) {
      const fromPos = {
        x: Number.isFinite(from?.x) ? from.x : 0,
        z: Number.isFinite(from?.z) ? from.z : 0
      };
      const toPos = {
        x: Number.isFinite(to?.x) ? to.x : fromPos.x,
        z: Number.isFinite(to?.z) ? to.z : fromPos.z
      };
      const activeEntries = toActiveEntries();
      const cachedEntries = toCachedEntries();
      if (activeEntries.length === 0 && cachedEntries.length === 0) {
        return {
          x: toPos.x,
          z: toPos.z,
          blocked: false,
          groundY: 0,
          normal: UP_NORMAL
        };
      }

      const queryPasses = [activeEntries, cachedEntries];
      for (const entries of queryPasses) {
        if (!entries.length) continue;
        const preferred = chooseBestRuntimeForPoint(entries, toPos.x, toPos.z, radius);
        const ordered = preferred
          ? [preferred, ...entries.filter((entry) => entry !== preferred)]
          : entries;

        for (const entry of ordered) {
          const result = entry.runtime.resolveMove(entityType, fromPos, toPos, radius);
          if (!result) continue;
          const ground = entry.runtime.sampleGround(result.x, result.z);
          if (ground?.walkable) return result;
        }
      }

      const fallbackGround = this.sampleGround(fromPos.x, fromPos.z);
      return {
        x: fromPos.x,
        z: fromPos.z,
        blocked: true,
        groundY: fallbackGround?.y ?? 0,
        normal: fallbackGround?.normal ?? UP_NORMAL
      };
    },
    isWalkableSpawn(x, z, radius = 0) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
      const activeEntries = toActiveEntries();
      const cachedEntries = toCachedEntries();
      const entries = activeEntries.length > 0 ? activeEntries : cachedEntries;
      if (entries.length === 0) return true;
      const preferred = chooseBestRuntimeForPoint(entries, x, z, radius);
      if (!preferred) return false;
      return preferred.runtime.isWalkableSpawn(x, z, radius);
    },
    raycastObstacle(origin, direction, maxDistance = DEFAULTS.bulletRange) {
      const activeEntries = toActiveEntries();
      const cachedEntries = toCachedEntries();
      if (activeEntries.length === 0 && cachedEntries.length === 0) return null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const entries of [activeEntries, cachedEntries]) {
        for (const entry of entries) {
          const hit = entry.runtime.raycastObstacle?.(origin, direction, maxDistance);
          if (Number.isFinite(hit) && hit < nearest) {
            nearest = hit;
          }
        }
      }
      return Number.isFinite(nearest) ? nearest : null;
    },
    getBounds() {
      const entries = toActiveEntries();
      if (entries.length === 0) {
        const halfW = DEFAULTS.worldWidth * 0.5;
        const halfD = DEFAULTS.worldDepth * 0.5;
        return { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD };
      }
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const entry of entries) {
        const b = entry.runtime.getBounds?.();
        if (!b) continue;
        minX = Math.min(minX, b.minX);
        maxX = Math.max(maxX, b.maxX);
        minZ = Math.min(minZ, b.minZ);
        maxZ = Math.max(maxZ, b.maxZ);
      }
      if (!Number.isFinite(minX)) {
        const halfW = DEFAULTS.worldWidth * 0.5;
        const halfD = DEFAULTS.worldDepth * 0.5;
        return { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD };
      }
      return { minX, maxX, minZ, maxZ };
    },
    getSpawnBounds(playerPositions) {
      const activeBounds = this.getBounds();
      if (activeBounds) {
        return {
          minX: activeBounds.minX,
          maxX: activeBounds.maxX,
          minZ: activeBounds.minZ,
          maxZ: activeBounds.maxZ
        };
      }
      const tileSizeX = state.tileSizeX || DEFAULTS.worldWidth;
      const tileSizeZ = state.tileSizeZ || DEFAULTS.worldDepth;
      let px = 0;
      let pz = 0;
      if (Array.isArray(playerPositions) && playerPositions.length > 0) {
        px = Number.isFinite(playerPositions[0]?.x) ? playerPositions[0].x : 0;
        pz = Number.isFinite(playerPositions[0]?.z) ? playerPositions[0].z : 0;
      }
      const tx = Math.floor(px / tileSizeX);
      const tz = Math.floor(pz / tileSizeZ);
      const ring = Math.max(1, DEFAULTS.terrainTileRing || 1);
      const marginX = tileSizeX * 0.2;
      const marginZ = tileSizeZ * 0.2;
      return {
        minX: (tx - ring) * tileSizeX - marginX,
        maxX: (tx + ring + 1) * tileSizeX + marginX,
        minZ: (tz - ring) * tileSizeZ - marginZ,
        maxZ: (tz + ring + 1) * tileSizeZ + marginZ
      };
    },
    getDebugState() {
      return {
        active: state.activeKeys.size,
        cached: state.tiles.size,
        centerTx: state.centerTx,
        centerTz: state.centerTz
      };
    },
    toTileKey: tileKey
  };
};
