/** @format */

import { useFrame, useThree } from "@react-three/fiber";
import { SpotLight, useGLTF } from "@react-three/drei";
import { EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box3, Color, Uniform, Vector3 } from "three";
import { useGameStore } from "../state/useGameStore";
import { DEFAULTS } from "../game/constants";
import { createTerrainRuntime, registerTerrainRuntime } from "../game/terrainRuntime";
import { buildTileCoords, createTerrainStreamRuntime, getTileVariation } from "../game/terrainStreamRuntime";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import PlayerAvatar from "./PlayerAvatar";
import ZombieAvatar from "./ZombieAvatar";

const EPS = 1e-5;

const fogShader = `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
uniform float heightFogStart;
uniform float heightFogEnd;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float distFog = smoothstep(fogNear, fogFar, depth);
  float expFog = 1.0 - exp(-depth * depth * fogDensity);
  float heightFog = smoothstep(heightFogEnd, heightFogStart, uv.y);
  float fogFactor = clamp(max(distFog, expFog) * (0.45 + heightFog * 0.75), 0.0, 1.0);
  vec3 color = mix(inputColor.rgb, fogColor, fogFactor);
  outputColor = vec4(color, inputColor.a);
}
`;

class RealisticFogEffectImpl extends Effect {
  constructor({
    fogColor = "#d5e0e2",
    fogNear = 0.15,
    fogFar = 0.88,
    fogDensity = 0.72,
    heightFogStart = 0.56,
    heightFogEnd = -0.08
  } = {}) {
    super("RealisticFogEffect", fogShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ["fogColor", new Uniform(new Color(fogColor))],
        ["fogNear", new Uniform(fogNear)],
        ["fogFar", new Uniform(fogFar)],
        ["fogDensity", new Uniform(fogDensity)],
        ["heightFogStart", new Uniform(heightFogStart)],
        ["heightFogEnd", new Uniform(heightFogEnd)]
      ])
    });
  }
}

function RealisticFogEffect(props) {
  const effect = useMemo(() => new RealisticFogEffectImpl(props), []);

  useEffect(() => {
    effect.uniforms.get("fogColor").value.set(props.fogColor ?? "#9db0b3");
    effect.uniforms.get("fogNear").value = props.fogNear ?? 0.15;
    effect.uniforms.get("fogFar").value = props.fogFar ?? 0.88;
    effect.uniforms.get("fogDensity").value = props.fogDensity ?? 0.72;
    effect.uniforms.get("heightFogStart").value = props.heightFogStart ?? 0.56;
    effect.uniforms.get("heightFogEnd").value = props.heightFogEnd ?? -0.08;
  }, [effect, props]);

  return <primitive object={effect} dispose={null} />;
}

const buildNameMatcher = (patterns = []) => {
  const lowered = patterns
    .filter((pattern) => typeof pattern === "string" && pattern.trim().length > 0)
    .map((pattern) => pattern.trim().toLowerCase());
  if (lowered.length === 0) return () => false;
  return (name) => {
    const value = String(name || "").toLowerCase();
    return lowered.some((pattern) => value === pattern || value.includes(pattern));
  };
};

