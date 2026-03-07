import { Box3, MathUtils, Raycaster, Vector3 } from "three";
import { DEFAULTS } from "./constants";

const UP_NORMAL = Object.freeze({ x: 0, y: 1, z: 0 });
const MIN_RAY_HEIGHT = 35;
const TREE_PUSH_ITERATIONS = 3;
const LARGE_TREE_COLLIDER_RADIUS = 4.5;
const TREE_BIN_SIZE = 0.75;
const TREE_BIN_MIN_HEIGHT = 0.85;
const TREE_BIN_MIN_POINTS = 4;
const TREE_BIN_MAX_CLUSTER_CELLS = 40;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const makeBounds = () => ({
  minX: -DEFAULTS.worldWidth * 0.5,
  maxX: DEFAULTS.worldWidth * 0.5,
  minZ: -DEFAULTS.worldDepth * 0.5,
  maxZ: DEFAULTS.worldDepth * 0.5
});

const buildNameMatcher = (patterns = []) => {
  const lowered = patterns
    .filter((pattern) => typeof pattern === "string" && pattern.trim().length > 0)
    .map((pattern) => pattern.trim().toLowerCase());

  if (lowered.length === 0) {
    return () => false;
  }

  return (name) => {
    const value = String(name || "").toLowerCase();
    return lowered.some((pattern) => value === pattern || value.includes(pattern));
  };
};

const flatFallbackRuntime = {
  ready: false,
  sampleGround: () => ({ y: 0, normal: UP_NORMAL, walkable: true }),
  resolveMove: (_entityType, from, to, radius = 0) => {
    const bounds = makeBounds();
    const safeRadius = Math.max(0, radius || 0);
    const fallbackFrom = {
      x: Number.isFinite(from?.x) ? from.x : 0,
      z: Number.isFinite(from?.z) ? from.z : 0
    };
    const targetX = Number.isFinite(to?.x) ? to.x : fallbackFrom.x;
    const targetZ = Number.isFinite(to?.z) ? to.z : fallbackFrom.z;
    const x = clamp(targetX, bounds.minX + safeRadius, bounds.maxX - safeRadius);
    const z = clamp(targetZ, bounds.minZ + safeRadius, bounds.maxZ - safeRadius);
    return {
      x,
      z,
      blocked: x !== targetX || z !== targetZ,
      groundY: 0,
      normal: UP_NORMAL
    };
  },
  isWalkableSpawn: (x, z) => {
    const bounds = makeBounds();
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  },
  getBounds: () => makeBounds(),
  raycastObstacle: () => null,
  debug: {
    terrainMeshes: [],
    treeColliders: []
  }
};

let activeRuntime = flatFallbackRuntime;

export const registerTerrainRuntime = (runtime) => {
  activeRuntime = runtime || flatFallbackRuntime;
};

export const getTerrainRuntime = () => activeRuntime || flatFallbackRuntime;

const createTreeCollider = (mesh) => {
  const box = new Box3().setFromObject(mesh);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null;
  const width = Math.max(0.001, box.max.x - box.min.x);
  const depth = Math.max(0.001, box.max.z - box.min.z);
  const radius = Math.max(0.2, Math.max(width, depth) * 0.5);
  return {
    name: mesh.name || "tree",
    x: (box.min.x + box.max.x) * 0.5,
    z: (box.min.z + box.max.z) * 0.5,
    radius,
    minY: box.min.y,
    maxY: box.max.y
  };
};

