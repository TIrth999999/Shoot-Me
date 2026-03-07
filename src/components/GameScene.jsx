import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Fog, Object3D } from "three";
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
        shadow-camera-far={180}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
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
  const fog = useMemo(() => new Fog("#00b3b0", 30, 108), []);

  return (
    <>
      <color attach="background" args={[new Color("#23383a")]} />
      <primitive attach="fog" object={fog} />
      <Sky
        distance={450000}
        sunPosition={[0,0,0]}
        inclination={0.64}
        azimuth={0.28}
        turbidity={4.2}
        rayleigh={0.35}
        mieCoefficient={0.02}
      />
      <AtmosphereLights />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[150, 150, 16, 16]} />
        <meshStandardMaterial color="#5f503a" roughness={0.93} metalness={0.02} emissive="#553623" emissiveIntensity={0.16} />
      </mesh>
      <GhostParticles />
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
