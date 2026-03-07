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
  const netMode = useGameStore((s) => s.netMode);
  const roomId = useGameStore((s) => s.roomId);
  const keys = useRef({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  const shootCooldown = useRef(0);
  const jumpOffset = useRef(0);
  const jumpVelocity = useRef(0);
  const lastMoveSendAt = useRef(0);
  const lastSentMove = useRef({ x: 0, z: 0, yaw: 0 });
  const outboundSeq = useRef(0);
  const lastServerAckSeq = useRef(-1);
  const reloadEndAt = useRef(0);
  const pointerLockPending = useRef(false);

  const quantize = (value, factor) => Math.round(value * factor) / factor;

  useEffect(() => {
    lastMoveSendAt.current = 0;
    lastSentMove.current = { x: 0, z: 0, yaw: 0 };
    outboundSeq.current = 0;
    lastServerAckSeq.current = -1;
  }, [netMode, roomId]);

  useEffect(() => {
    const startReload = () => {
      const state = useGameStore.getState();
      const combat = state.combat;
      if (!combat || combat.isReloading || combat.reserve <= 0 || combat.mag >= combat.magSize) return false;
      state.startLocalReload();
      window.dispatchEvent(new CustomEvent("weapon_reload_start"));
      window.dispatchEvent(new CustomEvent("sfx", { detail: { key: "reload" } }));
      reloadEndAt.current = performance.now() + combat.reloadMs;
      return true;
    };

    const onKeyDown = (e) => {
      keys.current[e.code] = true;
      if (e.code === "Space" && jumpOffset.current <= 0.001) {
        e.preventDefault();
        jumpVelocity.current = JUMP_FORCE;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        startReload();
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
        if (!pointerLockPending.current) {
          pointerLockPending.current = true;
          try {
            const lockRequest = gl.domElement.requestPointerLock();
            if (lockRequest && typeof lockRequest.then === "function") {
              lockRequest
                .catch(() => {})
                .finally(() => {
                  pointerLockPending.current = false;
                });
            } else {
              pointerLockPending.current = false;
            }
          } catch {
            pointerLockPending.current = false;
          }
        }
        return;
      }

      const self = state.players[state.selfId];
      if (!self || self.isDead) return;
      const combat = state.combat;
      if (!combat) return;
      if (combat.isReloading) return;
      if (combat.mag <= 0) {
        startReload();
        return;
      }

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
      state.consumeLocalAmmo();

      if (state.netMode === "multiplayer") {
        netClient?.shoot(visualDirection);
      } else {
        shootLocal(
          {
            x: self.position.x,
            y: DEFAULTS.eyeHeight + jumpOffset.current,
            z: self.position.z
          },
          visualDirection
        );
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

      const afterShotCombat = useGameStore.getState().combat;
      if (afterShotCombat?.mag === 0 && afterShotCombat.reserve > 0) {
        startReload();
      }
    };

    const onPointerLockChange = () => {
      pointerLockPending.current = false;
    };
    const onPointerLockError = () => {
      pointerLockPending.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("pointerlockchange", onPointerLockChange);
    window.addEventListener("pointerlockerror", onPointerLockError);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("pointerlockerror", onPointerLockError);
      reloadEndAt.current = 0;
      pointerLockPending.current = false;
      useGameStore.getState().cancelLocalReload();
      window.dispatchEvent(new CustomEvent("weapon_reload_end"));
    };
  }, [gl.domElement, netClient, shootLocal]);

  useFrame((_, dt) => {
    if (shootCooldown.current > 0) {
      shootCooldown.current -= dt;
    }

    const state = useGameStore.getState();
    if (state.mode !== "playing" || state.gameOver) return;
    if (state.combat?.isReloading && reloadEndAt.current > 0 && performance.now() >= reloadEndAt.current) {
      state.finishLocalReload();
      reloadEndAt.current = 0;
      window.dispatchEvent(new CustomEvent("weapon_reload_end"));
    } else if (!state.combat?.isReloading && reloadEndAt.current > 0) {
      reloadEndAt.current = 0;
      window.dispatchEvent(new CustomEvent("weapon_reload_end"));
    }

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
    if (keys.current.KeyD) moveVec.sub(right);
    if (keys.current.KeyA) moveVec.add(right);

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
        if (netClient?.isHost) {
          outboundSeq.current += 1;
          netClient?.move(
            { x: next.x, y: next.y, z: next.z },
            { yaw: yaw.current },
            outboundSeq.current
          );
          lastSentMove.current = { x: next.x, z: next.z, yaw: yaw.current };
          lastMoveSendAt.current = Date.now();
        } else {
          const nowMs = Date.now();
          const elapsed = nowMs - lastMoveSendAt.current;
          const moveDelta = Math.hypot(next.x - lastSentMove.current.x, next.z - lastSentMove.current.z);
          const yawDelta = Math.abs(yaw.current - lastSentMove.current.yaw);
          const shouldSend =
            elapsed >= DEFAULTS.netSendIntervalMs &&
            (moveDelta >= DEFAULTS.netMinMoveDelta || yawDelta >= DEFAULTS.netMinYawDelta);

          if (shouldSend) {
            outboundSeq.current += 1;
            const payloadPos = {
              x: quantize(next.x, DEFAULTS.netPositionQuantize),
              y: quantize(next.y, DEFAULTS.netPositionQuantize),
              z: quantize(next.z, DEFAULTS.netPositionQuantize)
            };
            const payloadRot = {
              yaw: quantize(yaw.current, DEFAULTS.netYawQuantize)
            };

            netClient?.move(payloadPos, payloadRot, outboundSeq.current);
            lastMoveSendAt.current = nowMs;
            lastSentMove.current = { x: next.x, z: next.z, yaw: yaw.current };
          }
        }
      }
    } else {
      useGameStore.getState().updateLocalPlayer((prev) => ({
        ...prev,
        rotation: { yaw: yaw.current }
      }));

      const nowState = useGameStore.getState();
      if (nowState.netMode === "multiplayer") {
        const nowMs = Date.now();
        const elapsed = nowMs - lastMoveSendAt.current;
        const yawDelta = Math.abs(yaw.current - lastSentMove.current.yaw);
        if (elapsed >= DEFAULTS.netSendIntervalMs && yawDelta >= DEFAULTS.netMinYawDelta) {
          outboundSeq.current += 1;
          netClient?.move(
            {
              x: quantize(self.position.x, DEFAULTS.netPositionQuantize),
              y: quantize(self.position.y, DEFAULTS.netPositionQuantize),
              z: quantize(self.position.z, DEFAULTS.netPositionQuantize)
            },
            { yaw: quantize(yaw.current, DEFAULTS.netYawQuantize) },
            outboundSeq.current
          );
          lastMoveSendAt.current = nowMs;
          lastSentMove.current = { x: self.position.x, z: self.position.z, yaw: yaw.current };
        }
      }
    }

    const refreshed = useGameStore.getState();
    const updatedSelf = refreshed.players[refreshed.selfId];
    if (!updatedSelf) return;

    if (refreshed.netMode === "multiplayer" && updatedSelf.serverPosition) {
      if (netClient?.isHost) {
        // Host runs authority locally; skip self-reconciliation to avoid artificial rubberband.
        return;
      }
      const serverSeq = typeof updatedSelf.serverSeq === "number" ? updatedSelf.serverSeq : -1;
      if (serverSeq > lastServerAckSeq.current) {
        lastServerAckSeq.current = serverSeq;
        const dx = updatedSelf.serverPosition.x - updatedSelf.position.x;
        const dz = updatedSelf.serverPosition.z - updatedSelf.position.z;
        const errorDist = Math.hypot(dx, dz);
        if (errorDist > (DEFAULTS.netReconcileMinError ?? DEFAULTS.netReconcileSnapDist)) {
          const correctedPos = {
            x: updatedSelf.serverPosition.x,
            y: updatedSelf.serverPosition.y ?? updatedSelf.position.y,
            z: updatedSelf.serverPosition.z
          };
          const correctedYaw = typeof updatedSelf.serverRotation?.yaw === "number"
            ? { yaw: updatedSelf.serverRotation.yaw }
            : updatedSelf.rotation;
          useGameStore.getState().reconcileLocalPlayer({
            position: correctedPos,
            rotation: correctedYaw,
            serverSeq
          });
        }
      }
    }

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
