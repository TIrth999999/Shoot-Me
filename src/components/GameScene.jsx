import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, FogExp2, Object3D } from "three";
import { useGameStore } from "../state/useGameStore";
import { Sky } from "@react-three/drei";
import PlayerAvatar from "./PlayerAvatar";
import ZombieAvatar from "./ZombieAvatar";
import { DEFAULTS } from "../game/constants";

function AtmosphereLights() {
  const sun = useRef();
  const fill = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (sun.current) {
      sun.current.intensity = 2.6 + Math.sin(t * 0.45) * 0.08;
    }
    if (fill.current) {
      fill.current.intensity = 0.32 + Math.sin(t * 0.35) * 0.04;
    }
  });

  return (
    <>
      <ambientLight intensity={0.58} color="#fff8ea" />
      <hemisphereLight intensity={0.68} color="#cbe7ff" groundColor="#bcd6a8" />
      <directionalLight
        ref={sun}
        position={[42, 62, 18]}
        intensity={2.7}
        color="#fff7dd"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={180}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />
      <directionalLight ref={fill} position={[-28, 20, -16]} intensity={0.36} color="#ffffff" />
    </>
  );
}

function GrassField({ count = 1800 }) {
  const instanced = useRef();
  const dummy = useMemo(() => new Object3D(), []);
  const tint = useMemo(() => new Color(), []);
  const blades = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      const spread = 148;
      const h = 0.35 + Math.random() * 1.1;
      const w = 0.22 + Math.random() * 0.32;
      arr.push({
        x: (Math.random() - 0.5) * spread,
        z: (Math.random() - 0.5) * spread,
        h,
        w,
        rot: Math.random() * Math.PI * 2,
        tiltX: (Math.random() - 0.5) * 0.34,
        tiltZ: (Math.random() - 0.5) * 0.34,
        hue: 0.26 + Math.random() * 0.06,
        sat: 0.42 + Math.random() * 0.2,
        light: 0.28 + Math.random() * 0.14
      });
    }
    return arr;
  }, [count]);

  useLayoutEffect(() => {
    if (!instanced.current) return;
    for (let i = 0; i < blades.length; i += 1) {
      const b = blades[i];
      dummy.position.set(b.x, b.h * 0.5 - 0.01, b.z);
      dummy.rotation.set(b.tiltX, b.rot, b.tiltZ);
      dummy.scale.set(b.w, b.h, b.w);
      dummy.updateMatrix();
      instanced.current.setMatrixAt(i, dummy.matrix);
      tint.setHSL(b.hue, b.sat, b.light);
      instanced.current.setColorAt(i, tint);
    }
    instanced.current.instanceMatrix.needsUpdate = true;
    if (instanced.current.instanceColor) {
      instanced.current.instanceColor.needsUpdate = true;
    }
  }, [blades, dummy]);

  return (
    <instancedMesh ref={instanced} args={[null, null, blades.length]} receiveShadow castShadow>
      <coneGeometry args={[0.2, 1, 6, 1, true]} />
      <meshStandardMaterial vertexColors roughness={0.93} metalness={0.01} emissive="#2e5f27" emissiveIntensity={0.04} />
    </instancedMesh>
  );
}

export default function GameScene() {
  const players = useGameStore((s) => s.players);
  const zombies = useGameStore((s) => s.zombies);
  const selfId = useGameStore((s) => s.selfId);
  const fog = useMemo(() => new FogExp2("#d8ecff", 0.006), []);

  return (
    <>
      <color attach="background" args={[new Color("#a9d8ff")]} />
      <primitive attach="fog" object={fog} />
      <Sky distance={450000} sunPosition={[1, 1, 0.2]} inclination={0.51} azimuth={0.17} turbidity={2.1} rayleigh={2.2} />
      <AtmosphereLights />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[150, 150, 16, 16]} />
        <meshStandardMaterial color="#7fb36a" roughness={0.93} metalness={0.02} emissive="#5f8a4b" emissiveIntensity={0.08} />
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
