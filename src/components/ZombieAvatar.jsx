import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Box3, Color, MathUtils, Vector3 } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { DEFAULTS } from "../game/constants";
import { useGameStore } from "../state/useGameStore";
import { ZOMBIE_MODEL_CONFIG, ZOMBIE_TYPES } from "../game/zombieTypes";
import {
  ZOMBIE_HITBOX,
  ZOMBIE_HITBOX_BASE_LIFT,
  ZOMBIE_HITBOX_HEIGHT_BONUS,
  ZOMBIE_VISUAL_LIFT
} from "../game/zombieCombatTuning";
import { setZombieTypeHitbox } from "../game/zombieHitboxRegistry";

const orderedTypes = [
  ZOMBIE_TYPES.SKINNER,
  ZOMBIE_TYPES.SKINNER_FRIENDLY,
  ZOMBIE_TYPES.ZOMBIE_DOG,
  ZOMBIE_TYPES.ZOMBIE_DOG_LONG
];

const hashString = (value) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const fallbackTypeFromId = (id) => orderedTypes[hashString(String(id || "0")) % orderedTypes.length];
const HIT_FLASH_COLOR = new Color("#ff2b2b");
const HIT_FLASH_DECAY_SEC = 0.18;

const pickActionByRule = (names, rule) => {
  if (!Array.isArray(names) || names.length === 0) return null;
  if (!rule) return names[0];

  if (rule.moveContains) {
    const match = names.find((n) => n.toLowerCase().includes(rule.moveContains.toLowerCase()));
    if (match) return match;
  }
  if (rule.preferSecondLast && names.length >= 2) return names[names.length - 2];
  if (rule.preferLast && names.length >= 1) return names[names.length - 1];
  if (typeof rule.fallbackIndex === "number" && names[rule.fallbackIndex]) return names[rule.fallbackIndex];
  return names[0];
};

