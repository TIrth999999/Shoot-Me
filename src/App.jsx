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
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const damageKick = useGameStore((s) => s.damageKick);
  const netClient = useNetworkController();
  const [damageOverlay, setDamageOverlay] = useState(0);
  const decayTimer = useRef(null);
  const zombieSfxTimer = useRef(null);
  const lastZombieSfxIndex = useRef(-1);
  const audioBus = useRef({
    shoot: null,
    reload: null,
    hurt: null,
    bgm: null,
    zombieAmbient: []
  });

  useEffect(() => {
    if (mode === "menu") {
      setDamageOverlay(0);
      return;
    }

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
  }, [damageKick, mode]);

  useEffect(
    () => () => {
      if (decayTimer.current) {
        clearInterval(decayTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    const createAndPreload = (src, volume = 1) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = volume;
      audio.load();
      return audio;
    };

    audioBus.current.shoot = createAndPreload("/gunFireSound.mp3", 0.7);
    audioBus.current.reload = createAndPreload("/gunReloadSound.mp3", 0.8);
    audioBus.current.hurt = createAndPreload("/playerHurtSound.mp3", 0.8);
    audioBus.current.bgm = createAndPreload("/mainBackgroundThemeSound.mp3", 0.36);
    audioBus.current.zombieAmbient = Array.from({ length: 8 }, (_, i) =>
      createAndPreload(`/zombieS${i + 1}.mp3`, 0.5)
    );
    if (audioBus.current.bgm) {
      const bgm = audioBus.current.bgm;
      bgm.loop = true;

      const tryStart = () => {
        if (!bgm.paused) return;
        void bgm.play().catch(() => {});
      };

      if (bgm.readyState >= 3) {
        tryStart();
      } else {
        bgm.addEventListener("canplaythrough", tryStart, { once: true });
      }
    }

    return () => {
      const shoot = audioBus.current.shoot;
      const reload = audioBus.current.reload;
      const hurt = audioBus.current.hurt;
      const bgm = audioBus.current.bgm;
      if (shoot) {
        shoot.pause();
        shoot.currentTime = 0;
      }
      if (reload) {
        reload.pause();
        reload.currentTime = 0;
      }
      if (hurt) {
        hurt.pause();
        hurt.currentTime = 0;
      }
      if (bgm) {
        bgm.pause();
        bgm.currentTime = 0;
      }
      for (const z of audioBus.current.zombieAmbient || []) {
        z.pause();
        z.currentTime = 0;
      }
    };
  }, []);

  useEffect(() => {
    const tryStartBgm = () => {
      const bgm = audioBus.current.bgm;
      if (!bgm || !bgm.paused) return;
      void bgm.play().catch(() => {});
    };

    const onEscape = (e) => {
      if (e.code === "Escape" && document.pointerLockElement) {
        document.exitPointerLock();
      }
    };

    const onSfx = (event) => {
      const key = event?.detail?.key;
      if (key === "shoot") {
        const s = audioBus.current.shoot;
        if (!s) return;
        s.pause();
        s.currentTime = 0;
        void s.play().catch(() => {});
      }
      if (key === "reload") {
        const r = audioBus.current.reload;
        if (!r) return;
        r.pause();
        r.currentTime = 0;
        void r.play().catch(() => {});
      }
      if (key === "hurt") {
        const h = audioBus.current.hurt;
        if (!h) return;
        h.pause();
        h.currentTime = 0;
        void h.play().catch(() => {});
      }
    };

    tryStartBgm();
    window.addEventListener("keydown", onEscape);
    window.addEventListener("pointerdown", tryStartBgm);
    window.addEventListener("keydown", tryStartBgm);
    window.addEventListener("touchstart", tryStartBgm, { passive: true });
    window.addEventListener("sfx", onSfx);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("pointerdown", tryStartBgm);
      window.removeEventListener("keydown", tryStartBgm);
      window.removeEventListener("touchstart", tryStartBgm);
      window.removeEventListener("sfx", onSfx);
    };
  }, []);

  useEffect(() => {
    if (zombieSfxTimer.current) {
      clearTimeout(zombieSfxTimer.current);
      zombieSfxTimer.current = null;
    }
    if (mode !== "playing") return undefined;

    const playZombieAmbient = () => {
      const clips = audioBus.current.zombieAmbient || [];
      if (clips.length === 0) return;

      let nextIndex = Math.floor(Math.random() * clips.length);
      if (clips.length > 1 && nextIndex === lastZombieSfxIndex.current) {
        nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (clips.length - 1))) % clips.length;
      }
      lastZombieSfxIndex.current = nextIndex;

      const clip = clips[nextIndex];
      clip.currentTime = 0;
      void clip.play().catch(() => {});

      const durationMs =
        Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration * 1000 : 2500;
      const postPauseMs = 2000 + Math.random() * 1000;
      const delayMs = durationMs + postPauseMs;
      zombieSfxTimer.current = setTimeout(playZombieAmbient, delayMs);
    };

    const firstDelayMs = 1200 + Math.random() * 1600;
    zombieSfxTimer.current = setTimeout(playZombieAmbient, firstDelayMs);

    return () => {
      if (zombieSfxTimer.current) {
        clearTimeout(zombieSfxTimer.current);
        zombieSfxTimer.current = null;
      }
      for (const clip of audioBus.current.zombieAmbient || []) {
        clip.pause();
        clip.currentTime = 0;
      }
    };
  }, [mode]);

  return (
    <div className={`app-shell ${mode === "menu" ? "menu-only" : ""}`}>
      {mode !== "menu" && (
        <Canvas
          shadows
          camera={{ position: [0, 6, -8], fov: 60 }}
          gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        >
          <Runtime netClient={netClient} />
        </Canvas>
      )}
      <div className="damage-vignette" style={{ opacity: damageOverlay }} />
      {mode !== "menu" && <div className="crosshair" />}
      <OverlayUI
        netClient={netClient}
        onStartSolo={() => {
          setMode("playing");
        }}
      />
    </div>
  );
}
