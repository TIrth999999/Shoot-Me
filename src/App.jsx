import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import GameScene from "./components/GameScene";
import OverlayUI from "./components/OverlayUI";
import FirstPersonGun from "./components/FirstPersonGun";
import BulletFx from "./components/BulletFx";
import { useNetworkController } from "./network/useNetworkController";
import { usePlayerController } from "./game/usePlayerController";
import { useSoloSimulation } from "./game/useSoloSimulation";
import { useGameStore } from "./state/useGameStore";
import { DEFAULTS } from "./game/constants";

function Runtime({ netClient }) {
  const netMode = useGameStore((s) => s.netMode);
  const damageKick = useGameStore((s) => s.damageKick);
  const { shootLocal } = useSoloSimulation(true);
  usePlayerController({ netClient, shootLocal });

  const shake = useRef(0);
  const prevKick = useRef(damageKick);

  useEffect(() => {
    if (damageKick !== prevKick.current) {
      prevKick.current = damageKick;
      shake.current = 0.18;
      window.dispatchEvent(new CustomEvent("sfx", { detail: { key: "hurt" } }));
    }
  }, [damageKick]);

  useFrame(({ camera }) => {
    if (shake.current <= 0) return;
    shake.current *= 0.86;
    camera.position.x += (Math.random() - 0.5) * shake.current;
    camera.position.y += (Math.random() - 0.5) * shake.current * 0.55;
  });

  return (
    <>
      <GameScene key={netMode} />
      <BulletFx />
      {DEFAULTS.firstPerson && <FirstPersonGun />}
    </>
  );
}

export default function App() {
  const setMode = useGameStore((s) => s.setMode);
  const damageKick = useGameStore((s) => s.damageKick);
  const netClient = useNetworkController();
  const [damageOverlay, setDamageOverlay] = useState(0);
  const decayTimer = useRef(null);

  useEffect(() => {
    setDamageOverlay(0.35);
    if (decayTimer.current) {
      clearInterval(decayTimer.current);
    }
    decayTimer.current = setInterval(() => {
      setDamageOverlay((v) => {
        const next = v * 0.83;
        if (next < 0.01) {
          clearInterval(decayTimer.current);
          decayTimer.current = null;
          return 0;
        }
        return next;
      });
    }, 16);
  }, [damageKick]);

  useEffect(
    () => () => {
      if (decayTimer.current) {
        clearInterval(decayTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    const onEscape = (e) => {
      if (e.code === "Escape" && document.pointerLockElement) {
        document.exitPointerLock();
      }
    };

    const onSfx = () => {
      // no-op placeholder for future synthesized sound generation
    };

    window.addEventListener("keydown", onEscape);
    window.addEventListener("sfx", onSfx);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("sfx", onSfx);
    };
  }, []);

  return (
    <div className="app-shell">
      <Canvas
        shadows
        camera={{ position: [0, 6, -8], fov: 60 }}
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      >
        <Runtime netClient={netClient} />
      </Canvas>
      <div className="damage-vignette" style={{ opacity: damageOverlay }} />
      <div className="crosshair">+</div>
      <OverlayUI
        netClient={netClient}
        onStartSolo={() => {
          setMode("playing");
        }}
      />
    </div>
  );
}
