import { useFrame } from "@react-three/fiber";
import { Sky, useGLTF } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Box3, Color, Fog, Vector3 } from "three";
import { useGameStore } from "../state/useGameStore";
import { DEFAULTS } from "../game/constants";
import { createTerrainRuntime, registerTerrainRuntime } from "../game/terrainRuntime";
import PlayerAvatar from "./PlayerAvatar";
import ZombieAvatar from "./ZombieAvatar";

function AtmosphereLights() {
  const sun = useRef();
  const fill = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (sun.current) {
      sun.current.intensity = 2.25 + Math.sin(t * 0.45) * 0.08;
    }
    if (fill.current) {
      fill.current.intensity = 0.28 + Math.sin(t * 0.35) * 0.03;
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} color="#00b3b0" />
      <hemisphereLight intensity={0.56} color="#00b3b0" groundColor="rgb(0, 78, 90)" />
      <directionalLight
        ref={sun}
        position={[34, 34, 60]}
        intensity={2.3}
        color="#00b3b0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
      />
      <directionalLight ref={fill} position={[-28, 18, -16]} intensity={0.26} color="#ffce8a" />
    </>
  );
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

function ForestTerrain() {
  const gltf = useGLTF("/forest.glb");
  const terrainRef = useRef();
  const sizeVec = useMemo(() => new Vector3(), []);
  const forestScene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useLayoutEffect(() => {
    forestScene.traverse((obj) => {
      if (!obj?.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
  }, [forestScene]);

  const transform = useMemo(() => {
    const box = new Box3().setFromObject(forestScene);
    box.getSize(sizeVec);
    const footprint = Math.max(0.001, sizeVec.x, sizeVec.z);
    const autoFitScale = DEFAULTS.forestAutoFitTargetSize / footprint;
    const scale = Math.max(0.001, autoFitScale * DEFAULTS.forestScaleMultiplier);
    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    return {
      scale,
      position: [-centerX * scale, -box.min.y * scale, -centerZ * scale]
    };
  }, [forestScene, sizeVec]);

  useLayoutEffect(() => {
    if (!terrainRef.current) return;
    terrainRef.current.updateMatrixWorld(true);
    const runtime = createTerrainRuntime({
      sceneRoot: terrainRef.current,
      terrainMeshWhitelist: DEFAULTS.terrainMeshWhitelist,
      treeMeshNamePatterns: DEFAULTS.treeMeshNamePatterns,
      maxSlopeDeg: DEFAULTS.terrainMaxSlopeDeg,
      stepHeight: DEFAULTS.terrainStepHeight
    });
    registerTerrainRuntime(runtime);
    return () => {
      registerTerrainRuntime(null);
    };
  }, [transform]);

  return (
    <group ref={terrainRef} scale={[transform.scale, transform.scale, transform.scale]} position={transform.position}>
      <primitive object={forestScene} />
    </group>
  );
}

export default function GameScene() {
  const players = useGameStore((s) => s.players);
  const zombies = useGameStore((s) => s.zombies);
  const selfId = useGameStore((s) => s.selfId);
  const fog = useMemo(() => new Fog("#00b3b0", 30, 108), []);

  return (
    <>
      <color attach="background" args={[new Color("#23383a")]} />
      <primitive attach="fog" object={fog} />
      <Sky
        distance={450000}
        sunPosition={[0, 0, 0]}
        inclination={0.64}
        azimuth={0.28}
        turbidity={4.2}
        rayleigh={0.35}
        mieCoefficient={0.02}
      />
      <AtmosphereLights />
      <ForestTerrain />
      <GhostParticles />

      {Object.entries(players).map(([id, player]) => (
        DEFAULTS.firstPerson && id === selfId ? null : <PlayerAvatar key={id} player={player} isSelf={id === selfId} />
      ))}

      {Object.values(zombies).map((z) => (
        <ZombieAvatar key={z.id} zombie={z} players={players} />
      ))}
    </>
  );
}

useGLTF.preload("/forest.glb");
