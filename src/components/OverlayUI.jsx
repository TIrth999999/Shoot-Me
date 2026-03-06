import { useMemo, useState } from "react";
import { useGameStore } from "../state/useGameStore";

export default function OverlayUI({ netClient, onStartSolo }) {
  const mode = useGameStore((s) => s.mode);
  const netMode = useGameStore((s) => s.netMode);
  const rooms = useGameStore((s) => s.rooms);
  const roomId = useGameStore((s) => s.roomId);
  const players = useGameStore((s) => s.players);
  const selfId = useGameStore((s) => s.selfId);
  const gameTime = useGameStore((s) => s.gameTime);
  const spawnRateSec = useGameStore((s) => s.spawnRateSec);
  const gameOver = useGameStore((s) => s.gameOver);
  const connection = useGameStore((s) => s.connection);
  const error = useGameStore((s) => s.error);
  const setMode = useGameStore((s) => s.setMode);
  const setNetMode = useGameStore((s) => s.setNetMode);
  const resetSession = useGameStore((s) => s.resetSession);

  const [joinCode, setJoinCode] = useState("");

  const me = players[selfId];

  const sortedScore = useMemo(() => {
    return Object.entries(players)
      .map(([id, p]) => ({ id, score: p.score, hp: p.hp, ping: p.ping }))
      .sort((a, b) => b.score - a.score);
  }, [players]);

  const startSolo = () => {
    setNetMode("solo");
    setMode("playing");
    useGameStore.setState({ roomId: "SOLO", selfId: "local" });
    resetSession();
    onStartSolo?.();
  };

  const createRoom = () => {
    setNetMode("multiplayer");
    resetSession();
    netClient?.createRoom();
  };

  const joinRoom = (id) => {
    if (!id) return;
    setNetMode("multiplayer");
    resetSession();
    netClient?.joinRoom(id);
  };

  const restart = () => {
    if (netMode === "solo") {
      resetSession();
      setMode("playing");
      return;
    }
    netClient?.restart();
  };

  return (
    <div className="ui-root">
      {mode === "menu" && (
        <div className="panel menu">
          <h1>Night of the Hollow</h1>
          <p>Survive infinite waves in a cursed dead zone.</p>
          <div className="actions">
            <button onClick={startSolo}>Start Solo</button>
            <button onClick={createRoom}>Create Room</button>
          </div>
          <div className="join-row">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Room ID" />
            <button onClick={() => joinRoom(joinCode)}>Join</button>
          </div>
          <div className="room-list">
            {rooms.map((room) => (
              <button key={room.roomId} onClick={() => joinRoom(room.roomId)} className="room-item">
                {room.roomId} | {room.players}/{room.maxPlayers}
              </button>
            ))}
            {!rooms.length && <span>No active rooms</span>}
          </div>
          <small>Status: {connection}</small>
          {error && <small className="error">{error}</small>}
        </div>
      )}

      {mode === "playing" && (
        <>
          <div className="panel hud">
            <div>Mode: {netMode}</div>
            <div>Room: {roomId || "-"}</div>
            <div>Time: {gameTime.toFixed(1)}s</div>
            <div>Spawn: {spawnRateSec.toFixed(2)}s</div>
            <div>HP: {Math.max(0, Math.floor(me?.hp ?? 0))}</div>
            <div>Score: {me?.score ?? 0}</div>
            <div>Ping: {me?.ping ?? 0} ms</div>
          </div>

          <div className="panel scoreboard">
            <h3>Scoreboard</h3>
            {sortedScore.map((entry) => (
              <div key={entry.id} className="score-row">
                <span>{entry.id === selfId ? "YOU" : entry.id.slice(0, 6)}</span>
                <span>{entry.score}</span>
              </div>
            ))}
          </div>

          {gameOver && (
            <div className="panel game-over">
              <h2>You Died</h2>
              <button onClick={restart}>Restart</button>
              <button
                onClick={() => {
                  if (netMode === "multiplayer") {
                    netClient?.leaveRoom();
                  }
                  setMode("menu");
                }}
              >
                Back to Menu
              </button>
            </div>
          )}

          <div className="hint">FPS Mode | WASD move | Space jump | Shift sprint | Mouse aim | Click lock + shoot</div>
        </>
      )}
    </div>
  );
}
