import { useEffect, useMemo, useRef } from "react";
import { MESSAGE_TYPES, DEFAULTS } from "../game/constants";
import { NetClient } from "./NetClient";
import { useGameStore } from "../state/useGameStore";

export const useNetworkController = () => {
  const setConnection = useGameStore((s) => s.setConnection);
  const setError = useGameStore((s) => s.setError);
  const setRooms = useGameStore((s) => s.setRooms);
  const applyStateDiff = useGameStore((s) => s.applyStateDiff);
  const hydrateJoin = useGameStore((s) => s.hydrateJoin);
  const setSnapshot = useGameStore((s) => s.setSnapshot);
  const touchDamageKick = useGameStore((s) => s.touchDamageKick);
  const playersRef = useRef(useGameStore.getState().players);

  const resolveWsUrl = () => {
    const envSignal = import.meta.env.VITE_SIGNALING_URL?.trim() || import.meta.env.VITE_WS_URL?.trim();
    const raw = envSignal || "https://shoot-me-backend.onrender.com";
    if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
    if (raw.startsWith("https://")) return raw.replace("https://", "wss://");
    if (raw.startsWith("http://")) return raw.replace("http://", "ws://");
    const isHttps = window.location.protocol === "https:";
    const protocol = isHttps ? "wss" : "ws";
    return `${protocol}://${raw.replace(/^\/+/, "")}`;
  };

  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
      playersRef.current = state.players;
    });
    return () => unsub();
  }, []);

  const client = useMemo(() => {
    const host = resolveWsUrl();
    const envUrl = import.meta.env.VITE_SIGNALING_URL?.trim() || import.meta.env.VITE_WS_URL?.trim();

    if (!envUrl && window.location.protocol === "https:") {
      setError(`VITE_SIGNALING_URL is not set. Trying ${host}.`);
    }

    return new NetClient({
      url: host,
      onOpen: () => setConnection("connected"),
      onClose: () => setConnection("disconnected"),
      onError: (msg) => setError(msg),
      onMessage: (msg) => {
        if (msg.type === MESSAGE_TYPES.ROOM_LIST) {
          setRooms(msg.rooms || []);
          return;
        }

        if (msg.type === MESSAGE_TYPES.ROOM_JOINED) {
          hydrateJoin(msg);
          return;
        }

        if (msg.type === MESSAGE_TYPES.STATE_UPDATE) {
          const current = useGameStore.getState();
          const selfId = current.selfId;
          const prev = current.players[selfId];
          applyStateDiff(msg);
          const nextPlayers = useGameStore.getState().players;
          const next = nextPlayers[selfId];
          if (prev && next && next.hp < prev.hp) {
            touchDamageKick();
          }
          return;
        }

        if (msg.type === MESSAGE_TYPES.GAME_OVER) {
          setSnapshot({ gameOver: true, gameTime: msg.gameTime });
          return;
        }

        if (msg.type === MESSAGE_TYPES.ERROR) {
          setError(`${msg.code}: ${msg.message}`);
          return;
        }
      }
    });
  }, [applyStateDiff, hydrateJoin, setConnection, setError, setRooms, setSnapshot, touchDamageKick]);

  useEffect(() => {
    const pingTimer = setInterval(() => {
      client.ping(Date.now());
    }, DEFAULTS.pingIntervalMs);

    return () => {
      clearInterval(pingTimer);
      client.disconnect();
    };
  }, [client]);

  return client;
};
