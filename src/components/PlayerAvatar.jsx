import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import HealthBar from "./HealthBar";
import { DEFAULTS } from "../game/constants";

export default function PlayerAvatar({ player, isSelf = false }) {
  const ref = useRef();
  const target = useMemo(() => new Vector3(), []);
  const interpPos = useRef({ x: 0, y: 0, z: 0 });
  const interpYaw = useRef(0);

  useFrame(() => {
    if (!ref.current || !player?.position) return;
    if (!isSelf && Array.isArray(player.netSamples) && player.netSamples.length > 0) {
      const renderTs = Date.now() - DEFAULTS.remoteInterpolationDelayMs;
      const samples = player.netSamples;
      let chosenPos = samples[samples.length - 1].position;
      let chosenRot = samples[samples.length - 1].rotation;

      for (let i = 1; i < samples.length; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        if (a.ts <= renderTs && renderTs <= b.ts) {
          const span = Math.max(1, b.ts - a.ts);
          const t = Math.max(0, Math.min(1, (renderTs - a.ts) / span));
          chosenPos = {
            x: a.position.x + (b.position.x - a.position.x) * t,
            y: (a.position.y || 0) + ((b.position.y || 0) - (a.position.y || 0)) * t,
            z: a.position.z + (b.position.z - a.position.z) * t
          };
          chosenRot = {
            yaw: (a.rotation?.yaw || 0) + ((b.rotation?.yaw || 0) - (a.rotation?.yaw || 0)) * t
          };
          break;
        }
      }

      interpPos.current = chosenPos;
      interpYaw.current = chosenRot?.yaw || 0;
    } else {
      interpPos.current = player.position;
      interpYaw.current = player.rotation?.yaw || 0;
    }

    target.set(interpPos.current.x, 0.9 + (interpPos.current.y || 0), interpPos.current.z);
    const alpha = isSelf ? 0.45 : 0.2;
    ref.current.position.lerp(target, alpha);
    ref.current.rotation.y = interpYaw.current;
  });

  if (!player) return null;

  return (
    <group ref={ref}>
      {/* <mesh castShadow>
        <capsuleGeometry args={[0.62, 1.28, 5, 10]} />
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
      </mesh> */}
      {!isSelf && <HealthBar current={player.hp} max={100} offsetY={2.05} width={1.15} />}
    </group>
  );
}
