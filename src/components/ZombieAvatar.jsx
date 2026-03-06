import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, MathUtils, Vector3 } from "three";
import HealthBar from "./HealthBar";

const baseBodyColor = new Color("#4f6f47");
const baseHeadColor = new Color("#6d9d5f");
const hitColor = new Color("#ff4242");

export default function ZombieAvatar({ zombie, players }) {
  const ref = useRef();
  const eyeGlow = useRef();
  const bodyMat = useRef();
  const headMat = useRef();
  const leftArm = useRef();
  const rightArm = useRef();
  const leftLeg = useRef();
  const rightLeg = useRef();
  const prevPos = useRef(null);
  const prevHp = useRef(zombie?.hp ?? 45);
  const hitFlash = useRef(0);
  const walkPhase = useRef(Math.random() * Math.PI * 2);
  const target = useMemo(() => new Vector3(), []);

  useFrame((state, dt) => {
    if (!ref.current || !zombie?.position) return;
    target.set(zombie.position.x, 0.7 + (zombie.position.y || 0), zombie.position.z);
    ref.current.position.lerp(target, 0.24);

    if (!prevPos.current) {
      prevPos.current = { x: zombie.position.x, z: zombie.position.z };
    }
    const dx = zombie.position.x - prevPos.current.x;
    const dz = zombie.position.z - prevPos.current.z;
    const speed = Math.hypot(dx, dz);
    prevPos.current = { x: zombie.position.x, z: zombie.position.z };
    walkPhase.current += speed * 18;

    const targetPlayer = players?.[zombie.targetPlayerId];
    if (targetPlayer?.position) {
      const facingY = Math.atan2(
        targetPlayer.position.x - ref.current.position.x,
        targetPlayer.position.z - ref.current.position.z
      );
      ref.current.rotation.y = MathUtils.lerp(ref.current.rotation.y, facingY, 0.16);
    }

    if (leftArm.current && rightArm.current && leftLeg.current && rightLeg.current) {
      const swing = Math.sin(walkPhase.current) * Math.min(0.7, speed * 16);
      leftArm.current.rotation.x = swing;
      rightArm.current.rotation.x = -swing;
      leftLeg.current.rotation.x = -swing * 0.8;
      rightLeg.current.rotation.x = swing * 0.8;
    }

    if (zombie.hp < prevHp.current) {
      hitFlash.current = 1;
      prevHp.current = zombie.hp;
    } else {
      prevHp.current = zombie.hp;
    }

    hitFlash.current = Math.max(0, hitFlash.current - dt * 5.5);
    if (bodyMat.current && headMat.current) {
      bodyMat.current.color.copy(baseBodyColor).lerp(hitColor, hitFlash.current);
      headMat.current.color.copy(baseHeadColor).lerp(hitColor, hitFlash.current);
      bodyMat.current.emissive.setRGB(0.1 + hitFlash.current * 0.35, 0.1, 0.1);
      headMat.current.emissive.setRGB(0.08 + hitFlash.current * 0.35, 0.08, 0.08);
    }

    if (eyeGlow.current) {
      eyeGlow.current.intensity = 1 + Math.sin(state.clock.elapsedTime * 6) * 0.24;
    }
  });

  if (!zombie) return null;

  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[0.9, 1.4, 0.55]} />
        <meshStandardMaterial ref={bodyMat} color="#4f6f47" roughness={0.95} metalness={0.02} emissive="#1d311f" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.62, 0.62, 0.62]} />
        <meshStandardMaterial ref={headMat} color="#6d9d5f" roughness={0.88} />
      </mesh>
      <mesh ref={leftArm} position={[-0.62, 0.58, 0]} castShadow>
        <boxGeometry args={[0.2, 0.82, 0.2]} />
        <meshStandardMaterial color="#4e6a48" roughness={0.9} />
      </mesh>
      <mesh ref={rightArm} position={[0.62, 0.58, 0]} castShadow>
        <boxGeometry args={[0.2, 0.82, 0.2]} />
        <meshStandardMaterial color="#4e6a48" roughness={0.9} />
      </mesh>
      <mesh ref={leftLeg} position={[-0.22, -0.78, 0]} castShadow>
        <boxGeometry args={[0.24, 0.95, 0.24]} />
        <meshStandardMaterial color="#3f5740" roughness={0.9} />
      </mesh>
      <mesh ref={rightLeg} position={[0.22, -0.78, 0]} castShadow>
        <boxGeometry args={[0.24, 0.95, 0.24]} />
        <meshStandardMaterial color="#3f5740" roughness={0.9} />
      </mesh>
      <pointLight ref={eyeGlow} position={[0, 1.1, 0.35]} color="#8df264" intensity={1.1} distance={3} />
      <mesh position={[-0.12, 1.12, 0.32]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color="#9cff78" emissive="#8df264" emissiveIntensity={2} />
      </mesh>
      <mesh position={[0.12, 1.12, 0.32]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color="#9cff78" emissive="#8df264" emissiveIntensity={2} />
      </mesh>
      <HealthBar current={zombie.hp} max={45} offsetY={1.95} width={1.1} />
    </group>
  );
}