const createTreeCollidersFromBins = (mesh) => {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!position || position.count === 0) return [];

  const worldPos = new Vector3();
  const cellMap = new Map();

  for (let i = 0; i < position.count; i += 1) {
    worldPos.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    const bx = Math.floor(worldPos.x / TREE_BIN_SIZE);
    const bz = Math.floor(worldPos.z / TREE_BIN_SIZE);
    const key = `${bx}|${bz}`;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        bx,
        bz,
        count: 0,
        sumX: 0,
        sumZ: 0,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY
      };
      cellMap.set(key, cell);
    }
    cell.count += 1;
    cell.sumX += worldPos.x;
    cell.sumZ += worldPos.z;
    cell.minY = Math.min(cell.minY, worldPos.y);
    cell.maxY = Math.max(cell.maxY, worldPos.y);
  }

  const validCellMap = new Map();
  for (const [key, cell] of cellMap.entries()) {
    const h = cell.maxY - cell.minY;
    if (cell.count >= TREE_BIN_MIN_POINTS && h >= TREE_BIN_MIN_HEIGHT) {
      validCellMap.set(key, cell);
    }
  }
  if (validCellMap.size === 0) return [];

  const colliders = [];
  const visited = new Set();
  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ];

  for (const [startKey, startCell] of validCellMap.entries()) {
    if (visited.has(startKey)) continue;
    const queue = [startCell];
    visited.add(startKey);
    let qIndex = 0;
    let minBx = startCell.bx;
    let maxBx = startCell.bx;
    let minBz = startCell.bz;
    let maxBz = startCell.bz;
    let minY = startCell.minY;
    let maxY = startCell.maxY;
    let totalCount = 0;
    let sumX = 0;
    let sumZ = 0;
    let cellCount = 0;

    while (qIndex < queue.length) {
      const cell = queue[qIndex++];
      cellCount += 1;
      totalCount += cell.count;
      sumX += cell.sumX;
      sumZ += cell.sumZ;
      minY = Math.min(minY, cell.minY);
      maxY = Math.max(maxY, cell.maxY);
      minBx = Math.min(minBx, cell.bx);
      maxBx = Math.max(maxBx, cell.bx);
      minBz = Math.min(minBz, cell.bz);
      maxBz = Math.max(maxBz, cell.bz);

      for (const [ox, oz] of offsets) {
        const nbx = cell.bx + ox;
        const nbz = cell.bz + oz;
        const key = `${nbx}|${nbz}`;
        if (visited.has(key)) continue;
        const neighbor = validCellMap.get(key);
        if (!neighbor) continue;
        visited.add(key);
        queue.push(neighbor);
      }
    }

    if (cellCount > TREE_BIN_MAX_CLUSTER_CELLS || totalCount <= 0) continue;
    const spanX = (maxBx - minBx + 1) * TREE_BIN_SIZE;
    const spanZ = (maxBz - minBz + 1) * TREE_BIN_SIZE;
    const radius = Math.max(0.25, Math.min(1.3, Math.max(spanX, spanZ) * 0.5 + 0.06));
    colliders.push({
      name: mesh.name || "tree",
      x: sumX / totalCount,
      z: sumZ / totalCount,
      radius,
      minY,
      maxY
    });
  }

  return colliders;
};

const createTreeCollidersFromComponents = (mesh) => {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  if (!position || position.count === 0) return [];

  const vertexCount = position.count;
  const parent = new Int32Array(vertexCount);
  const rank = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) parent[i] = i;

  const find = (v) => {
    let p = v;
    while (parent[p] !== p) {
      parent[p] = parent[parent[p]];
      p = parent[p];
    }
    return p;
  };

  const union = (a, b) => {
    let pa = find(a);
    let pb = find(b);
    if (pa === pb) return;
    if (rank[pa] < rank[pb]) {
      const t = pa;
      pa = pb;
      pb = t;
    }
    parent[pb] = pa;
    if (rank[pa] === rank[pb]) rank[pa] += 1;
  };

  const indexAttr = geometry.index;
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      const a = indexAttr.getX(i);
      const b = indexAttr.getX(i + 1);
      const c = indexAttr.getX(i + 2);
      union(a, b);
      union(b, c);
      union(c, a);
    }
  } else {
    for (let i = 0; i + 2 < vertexCount; i += 3) {
      union(i, i + 1);
      union(i + 1, i + 2);
      union(i + 2, i);
    }
  }

  const worldPos = new Vector3();
  const components = new Map();
  for (let i = 0; i < vertexCount; i += 1) {
    const root = find(i);
    let comp = components.get(root);
    if (!comp) {
      comp = {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY
      };
      components.set(root, comp);
    }
    worldPos.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    comp.minX = Math.min(comp.minX, worldPos.x);
    comp.maxX = Math.max(comp.maxX, worldPos.x);
    comp.minY = Math.min(comp.minY, worldPos.y);
    comp.maxY = Math.max(comp.maxY, worldPos.y);
    comp.minZ = Math.min(comp.minZ, worldPos.z);
    comp.maxZ = Math.max(comp.maxZ, worldPos.z);
  }

  const colliders = [];
  for (const comp of components.values()) {
    const width = comp.maxX - comp.minX;
    const depth = comp.maxZ - comp.minZ;
    const height = comp.maxY - comp.minY;
    if (width < 0.03 && depth < 0.03) continue;
    if (height < 0.08) continue;
    const radius = Math.max(0.22, Math.max(width, depth) * 0.55);
    colliders.push({
      name: mesh.name || "tree",
      x: (comp.minX + comp.maxX) * 0.5,
      z: (comp.minZ + comp.maxZ) * 0.5,
      radius,
      minY: comp.minY,
      maxY: comp.maxY
    });
  }

  return colliders;
};

