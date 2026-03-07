import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Box3, LoopOnce, MathUtils, Vector3 } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import HealthBar from "./HealthBar";
import { DEFAULTS } from "../game/constants";
import { useGameStore } from "../state/useGameStore";

export default function ZombieAvatar({ zombie, players }) {
  const ref = useRef();
  const modelRef = useRef();
  const prevPos = useRef(null);
  const target = useMemo(() => new Vector3(), []);
  const modelLocalOffset = useMemo(() => ({ x: 1, y: -0.12, z: 0 }), []);
  const purgeZombie = useGameStore((s) => s.purgeZombie);
  const gltf = useGLTF("/zombie2.glb");
  const { scene, modelScale, modelYOffset, healthBarOffset } = useMemo(() => {
    const sourceRoot =
      gltf.scene.getObjectByName("Sketchfab_model") ||
      gltf.scene.children.find((c) => typeof c.name === "string" && c.name.toLowerCase().includes("sketchfab_model")) ||
      gltf.scene;
    const cloned = clone(sourceRoot);
    cloned.traverse((obj) => {
      const nodeName = (obj.name || "").toLowerCase();
      const isHelperByType = obj.isCamera || obj.isLight || obj.type === "Audio" || obj.type === "PositionalAudio";
      const isHelperByName =
        nodeName.includes("camera") ||
        nodeName.includes("audio") ||
        nodeName.includes("omni") ||
        nodeName.includes("spot") ||
        nodeName.includes("target") ||
        nodeName.includes("particle") ||
        nodeName.includes("particles");
      if (isHelperByType || isHelperByName) {
        obj.visible = false;
      }

      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    const box = new Box3().setFromObject(cloned);
    const rawHeight = Math.max(0.001, box.max.y - box.min.y);
    const targetHeight = DEFAULTS.zombieBodyHeight;
    const normalizedScale = Math.min(220, Math.max(0.2, targetHeight / rawHeight));
    const yOffset = -box.min.y * normalizedScale;
    return {
      scene: cloned,
      modelScale: normalizedScale,
      modelYOffset: yOffset,
      healthBarOffset: targetHeight + DEFAULTS.zombieHealthBarHeadroom
    };
  }, [gltf.scene]);
  const { actions, names } = useAnimations(gltf.animations, modelRef);
  const walkActionName = useMemo(
    () => names.find((n) => n.toLowerCase().includes("walk")) || names[0],
    [names]
  );
  const sitActionName = useMemo(
    () => names.find((n) => n.toLowerCase().includes("sit")) || names.find((n) => n.toLowerCase().includes("idle")) || names[0],
    [names]
  );
  const deathActionName = useMemo(
    () => names.find((n) => n.toLowerCase().includes("death3")) || names.find((n) => n.toLowerCase().includes("death")),
    [names]
  );

  useLayoutEffect(() => {
    if (!ref.current || !zombie?.position) return;
    ref.current.position.set(zombie.position.x, zombie.position.y || 0, zombie.position.z);
  }, [zombie?.id]);

  useEffect(() => {
    const walk = walkActionName ? actions[walkActionName] : null;
    const sit = sitActionName ? actions[sitActionName] : null;
    const death = deathActionName ? actions[deathActionName] : null;
    if (!walk && !sit && !death) return;

    if (zombie?.removed) {
      walk?.fadeOut(0.12);
      sit?.fadeOut(0.12);
      if (death) {
        death.reset();
        death.setLoop(LoopOnce, 1);
        death.clampWhenFinished = true;
        death.fadeIn(0.08).play();
      }
      const durationMs = Math.max(700, ((death?.getClip()?.duration ?? 0.9) + 0.1) * 1000);
      const timer = setTimeout(() => {
        purgeZombie(zombie.id);
      }, durationMs);
      return () => clearTimeout(timer);
    }

    if (zombie?.idle) {
      death?.stop();
      walk?.fadeOut(0.2);
      if (sit) sit.reset().fadeIn(0.2).play();
      return;
    }

    death?.stop();
    sit?.fadeOut(0.2);
    if (walk) walk.reset().fadeIn(0.2).play();
  }, [actions, deathActionName, purgeZombie, sitActionName, walkActionName, zombie?.id, zombie?.idle, zombie?.removed]);

  useFrame(() => {
    if (!ref.current || !zombie?.position) return;
    target.set(zombie.position.x, zombie.position.y || 0, zombie.position.z);
    ref.current.position.lerp(target, 0.24);

    if (!prevPos.current) {
      prevPos.current = { x: zombie.position.x, z: zombie.position.z };
    }
    prevPos.current = { x: zombie.position.x, z: zombie.position.z };

    if (!zombie.idle && !zombie.removed) {
      const targetPlayer = players?.[zombie.targetPlayerId];
      if (!targetPlayer?.position) return;
      const facingY = Math.atan2(
        targetPlayer.position.x - ref.current.position.x,
        targetPlayer.position.z - ref.current.position.z
      );
      ref.current.rotation.y = MathUtils.lerp(ref.current.rotation.y, facingY, 0.16);
    }
  });

  if (!zombie) return null;

  return (
    <group ref={ref}>
      <primitive
        ref={modelRef}
        object={scene}
        scale={modelScale}
        position={[modelLocalOffset.x, modelYOffset + modelLocalOffset.y, modelLocalOffset.z]}
      />
      {!zombie.removed && (
        <HealthBar current={zombie.hp} max={DEFAULTS.zombieHp} offsetY={healthBarOffset} width={1.15} />
      )}
    </group>
  );
}

useGLTF.preload("/zombie2.glb");
