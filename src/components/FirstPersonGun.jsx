import { useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { Euler, LoopRepeat, Vector3 } from "three";

const offset = new Vector3(0, -1.02, -1.75);
const lookEuler = new Euler();

export default function FirstPersonGun() {
  const { camera } = useThree();
  const ref = useRef();
  const recoil = useRef(0);
  const reloadPose = useRef(0);
  const reloadPoseTarget = useRef(0);
  const { scene, animations } = useGLTF("/player.glb");
  const { actions, names } = useAnimations(animations, ref);
  const reloadAnimName = useMemo(
    () =>
      names.find((n) => n.toLowerCase().includes("aim")) ||
      names.find((n) => n.toLowerCase().includes("reload")) ||
      null,
    [names]
  );

  useEffect(() => {
    const onShot = () => {
      recoil.current = 0.11;
    };
    const onReloadStart = () => {
      reloadPoseTarget.current = 1;
      if (!reloadAnimName || !actions[reloadAnimName]) return;
      const action = actions[reloadAnimName];
      action.reset();
      action.setLoop(LoopRepeat, Infinity);
      action.clampWhenFinished = true;
      action.fadeIn(0.12).play();
    };
    const onReloadEnd = () => {
      reloadPoseTarget.current = 0;
      if (!reloadAnimName || !actions[reloadAnimName]) return;
      actions[reloadAnimName].fadeOut(0.18);
    };
    window.addEventListener("shot", onShot);
    window.addEventListener("weapon_reload_start", onReloadStart);
    window.addEventListener("weapon_reload_end", onReloadEnd);
    return () => {
      window.removeEventListener("shot", onShot);
      window.removeEventListener("weapon_reload_start", onReloadStart);
      window.removeEventListener("weapon_reload_end", onReloadEnd);
    };
  }, [actions, reloadAnimName]);

  useFrame((state) => {
    if (!ref.current) return;
    recoil.current *= 0.8;
    reloadPose.current += (reloadPoseTarget.current - reloadPose.current) * 0.16;
    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 8) * 0.012;

    const worldOffset = offset.clone().applyQuaternion(camera.quaternion);
    ref.current.position.copy(camera.position).add(worldOffset);
    ref.current.position.y += reloadPose.current * 0.08;
    lookEuler.copy(camera.rotation);
    ref.current.rotation.set(
      lookEuler.x + bob - reloadPose.current * 0.05,
      lookEuler.y + reloadPose.current * 0.08,
      lookEuler.z + reloadPose.current * 0.24
    );
    ref.current.translateZ(recoil.current);
  });

  return (
    <group ref={ref}>
      <primitive object={scene} scale={1.04} position={[1,-0.5,0]} />
    </group>
  );
}

useGLTF.preload("/player.glb");