export default function ZombieAvatar({ zombie, players }) {
  const ref = useRef();
  const modelRef = useRef();
  const prevPos = useRef(null);
  const prevHp = useRef(zombie?.hp ?? 0);
  const hitFlash = useRef(0);
  const flashMaterials = useRef([]);
  const target = useMemo(() => new Vector3(), []);
  const purgeZombie = useGameStore((s) => s.purgeZombie);
  const zombieScales = useGameStore((s) => s.zombieScales);
  const skinnerGltf = useGLTF(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.SKINNER].modelPath);
  const skinnerFriendlyGltf = useGLTF(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.SKINNER_FRIENDLY].modelPath);
  const zombieDogGltf = useGLTF(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.ZOMBIE_DOG].modelPath);
  const zombieDogLongGltf = useGLTF(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.ZOMBIE_DOG_LONG].modelPath);

  const selectedType = useMemo(() => {
    if (zombie?.type && ZOMBIE_MODEL_CONFIG[zombie.type]) return zombie.type;
    return fallbackTypeFromId(zombie?.id);
  }, [zombie?.id, zombie?.type]);

  const selectedGltf = useMemo(() => {
    if (selectedType === ZOMBIE_TYPES.SKINNER_FRIENDLY) return skinnerFriendlyGltf;
    if (selectedType === ZOMBIE_TYPES.ZOMBIE_DOG) return zombieDogGltf;
    if (selectedType === ZOMBIE_TYPES.ZOMBIE_DOG_LONG) return zombieDogLongGltf;
    return skinnerGltf;
  }, [selectedType, skinnerFriendlyGltf, zombieDogGltf, zombieDogLongGltf, skinnerGltf]);

  const modelCfg = ZOMBIE_MODEL_CONFIG[selectedType] || ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.SKINNER];
  const typeScale = zombieScales?.[selectedType] ?? 1;
  const typeLift = ZOMBIE_VISUAL_LIFT[selectedType] || 0;
  const fallbackHitboxCfg = ZOMBIE_HITBOX[selectedType] || ZOMBIE_HITBOX.default;
  const hitboxBaseLift = ZOMBIE_HITBOX_BASE_LIFT[selectedType] ?? ZOMBIE_HITBOX_BASE_LIFT.default;
  const hitboxHeightBonus = ZOMBIE_HITBOX_HEIGHT_BONUS[selectedType] ?? ZOMBIE_HITBOX_HEIGHT_BONUS.default;

  const { scene, modelScale, modelLocalOffset, modelBaseSize } = useMemo(() => {
    const gltfScene = selectedGltf?.scene;
    if (!gltfScene) {
      return {
        scene: null,
        modelScale: 1,
        modelLocalOffset: [0, 0, 0],
        modelBaseSize: { width: 1, depth: 1, height: DEFAULTS.zombieBodyHeight }
      };
    }

    const sourceRoot =
      gltfScene.getObjectByName("Sketchfab_model") ||
      gltfScene.children.find((c) => typeof c.name === "string" && c.name.toLowerCase().includes("sketchfab_model")) ||
      gltfScene;
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
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map((mat) => (mat?.clone ? mat.clone() : mat));
        } else if (obj.material?.clone) {
          obj.material = obj.material.clone();
        }
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    const box = new Box3().setFromObject(cloned);
    const rawHeight = Math.max(0.001, box.max.y - box.min.y);
    const targetHeight = DEFAULTS.zombieBodyHeight;
    const normalizedScale = Math.min(220, Math.max(0.2, targetHeight / rawHeight));
    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    const xOffset = -centerX * normalizedScale;
    const yOffset = -box.min.y * normalizedScale;
    const zOffset = -centerZ * normalizedScale;
    return {
      scene: cloned,
      modelScale: normalizedScale,
      modelLocalOffset: [xOffset, yOffset, zOffset],
      modelBaseSize: {
        width: (box.max.x - box.min.x) * normalizedScale,
        depth: (box.max.z - box.min.z) * normalizedScale,
        height: (box.max.y - box.min.y) * normalizedScale
      }
    };
  }, [selectedGltf]);
  const hitboxHalfWidth = useMemo(() => {
    const modelHalfWidth = Math.max(modelBaseSize.width, modelBaseSize.depth) * 0.5 * typeScale * 1.1;
    return Math.max(fallbackHitboxCfg.halfWidth, modelHalfWidth);
  }, [fallbackHitboxCfg.halfWidth, modelBaseSize.depth, modelBaseSize.width, typeScale]);
  const hitboxHeight = useMemo(() => {
    const modelHeight = modelBaseSize.height * typeScale * 1.08;
    return Math.max(fallbackHitboxCfg.height, modelHeight) + hitboxHeightBonus;
  }, [fallbackHitboxCfg.height, hitboxHeightBonus, modelBaseSize.height, typeScale]);
  const hitboxLift = hitboxBaseLift;
  const scaledModelOffset = useMemo(
    () => [modelLocalOffset[0] * typeScale, modelLocalOffset[1] * typeScale + typeLift, modelLocalOffset[2] * typeScale],
    [modelLocalOffset, typeLift, typeScale]
  );
  const { actions, names } = useAnimations(selectedGltf?.animations || [], modelRef);
  const walkActionName = useMemo(() => pickActionByRule(names, modelCfg.animation), [modelCfg.animation, names]);
  const sitActionName = useMemo(
    () => names.find((n) => n.toLowerCase().includes("sit")) || names.find((n) => n.toLowerCase().includes("idle")) || names[0],
    [names]
  );
  const deathActionName = useMemo(() => {
    if (!modelCfg.animation?.allowDeath) return null;
    return names.find((n) => n.toLowerCase().includes("death3")) || names.find((n) => n.toLowerCase().includes("death"));
  }, [modelCfg.animation?.allowDeath, names]);

  useLayoutEffect(() => {
    if (!ref.current || !zombie?.position) return;
    ref.current.position.set(zombie.position.x, zombie.position.y || 0, zombie.position.z);
  }, [zombie?.id]);

  useEffect(() => {
    setZombieTypeHitbox(selectedType, {
      halfWidth: hitboxHalfWidth,
      height: hitboxHeight,
      baseLift: hitboxLift
    });
  }, [hitboxHalfWidth, hitboxHeight, hitboxLift, selectedType]);

  useEffect(() => {
    if (!scene) return;
    const materials = [];
    const seen = new Set();
    scene.traverse((obj) => {
      if (!obj?.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat || seen.has(mat)) continue;
        seen.add(mat);
        materials.push({
          mat,
          baseColor: mat.color?.clone?.() || null,
          baseEmissive: mat.emissive?.clone?.() || null
        });
      }
    });
    flashMaterials.current = materials;
  }, [scene]);

  useEffect(() => {
    if (typeof zombie?.hp !== "number") return;
    if (zombie.hp < prevHp.current) {
      hitFlash.current = 1;
    }
    prevHp.current = zombie.hp;
  }, [zombie?.hp]);

  useEffect(() => {
    if (zombie?.removed) {
      purgeZombie(zombie.id);
      return;
    }

    const walk = walkActionName ? actions[walkActionName] : null;
    const sit = sitActionName ? actions[sitActionName] : null;
    const death = deathActionName ? actions[deathActionName] : null;
    if (!walk && !sit && !death) return;

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

  useFrame((_, dt) => {
    if (hitFlash.current > 0) {
      hitFlash.current = Math.max(0, hitFlash.current - dt / HIT_FLASH_DECAY_SEC);
    }
    const flash = hitFlash.current;
    for (const entry of flashMaterials.current) {
      if (entry.baseColor && entry.mat.color) {
        entry.mat.color.copy(entry.baseColor).lerp(HIT_FLASH_COLOR, flash * 0.35);
      }
      if (entry.baseEmissive && entry.mat.emissive) {
        entry.mat.emissive.copy(entry.baseEmissive).lerp(HIT_FLASH_COLOR, flash * 0.85);
      }
    }

    if (!ref.current || !zombie?.position) return;
    const previousX = ref.current.position.x;
    const previousZ = ref.current.position.z;
    let renderPos = zombie.position;
    if (Array.isArray(zombie.netSamples) && zombie.netSamples.length > 0) {
      const renderTs = Date.now() - DEFAULTS.remoteInterpolationDelayMs;
      const samples = zombie.netSamples;
      renderPos = samples[samples.length - 1].position;
      for (let i = 1; i < samples.length; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        if (a.ts <= renderTs && renderTs <= b.ts) {
          const span = Math.max(1, b.ts - a.ts);
          const t = Math.max(0, Math.min(1, (renderTs - a.ts) / span));
          renderPos = {
            x: a.position.x + (b.position.x - a.position.x) * t,
            y: (a.position.y || 0) + ((b.position.y || 0) - (a.position.y || 0)) * t,
            z: a.position.z + (b.position.z - a.position.z) * t
          };
          break;
        }
      }
    }
    target.set(renderPos.x, renderPos.y || 0, renderPos.z);
    ref.current.position.lerp(target, 0.24);

    if (!prevPos.current) {
      prevPos.current = { x: zombie.position.x, z: zombie.position.z };
    }
    prevPos.current = { x: zombie.position.x, z: zombie.position.z };

    if (!zombie.idle && !zombie.removed) {
      let facingY = ref.current.rotation.y;
      if (zombie.behavior === "orbit") {
        const moveX = ref.current.position.x - previousX;
        const moveZ = ref.current.position.z - previousZ;
        if (Math.hypot(moveX, moveZ) > 0.001) {
          facingY = Math.atan2(moveX, moveZ);
        }
      } else {
        const targetPlayer = players?.[zombie.targetPlayerId];
        if (!targetPlayer?.position) return;
        facingY = Math.atan2(
          targetPlayer.position.x - ref.current.position.x,
          targetPlayer.position.z - ref.current.position.z
        );
      }
      ref.current.rotation.y = MathUtils.lerp(ref.current.rotation.y, facingY, 0.16);
    }
  });

  if (!zombie || zombie.removed || !scene) return null;

  return (
    <group ref={ref}>
      <primitive
        ref={modelRef}
        object={scene}
        scale={modelScale * typeScale}
        position={scaledModelOffset}
      />
    </group>
  );
}

useGLTF.preload(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.SKINNER].modelPath);
useGLTF.preload(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.SKINNER_FRIENDLY].modelPath);
useGLTF.preload(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.ZOMBIE_DOG].modelPath);
useGLTF.preload(ZOMBIE_MODEL_CONFIG[ZOMBIE_TYPES.ZOMBIE_DOG_LONG].modelPath);
