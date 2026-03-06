import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import HealthBar from "./HealthBar";

export default function PlayerAvatar({ player, isSelf = false }) {
  const ref = useRef();
  const target = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!ref.current || !player?.position) return;
    target.set(player.position.x, 0.9 + (player.position.y || 0), player.position.z);
    const alpha = isSelf ? 0.45 : 0.2;
    ref.current.position.lerp(target, alpha);
    ref.current.rotation.y = player.rotation?.yaw || 0;
  });

  if (!player) return null;

  return (
    <group ref={ref}>
      <mesh castShadow>
        <capsuleGeometry args={[0.55, 1.1, 4, 8]} />
        <meshStandardMaterial
          color={isSelf ? "#9ea7bf" : "#676f83"}
          roughness={0.85}
          metalness={0.08}
          emissive={isSelf ? "#28374f" : "#15171f"}
          emissiveIntensity={isSelf ? 0.65 : 0.3}
        />
      </mesh>
      <mesh position={[0, 1.2, 0.55]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color="#c1d9ff" emissive="#9cc2ff" emissiveIntensity={1.6} />
      </mesh>
      {!isSelf && <HealthBar current={player.hp} max={100} offsetY={2.05} width={1.15} />}
    </group>
  );
}