const configureShadows = (root) => {
  root?.traverse?.((obj) => {
    if (!obj?.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
};

const computeForestMeta = (root) => {
  if (!root) {
    return {
      scale: 1,
      tileSizeX: Math.max(1, DEFAULTS.worldWidth),
      tileSizeZ: Math.max(1, DEFAULTS.worldDepth),
      tileStrideX: Math.max(1, DEFAULTS.worldWidth),
      tileStrideZ: Math.max(1, DEFAULTS.worldDepth),
      baseX: 0,
      baseY: 0,
      baseZ: 0
    };
  }

  root.updateMatrixWorld(true);
  const meshMatcher = buildNameMatcher(DEFAULTS.terrainMeshWhitelist);
  const fullBounds = new Box3().setFromObject(root);
  const terrainBounds = new Box3();
  let hasTerrainBounds = false;

  root.traverse((obj) => {
    if (!obj?.isMesh || obj.visible === false) return;
    if (!meshMatcher(obj.name || "")) return;
    terrainBounds.expandByObject(obj);
    hasTerrainBounds = true;
  });

  const basis = hasTerrainBounds ? terrainBounds : fullBounds;
  const sizeVec = new Vector3();
  basis.getSize(sizeVec);
  const baseFootprint = Math.max(0.001, sizeVec.x, sizeVec.z);
  const autoFitScale = DEFAULTS.forestAutoFitTargetSize / baseFootprint;
  const scale = Math.max(0.001, autoFitScale * DEFAULTS.forestScaleMultiplier);
  const derivedTileSizeX = Math.max(1, sizeVec.x * scale);
  const derivedTileSizeZ = Math.max(1, sizeVec.z * scale);
  const configuredTileSize = Number.isFinite(DEFAULTS.terrainTileSize) ? DEFAULTS.terrainTileSize : 0;
  const tileSizeX = configuredTileSize > 0 ? configuredTileSize : derivedTileSizeX;
  const tileSizeZ = configuredTileSize > 0 ? configuredTileSize : derivedTileSizeZ;
  const tileStrideX = tileSizeX-1.8;
  const tileStrideZ = tileSizeZ-1.09;

  return {
    scale,
    tileSizeX,
    tileSizeZ,
    tileStrideX,
    tileStrideZ,
    baseX: -basis.min.x * scale,
    baseY: -basis.min.y * scale,
    baseZ: -basis.min.z * scale
  };
};

function ForestTileStream() {
  const gltf = useGLTF("/forest.glb");
  const streamRootRef = useRef();
  const tilesRef = useRef(new Map());
  const previousLogicalRef = useRef({ x: 0, z: 0, hasValue: false });
  const streamRuntimeRef = useRef(createTerrainStreamRuntime());
  const terrainSeed = useGameStore((s) => s.terrainSeed);
  const forestMeta = useMemo(() => computeForestMeta(gltf.scene), [gltf.scene]);

  const disposeTile = useCallback((entry) => {
    if (!entry) return;
    const root = streamRootRef.current;
    if (root && entry.object) {
      root.remove(entry.object);
    }
    entry.object?.clear?.();
  }, []);

  const disposeAllTiles = useCallback(() => {
    const tiles = tilesRef.current;
    for (const entry of tiles.values()) {
      disposeTile(entry);
    }
    tiles.clear();
  }, [disposeTile]);

  const buildTileRuntime = useCallback(
    (entry) =>
      createTerrainRuntime({
        sceneRoot: entry.object,
        terrainMeshWhitelist: DEFAULTS.terrainMeshWhitelist,
        treeMeshNamePatterns: DEFAULTS.treeMeshNamePatterns,
        maxSlopeDeg: DEFAULTS.terrainMaxSlopeDeg,
        stepHeight: DEFAULTS.terrainStepHeight
      }),
    []
  );

  const applyTileTransform = useCallback(
    (entry, worldOriginOffset) => {
      const offsetX = Number.isFinite(worldOriginOffset?.x) ? worldOriginOffset.x : 0;
      const offsetY = Number.isFinite(worldOriginOffset?.y) ? worldOriginOffset.y : 0;
      const offsetZ = Number.isFinite(worldOriginOffset?.z) ? worldOriginOffset.z : 0;
      const worldX = entry.tx * forestMeta.tileStrideX;
      const worldZ = entry.tz * forestMeta.tileStrideZ;
      const targetX = forestMeta.baseX + worldX + offsetX;
      const targetY = forestMeta.baseY + offsetY;
      const targetZ = forestMeta.baseZ + worldZ + offsetZ;
      const moved =
        Math.abs(entry.object.position.x - targetX) > EPS ||
        Math.abs(entry.object.position.y - targetY) > EPS ||
        Math.abs(entry.object.position.z - targetZ) > EPS ||
        Math.abs(entry.object.rotation.y - entry.variation.rotationY) > EPS ||
        Math.abs(entry.object.scale.x - forestMeta.scale) > EPS;
      if (!moved) return false;
      entry.object.position.set(targetX, targetY, targetZ);
      entry.object.rotation.set(0, entry.variation.rotationY, 0);
      entry.object.scale.setScalar(forestMeta.scale);
      entry.object.updateMatrixWorld(true);
      return true;
    },
    [forestMeta]
  );

  const ensureTile = useCallback(
    ({ tx, tz, key, visible, worldOriginOffset }) => {
      const tiles = tilesRef.current;
      let entry = tiles.get(key);
      if (!entry) {
        const object = gltf.scene.clone(true);
        configureShadows(object);
        const variation = getTileVariation({
          tx,
          tz,
          seed: terrainSeed
        });
        entry = {
          key,
          tx,
          tz,
          object,
          variation,
          runtime: null
        };
        applyTileTransform(entry, worldOriginOffset);
        streamRootRef.current?.add(object);
        entry.runtime = buildTileRuntime(entry);
        tiles.set(key, entry);
      } else {
        const moved = applyTileTransform(entry, worldOriginOffset);
        if (moved) {
          entry.runtime = buildTileRuntime(entry);
        }
      }
      entry.object.visible = !!visible;
      return entry;
    },
    [applyTileTransform, buildTileRuntime, gltf.scene, terrainSeed]
  );

  useEffect(() => {
    streamRuntimeRef.current.setTileSize({
      x: forestMeta.tileStrideX,
      z: forestMeta.tileStrideZ
    });
  }, [forestMeta.tileStrideX, forestMeta.tileStrideZ]);

  useEffect(() => {
    const runtime = streamRuntimeRef.current;
    registerTerrainRuntime(runtime);
    return () => {
      disposeAllTiles();
      runtime.updateTiles({ tileEntries: new Map(), activeKeys: new Set() });
      registerTerrainRuntime(null);
    };
  }, [disposeAllTiles]);

  useEffect(() => {
    disposeAllTiles();
    previousLogicalRef.current = { x: 0, z: 0, hasValue: false };
    streamRuntimeRef.current.updateTiles({ tileEntries: new Map(), activeKeys: new Set() });
  }, [terrainSeed, disposeAllTiles]);

  useFrame(() => {
    const state = useGameStore.getState();
    const self = state.players[state.selfId];
    const localX = Number.isFinite(self?.position?.x) ? self.position.x : 0;
    const localZ = Number.isFinite(self?.position?.z) ? self.position.z : 0;
    const worldOriginOffset = state.worldOriginOffset || { x: 0, y: 0, z: 0 };

    if (state.netMode === "solo") {
      const rebaseThreshold = Math.max(0, DEFAULTS.terrainRebaseDistance || 0);
      if (rebaseThreshold > 0 && Math.hypot(localX, localZ) >= rebaseThreshold) {
        state.applyWorldRebase?.({
          delta: { x: -localX, y: 0, z: -localZ }
        });
        return;
      }
    }

    const logicalX = localX - (worldOriginOffset.x || 0);
    const logicalZ = localZ - (worldOriginOffset.z || 0);
    const tileSizeX = Math.max(1, forestMeta.tileStrideX || DEFAULTS.worldWidth);
    const tileSizeZ = Math.max(1, forestMeta.tileStrideZ || DEFAULTS.worldDepth);
    const centerTx = Math.floor(logicalX / tileSizeX);
    const centerTz = Math.floor(logicalZ / tileSizeZ);

    const prev = previousLogicalRef.current;
    const moveX = prev.hasValue ? logicalX - prev.x : 0;
    const moveZ = prev.hasValue ? logicalZ - prev.z : 0;
    previousLogicalRef.current = { x: logicalX, z: logicalZ, hasValue: true };

    const { visible, prewarm } = buildTileCoords({
      centerTx,
      centerTz,
      ring: DEFAULTS.terrainTileRing,
      prewarmTiles: DEFAULTS.terrainPrewarmTiles,
      moveX,
      moveZ
    });

    const desired = new Map();
    const toKey = streamRuntimeRef.current.toTileKey;
    for (const coord of visible) {
      desired.set(toKey(coord.tx, coord.tz), { ...coord, visible: true });
    }
    for (const coord of prewarm) {
      const key = toKey(coord.tx, coord.tz);
      if (!desired.has(key)) {
        desired.set(key, { ...coord, visible: false });
      }
    }

    for (const [key, coord] of desired.entries()) {
      ensureTile({
        tx: coord.tx,
        tz: coord.tz,
        key,
        visible: coord.visible,
        worldOriginOffset
      });
    }

    const tiles = tilesRef.current;
    const disposeRadius = Math.max(
      (DEFAULTS.terrainTileRing || 1) + Math.max(0, DEFAULTS.terrainDisposeMarginTiles || 0),
      (DEFAULTS.terrainTileRing || 1) + Math.max(0, DEFAULTS.terrainPrewarmTiles || 0) + 1
    );
    for (const [key, entry] of tiles.entries()) {
      if (desired.has(key)) continue;
      const tileDist = Math.max(Math.abs(entry.tx - centerTx), Math.abs(entry.tz - centerTz));
      if (tileDist > disposeRadius) {
        disposeTile(entry);
        tiles.delete(key);
        continue;
      }
      const moved = applyTileTransform(entry, worldOriginOffset);
      if (moved) {
        entry.runtime = buildTileRuntime(entry);
      }
      entry.object.visible = false;
    }

    const activeKeys = new Set();
    for (const coord of visible) {
      const key = toKey(coord.tx, coord.tz);
      if (tiles.has(key)) activeKeys.add(key);
    }

    streamRuntimeRef.current.setTileSize({ x: tileSizeX, z: tileSizeZ });
    streamRuntimeRef.current.setCenterTile(centerTx, centerTz);
    streamRuntimeRef.current.updateTiles({
      tileEntries: tiles,
      activeKeys
    });
  });

  return <group ref={streamRootRef} />;
}

function GhostParticles({ count = 72 }) {
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      arr.push({
        radius: 78 + Math.random() * 28,
        angle: Math.random() * Math.PI * 2,
        speed: (Math.random() > 0.5 ? 1 : -1) * (0.03 + Math.random() * 0.08),
        y: 0.8 + Math.random() * 10.5,
        bobAmp: 0.2 + Math.random() * 1.1,
        bobSpeed: 0.45 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        size: 0.1 + Math.random() * 0.32,
        color: "#00b3b0"
      });
    }
    return arr;
  }, [count]);
  const refs = useRef([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const mesh = refs.current[i];
      if (!mesh) continue;
      const a = p.angle + t * p.speed;
      mesh.position.set(
        Math.cos(a) * p.radius,
        p.y + Math.sin(t * p.bobSpeed + p.phase) * p.bobAmp,
        Math.sin(a) * p.radius
      );
    }
  });

  return (
    <group>
      {particles.map((p, i) => (
        <mesh
          key={`ghost_${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[Math.cos(p.angle) * p.radius, p.y, Math.sin(p.angle) * p.radius]}
        >
          <sphereGeometry args={[p.size, 10, 10]} />
          <meshStandardMaterial
            color={p.color}
            emissive={p.color}
            emissiveIntensity={2.8}
            transparent
            opacity={0.86}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function PlayerTorch() {
  const { camera } = useThree();
  const spotRef = useRef();
  const targetRef = useRef();
  const leftHandOffset = useMemo(() => new Vector3(-0.76, 0.34, -1.8), []);
  const beamTarget = useMemo(() => new Vector3(), []);
  const offsetWorld = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!spotRef.current || !targetRef.current) return;
    offsetWorld.copy(leftHandOffset).applyQuaternion(camera.quaternion);
    spotRef.current.position.copy(camera.position).add(offsetWorld);
    camera.getWorldDirection(beamTarget);
    targetRef.current.position.copy(camera.position).addScaledVector(beamTarget, 28);
    targetRef.current.updateMatrixWorld();
    if (spotRef.current.target !== targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  });

  return (
    <>
      <ambientLight intensity={0.12} />
      <SpotLight
        ref={spotRef}
        penumbra={1}
        distance={108}
        angle={0.58}
        attenuation={7}
        anglePower={50}
        intensity={164}
        volumetric
        castShadow
      />
      <object3D ref={targetRef} />
    </>
  );
}

export default function GameScene() {
  const players = useGameStore((s) => s.players);
  const zombies = useGameStore((s) => s.zombies);
  const selfId = useGameStore((s) => s.selfId);

  return (
    <>
      <color attach="background" args={[new Color("black")]} />
      <ForestTileStream />
      <GhostParticles />
      <PlayerTorch />
      <EffectComposer multisampling={0}>
        <RealisticFogEffect
          fogColor="#94b1b5"
          fogNear={0.72}
          fogFar={15}
          fogDensity={0.00016}
          heightFogStart={0.112}
          heightFogEnd={0.104}
        />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.04} />
        <Vignette offset={0.2} darkness={0.25} eskil={false} />
      </EffectComposer>
      {Object.entries(players).map(([id, player]) =>
        DEFAULTS.firstPerson && id === selfId ? null : (
          <PlayerAvatar key={id} player={player} isSelf={id === selfId} />
        )
      )}
      {Object.values(zombies).map((z) => (
        <ZombieAvatar key={z.id} zombie={z} players={players} />
      ))}
    </>
  );
}

useGLTF.preload("/forest.glb");
