import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { DEFAULTS } from "./constants";
import { useGameStore } from "../state/useGameStore";

const forward = new Vector3();
const right = new Vector3();
const moveVec = new Vector3();
const GRAVITY = 20;
const JUMP_FORCE = 7.8;

export const usePlayerController = ({ netClient, shootLocal }) => {
  const { camera, gl } = useThree();
  const keys = useRef({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  const shootCooldown = useRef(0);
  const jumpOffset = useRef(0);
  const jumpVelocity = useRef(0);

  useEffect(() => {
    const onKeyDown = (e) => {
      keys.current[e.code] = true;
      if (e.code === "Space" && jumpOffset.current <= 0.001) {
        e.preventDefault();
        jumpVelocity.current = JUMP_FORCE;
      }
    };
    const onKeyUp = (e) => {
      keys.current[e.code] = false;
    };

    const onMouseMove = (e) => {
      if (document.pointerLockElement === gl.domElement) {
        yaw.current -= e.movementX * 0.0025;
        pitch.current -= e.movementY * 0.0022;
        pitch.current = Math.max(-1.2, Math.min(1.2, pitch.current));
      }
    };

    const onMouseDown = () => {
      const state = useGameStore.getState();
      if (state.mode !== "playing" || state.gameOver) return;

      if (document.pointerLockElement !== gl.domElement) {
        gl.domElement.requestPointerLock();
        return;
      }

      const self = state.players[state.selfId];
      if (!self || self.isDead) return;

      const direction = {
        x: Math.sin(yaw.current),
        y: 0,
        z: Math.cos(yaw.current)
      };
      const visualDirection = {
        x: Math.sin(yaw.current) * Math.cos(pitch.current),
        y: Math.sin(pitch.current),
        z: Math.cos(yaw.current) * Math.cos(pitch.current)
      };

      if (shootCooldown.current > 0) return;
      shootCooldown.current = 0.18;

      if (state.netMode === "multiplayer") {
        netClient?.shoot(direction);
      } else {
        shootLocal(self.position, direction);
      }

      window.dispatchEvent(
        new CustomEvent("shot", {
          detail: {
            origin: {
              x: self.position.x + visualDirection.x * 0.6,
              y: DEFAULTS.eyeHeight + jumpOffset.current - 0.08 + visualDirection.y * 0.06,
              z: self.position.z + visualDirection.z * 0.6
            },
            direction: visualDirection
          }
        })
      );

      // placeholder sound event for future audio bus integration
      window.dispatchEvent(new CustomEvent("sfx", { detail: { key: "shoot" } }));
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [gl.domElement, netClient, shootLocal]);

  useFrame((_, dt) => {
    if (shootCooldown.current > 0) {
      shootCooldown.current -= dt;
    }

    const state = useGameStore.getState();
    if (state.mode !== "playing" || state.gameOver) return;

    const self = state.players[state.selfId];
    if (!self || self.isDead) return;

    if (jumpOffset.current > 0 || jumpVelocity.current > 0) {
      jumpVelocity.current -= GRAVITY * dt;
      jumpOffset.current = Math.max(0, jumpOffset.current + jumpVelocity.current * dt);
      if (jumpOffset.current === 0) {
        jumpVelocity.current = 0;
      }
    }

    forward.set(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    right.set(forward.z, 0, -forward.x);
    moveVec.set(0, 0, 0);

    if (keys.current.KeyW) moveVec.add(forward);
    if (keys.current.KeyS) moveVec.sub(forward);
    if (keys.current.KeyA) moveVec.sub(right);
    if (keys.current.KeyD) moveVec.add(right);

    if (moveVec.lengthSq() > 0) {
      moveVec.normalize();
      const speed = DEFAULTS.playerSpeed * (keys.current.ShiftLeft ? DEFAULTS.sprintMult : 1);
      const next = {
        x: self.position.x + moveVec.x * speed * dt,
        y: jumpOffset.current,
        z: self.position.z + moveVec.z * speed * dt
      };

      next.x = Math.max(-DEFAULTS.worldWidth / 2, Math.min(DEFAULTS.worldWidth / 2, next.x));
      next.z = Math.max(-DEFAULTS.worldDepth / 2, Math.min(DEFAULTS.worldDepth / 2, next.z));

      useGameStore.getState().updateLocalPlayer((prev) => ({
        ...prev,
        position: next,
        rotation: { yaw: yaw.current }
      }));

      const nowState = useGameStore.getState();
      if (nowState.netMode === "multiplayer") {
        netClient?.move(next, { yaw: yaw.current }, nowState.localSeq + 1);
      }
    } else {
      useGameStore.getState().updateLocalPlayer((prev) => ({
        ...prev,
        rotation: { yaw: yaw.current }
      }));
    }

    const refreshed = useGameStore.getState();
    const updatedSelf = refreshed.players[refreshed.selfId];
    if (!updatedSelf) return;

    const cameraTarget = new Vector3(
      updatedSelf.position.x,
      DEFAULTS.eyeHeight + jumpOffset.current,
      updatedSelf.position.z
    );

    camera.position.lerp(cameraTarget, 0.45);
    const lookTarget = new Vector3(
      updatedSelf.position.x + Math.sin(yaw.current) * 8,
      DEFAULTS.eyeHeight + jumpOffset.current + Math.sin(pitch.current) * 7,
      updatedSelf.position.z + Math.cos(yaw.current) * 8
    );
    camera.lookAt(lookTarget);
  });

  return yaw;
};
