import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Euler, Vector3 } from "three";

const offset = new Vector3(0.38, -0.26, -0.62);
const lookEuler = new Euler();

export default function FirstPersonGun() {
  const { camera } = useThree();
  const ref = useRef();
  const recoil = useRef(0);

  useEffect(() => {
    const onShot = () => {
      recoil.current = 0.11;
    };
    window.addEventListener("shot", onShot);
    return () => window.removeEventListener("shot", onShot);
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    recoil.current *= 0.8;
    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 8) * 0.008;

    const worldOffset = offset.clone().applyQuaternion(camera.quaternion);
    ref.current.position.copy(camera.position).add(worldOffset);
    lookEuler.copy(camera.rotation);
    ref.current.rotation.set(lookEuler.x + bob, lookEuler.y, lookEuler.z);
    ref.current.translateZ(recoil.current);
  });

  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[0.2, 0.16, 0.52]} />
        <meshStandardMaterial color="#404757" roughness={0.55} metalness={0.6} />
      </mesh>
      <mesh position={[0, -0.11, 0.08]} castShadow>
        <boxGeometry args={[0.1, 0.2, 0.16]} />
        <meshStandardMaterial color="#252a35" roughness={0.7} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.02, 0.29]}>
        <boxGeometry args={[0.045, 0.05, 0.12]} />
        <meshStandardMaterial color="#1a1f2a" roughness={0.4} metalness={0.9} emissive="#1a1a1a" />
      </mesh>
    </group>
  );
}
