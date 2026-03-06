import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";

let counter = 0;

export default function BulletFx() {
  const [shots, setShots] = useState([]);
  const live = useRef([]);

  useEffect(() => {
    const onShot = (event) => {
      const detail = event.detail;
      if (!detail?.origin || !detail?.direction) return;
      const id = `b_${counter++}`;
      setShots((prev) => [...prev, { id, ...detail, life: 0.15 }]);
    };

    window.addEventListener("shot", onShot);
    return () => window.removeEventListener("shot", onShot);
  }, []);

  useFrame((_, dt) => {
    if (!shots.length) return;
    const next = shots
      .map((s) => ({
        ...s,
        life: s.life - dt,
        origin: {
          x: s.origin.x + s.direction.x * dt * 50,
          y: s.origin.y + s.direction.y * dt * 50,
          z: s.origin.z + s.direction.z * dt * 50
        }
      }))
      .filter((s) => s.life > 0);
    live.current = next;
    setShots(next);
  });

  return (
    <group>
      {live.current.map((b) => (
        <mesh key={b.id} position={[b.origin.x, b.origin.y, b.origin.z]}>
          <sphereGeometry args={[0.055, 7, 7]} />
          <meshBasicMaterial color="#ffe3a2" />
        </mesh>
      ))}
    </group>
  );
}
