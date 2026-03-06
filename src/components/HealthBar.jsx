import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { MathUtils } from "three";
import { Billboard } from "@react-three/drei";

export default function HealthBar({ current = 100, max = 100, offsetY = 2, width = 1.2 }) {
  const group = useRef();
  const fill = useRef();
  const value = useMemo(() => ({ ratio: 1 }), []);

  useFrame(() => {
    if (!group.current || !fill.current) return;
    value.ratio = MathUtils.lerp(value.ratio, Math.max(0, Math.min(1, current / max)), 0.2);
    fill.current.scale.x = Math.max(0.02, value.ratio);
    fill.current.position.x = -(width * (1 - value.ratio)) * 0.5;
  });

  const hue = current / max > 0.55 ? "#78ff7e" : current / max > 0.25 ? "#ffd45a" : "#ff5d5d";

  return (
    <Billboard position={[0, offsetY, 0]}>
      <group ref={group}>
        <mesh>
          <planeGeometry args={[width, 0.14]} />
          <meshBasicMaterial color="#1d1d1d" transparent opacity={0.88} />
        </mesh>
        <mesh ref={fill} position={[0, 0, 0.01]}>
          <planeGeometry args={[width, 0.1]} />
          <meshBasicMaterial color={hue} />
        </mesh>
      </group>
    </Billboard>
  );
}
