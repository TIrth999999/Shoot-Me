import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";

let counter = 0;
const BULLET_SPEED = 50;
const FX_MAX_DIST = 7.5;

export default function BulletFx() {
  const [shots, setShots] = useState([]);
  const live = useRef([]);

  useEffect(() => {
    const onShot = (event) => {
      const detail = event.detail;
      if (!detail?.origin || !detail?.direction) return;
      const id = `b_${counter++}`;
      const maxDistance = Number.isFinite(detail.maxDistance)
        ? Math.max(0.2, Math.min(detail.maxDistance, FX_MAX_DIST))
        : FX_MAX_DIST;
      setShots((prev) => [...prev, { id, ...detail, distanceLeft: maxDistance }]);
    };

    window.addEventListener("shot", onShot);
    return () => window.removeEventListener("shot", onShot);
  }, []);

  useFrame((_, dt) => {
    if (!shots.length) return;
    const next = shots
      .map((s) => ({
        ...s,
        distanceLeft: s.distanceLeft - BULLET_SPEED * dt,
        origin: {
          x: s.origin.x + s.direction.x * dt * BULLET_SPEED,
          y: s.origin.y + s.direction.y * dt * BULLET_SPEED,
          z: s.origin.z + s.direction.z * dt * BULLET_SPEED
        }
      }))
      .filter((s) => s.distanceLeft > 0);
    live.current = next;
    setShots(next);
  });

  return (
    <group>
      {live.current.map((b) => {
        const dir = new Vector3(b.direction.x, b.direction.y, b.direction.z).normalize();
        const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
        return (
          <group key={b.id} position={[b.origin.x, b.origin.y, b.origin.z]} quaternion={rotation}>
            <mesh position={[0, 0.065, 0]}>
              <coneGeometry args={[0.012, 0.13, 8]} />
              <meshBasicMaterial color="#ff2a00" />
            </mesh>
            <mesh position={[0, 0.01, 0]}>
              <coneGeometry args={[0.018, 0.09, 8]} />
              <meshBasicMaterial color="#ff9a1f" />
            </mesh>
            <mesh position={[0, -0.14, 0]}>
              <cylinderGeometry args={[0.004, 0.014, 0.3, 8, 1, true]} />
              <meshBasicMaterial color="#ff5a1f" transparent opacity={0.58} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