const createTreeColliders = (mesh) => {
  const componentColliders = createTreeCollidersFromComponents(mesh);
  if (
    componentColliders.length > 1 ||
    (componentColliders.length === 1 && componentColliders[0].radius <= LARGE_TREE_COLLIDER_RADIUS)
  ) {
    return componentColliders;
  }

  const binned = createTreeCollidersFromBins(mesh);
  if (binned.length > 0) return binned;

  const fallback = createTreeCollider(mesh);
  return fallback ? [fallback] : [];
};

export const createTerrainRuntime = ({
  sceneRoot,
  terrainMeshWhitelist = DEFAULTS.terrainMeshWhitelist,
  treeMeshNamePatterns = DEFAULTS.treeMeshNamePatterns,
  maxSlopeDeg = DEFAULTS.terrainMaxSlopeDeg,
  stepHeight = DEFAULTS.terrainStepHeight
} = {}) => {
  if (!sceneRoot) return flatFallbackRuntime;

  sceneRoot.updateMatrixWorld(true);

  const isTerrainMesh = buildNameMatcher(terrainMeshWhitelist);
  const isTreeMesh = buildNameMatcher(treeMeshNamePatterns);
  const terrainMeshes = [];
  const treeMeshes = [];

  sceneRoot.traverse((obj) => {
    if (!obj?.isMesh || obj.visible === false) return;
    const name = obj.name || "";
    if (isTerrainMesh(name)) {
      terrainMeshes.push(obj);
      return;
    }
    if (isTreeMesh(name)) {
      treeMeshes.push(obj);
    }
  });

  if (terrainMeshes.length === 0) return flatFallbackRuntime;

  const terrainBoundsBox = new Box3();
  for (const mesh of terrainMeshes) {
    terrainBoundsBox.expandByObject(mesh);
  }

  const bounds = {
    minX: terrainBoundsBox.min.x,
    maxX: terrainBoundsBox.max.x,
    minZ: terrainBoundsBox.min.z,
    maxZ: terrainBoundsBox.max.z
  };
  const rayStartY = Math.max(terrainBoundsBox.max.y + 10, terrainBoundsBox.min.y + MIN_RAY_HEIGHT);
  const rayFar = Math.max(40, rayStartY - terrainBoundsBox.min.y + 20);
  const slopeCos = Math.cos(MathUtils.degToRad(clamp(maxSlopeDeg, 0, 89.5)));
  const safeStepHeight = Math.max(0, stepHeight || 0);
  const terrainRaycaster = new Raycaster();
  const obstacleRaycaster = new Raycaster();
  const rayOrigin = new Vector3();
  const rayDirDown = new Vector3(0, -1, 0);
  const worldNormal = new Vector3(0, 1, 0);
  const treeColliders = treeMeshes.flatMap((mesh) => createTreeColliders(mesh));

  const clampToBounds = (x, z, radius = 0) => {
    const safeRadius = Math.max(0, radius || 0);
    const clampedX = clamp(x, bounds.minX + safeRadius, bounds.maxX - safeRadius);
    const clampedZ = clamp(z, bounds.minZ + safeRadius, bounds.maxZ - safeRadius);
    return { x: clampedX, z: clampedZ, clamped: clampedX !== x || clampedZ !== z };
  };

  const pushOutTrees = (x, z, radius) => {
    let nextX = x;
    let nextZ = z;
    let blocked = false;
    for (let i = 0; i < TREE_PUSH_ITERATIONS; i += 1) {
      let adjusted = false;
      for (const collider of treeColliders) {
        const minDist = collider.radius + radius;
        const dx = nextX - collider.x;
        const dz = nextZ - collider.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist) continue;
        blocked = true;
        adjusted = true;
        const dist = Math.sqrt(Math.max(d2, 1e-8));
        const nx = dist <= 1e-4 ? 1 : dx / dist;
        const nz = dist <= 1e-4 ? 0 : dz / dist;
        nextX = collider.x + nx * minDist;
        nextZ = collider.z + nz * minDist;
      }
      if (!adjusted) break;
    }
    return { x: nextX, z: nextZ, blocked };
  };

  const sampleGround = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    rayOrigin.set(x, rayStartY, z);
    terrainRaycaster.set(rayOrigin, rayDirDown);
    terrainRaycaster.far = rayFar;
    const hits = terrainRaycaster.intersectObjects(terrainMeshes, true);
    if (!hits || hits.length === 0) return null;
    const hit = hits[0];
    if (hit.face) {
      worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
    } else {
      worldNormal.set(0, 1, 0);
    }
    return {
      y: hit.point.y,
      normal: { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z },
      walkable: worldNormal.y >= slopeCos
    };
  };

  const resolveMove = (entityType, from, to, radius = 0) => {
    const safeRadius = Math.max(0, radius || 0);
    const fallbackFrom = {
      x: Number.isFinite(from?.x) ? from.x : 0,
      z: Number.isFinite(from?.z) ? from.z : 0
    };
    const requested = {
      x: Number.isFinite(to?.x) ? to.x : fallbackFrom.x,
      z: Number.isFinite(to?.z) ? to.z : fallbackFrom.z
    };

    const firstClamp = clampToBounds(requested.x, requested.z, safeRadius);
    let nextX = firstClamp.x;
    let nextZ = firstClamp.z;
    let blocked = firstClamp.clamped;

    const treeResolved = pushOutTrees(nextX, nextZ, safeRadius);
    nextX = treeResolved.x;
    nextZ = treeResolved.z;
    blocked = blocked || treeResolved.blocked;

    const secondClamp = clampToBounds(nextX, nextZ, safeRadius);
    nextX = secondClamp.x;
    nextZ = secondClamp.z;
    blocked = blocked || secondClamp.clamped;

    const fromGround = sampleGround(fallbackFrom.x, fallbackFrom.z);
    const nextGround = sampleGround(nextX, nextZ);
    if (!nextGround || !nextGround.walkable) {
      return {
        x: fallbackFrom.x,
        z: fallbackFrom.z,
        blocked: true,
        groundY: fromGround?.y ?? 0,
        normal: fromGround?.normal ?? UP_NORMAL
      };
    }

    const fromGroundY = fromGround?.y ?? nextGround.y;
    if (nextGround.y - fromGroundY > safeStepHeight) {
      return {
        x: fallbackFrom.x,
        z: fallbackFrom.z,
        blocked: true,
        groundY: fromGroundY,
        normal: fromGround?.normal ?? nextGround.normal
      };
    }

    return {
      x: nextX,
      z: nextZ,
      blocked,
      groundY: nextGround.y,
      normal: nextGround.normal
    };
  };

  const isWalkableSpawn = (x, z, radius = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const safeRadius = Math.max(0, radius || 0);
    const clamped = clampToBounds(x, z, safeRadius);
    if (clamped.clamped) return false;
    for (const collider of treeColliders) {
      const minDist = collider.radius + safeRadius;
      const dx = x - collider.x;
      const dz = z - collider.z;
      if (dx * dx + dz * dz < minDist * minDist) {
        return false;
      }
    }
    const ground = sampleGround(x, z);
    return !!ground && ground.walkable;
  };

  const rayOriginVec = new Vector3();
  const rayDirVec = new Vector3();
  const raycastObstacle = (origin, direction, maxDistance = DEFAULTS.bulletRange) => {
    if (!origin || !direction || treeMeshes.length === 0) return null;
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) return null;
    if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z)) return null;
    rayOriginVec.set(origin.x, origin.y, origin.z);
    rayDirVec.set(direction.x, direction.y, direction.z);
    if (rayDirVec.lengthSq() < 1e-8) return null;
    rayDirVec.normalize();
    obstacleRaycaster.set(rayOriginVec, rayDirVec);
    obstacleRaycaster.far = Math.max(0.01, maxDistance || DEFAULTS.bulletRange);
    const hits = obstacleRaycaster.intersectObjects(treeMeshes, true);
    if (!hits || hits.length === 0) return null;
    return hits[0].distance;
  };

  return {
    ready: true,
    sampleGround,
    resolveMove,
    isWalkableSpawn,
    getBounds: () => ({ ...bounds }),
    raycastObstacle,
    debug: {
      terrainMeshes: terrainMeshes.map((mesh) => mesh.name || "terrain"),
      treeColliders
    }
  };
};
