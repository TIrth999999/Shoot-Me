import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, FogExp2, Object3D } from "three";
import { useGameStore } from "../state/useGameStore";
import { Sky } from "@react-three/drei";
import PlayerAvatar from "./PlayerAvatar";
import ZombieAvatar from "./ZombieAvatar";
import { DEFAULTS } from "../game/constants";

function AtmosphereLights() {
  const key = useRef();
  const horror = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (key.current) {
      key.current.intensity = 0.45 + Math.sin(t * 3.2) * 0.08;
    }
    if (horror.current) {
      horror.current.intensity = 0.6 + Math.sin(t * 17) * 0.2 + Math.sin(t * 9) * 0.08;
    }
  });

  return (
    <>
      <ambientLight intensity={0.42} color="#8492a8" />
      <hemisphereLight intensity={0.45} color="#8fa6bf" groundColor="#1a1f27" />
      <directionalLight
        ref={key}
        position={[9, 14, 5]}
        intensity={1.15}
        color="#c0d7eb"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight ref={horror} position={[0, 8, 0]} color="#8ebad9" intensity={1.05} distance={48} />
    </>
  );
}

function GrassField({ count = 1800 }) {
  const instanced = useRef();
  const dummy = useMemo(() => new Object3D(), []);
  const blades = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      arr.push({
        x: (Math.random() - 0.5) * 148,
        z: (Math.random() - 0.5) * 148,
        h: 0.25 + Math.random() * 0.8,
        rot: Math.random() * Math.PI
      });
    }
    return arr;
  }, [count]);

  useLayoutEffect(() => {
    if (!instanced.current) return;
    for (let i = 0; i < blades.length; i += 1) {
      const b = blades[i];
      dummy.position.set(b.x, b.h * 0.5 - 0.01, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.set(1, b.h, 1);
      dummy.updateMatrix();
      instanced.current.setMatrixAt(i, dummy.matrix);
    }
    instanced.current.instanceMatrix.needsUpdate = true;
  }, [blades, dummy]);

  return (
    <instancedMesh ref={instanced} args={[null, null, blades.length]} receiveShadow castShadow>
      <boxGeometry args={[0.06, 1, 0.06]} />
      <meshStandardMaterial color="#3d6a3f" roughness={0.96} metalness={0.02} emissive="#163118" emissiveIntensity={0.25} />
    </instancedMesh>
  );
}

export default function GameScene() {
  const players = useGameStore((s) => s.players);
  const zombies = useGameStore((s) => s.zombies);
  const selfId = useGameStore((s) => s.selfId);
  const fog = useMemo(() => new FogExp2("#0a0f17", 0.02), []);

  return (
    <>
      <color attach="background" args={[new Color("#040508")]} />
      <primitive attach="fog" object={fog} />
      <Sky distance={450000} sunPosition={[0, 0.8, -1]} inclination={0.58} azimuth={0.24} turbidity={8} rayleigh={0.7} />
      <AtmosphereLights />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[150, 150, 16, 16]} />
        <meshStandardMaterial color="#486648" roughness={0.95} metalness={0.03} emissive="#1b2f1d" emissiveIntensity={0.45} />
      </mesh>
      <GrassField />

      {Object.entries(players).map(([id, player]) => (
        DEFAULTS.firstPerson && id === selfId ? null : <PlayerAvatar key={id} player={player} isSelf={id === selfId} />
      ))}

      {Object.values(zombies).map((z) => (
        <ZombieAvatar key={z.id} zombie={z} players={players} />
      ))}
    </>
  );
}
