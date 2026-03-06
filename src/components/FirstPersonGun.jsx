import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Euler, Vector3 } from "three";

const offset = new Vector3(0, -1.02, -1.75);
const lookEuler = new Euler();

export default function FirstPersonGun() {
  const { camera } = useThree();
  const ref = useRef();
  const recoil = useRef(0);
  const { scene } = useGLTF("/player.glb");

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
    const bob = Math.sin(t * 8) * 0.012;

    const worldOffset = offset.clone().applyQuaternion(camera.quaternion);
    ref.current.position.copy(camera.position).add(worldOffset);
    lookEuler.copy(camera.rotation);
    ref.current.rotation.set(lookEuler.x + bob, lookEuler.y, lookEuler.z);
    ref.current.translateZ(recoil.current);
  });

  return (
    <group ref={ref}>
      <primitive object={scene} scale={1.04} position={[1,-0.5,0]} />
    </group>
  );
}

useGLTF.preload("/player.glb");
