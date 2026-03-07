import { useEffect, useMemo, useState } from "react";
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
  const setError = useGameStore((s) => s.setError);
  const resetSession = useGameStore((s) => s.resetSession);
  const zombies = useGameStore((s) => s.zombies);
  const combat = useGameStore((s) => s.combat);

  const [joinCode, setJoinCode] = useState("");
  const [activePanel, setActivePanel] = useState("none");
  const [weapon, setWeapon] = useState("CARBINE-M4");

  const me = players[selfId];
  const hpValue = Math.max(0, Math.floor(me?.hp ?? 0));
  const hpRatio = Math.max(0, Math.min(1, hpValue / 100));
  const hpClass = hpRatio > 0.6 ? "hp-good" : hpRatio > 0.3 ? "hp-warn" : "hp-critical";
  const zombieAlive = useMemo(
    () => Object.values(zombies).filter((z) => !z.removed).length,
    [zombies]
  );
  const kills = Math.floor((me?.score ?? 0) / 10);
  const canContinue = gameTime > 0 || mode === "paused" || netMode === "multiplayer";

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
    setMode("playing");
  };

  const continueGame = () => {
    if (!canContinue) {
      setError("No active run to continue.");
      return;
    }
    setMode("playing");
  };

  useEffect(() => {
    if (mode === "menu") {
      setActivePanel("none");
    }
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === "Escape") {
        if (mode === "playing" && !gameOver) {
          if (document.pointerLockElement) document.exitPointerLock();
          setMode("paused");
        } else if (mode === "paused") {
          setMode("playing");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gameOver, mode]);

  const exitToMenu = () => {
    if (netMode === "multiplayer") {
      netClient?.leaveRoom();
    }
    setActivePanel("none");
    setMode("menu");
  };

  return (
    <div className="ui-root">
      {mode === "menu" && (
        <div className="menu-screen">
          <div className="menu-smoke menu-smoke-a" />
          <div className="menu-smoke menu-smoke-b" />
          <div className="menu-noise" />
          <div className="panel menu-shell">
            <div className="title-block">
              <h1>SHOOT ME</h1>
              <p>A Zombie Survival Game</p>
            </div>

            <div className="menu-layout">
              <div className="menu-actions">
                <button className="menu-btn" onClick={startSolo}>
                  Play
                </button>
                <button className="menu-btn" onClick={createRoom}>
                  Play Multiplayer
                </button>
                <button className="menu-btn" onClick={continueGame} disabled={!canContinue}>
                  Continue
                </button>
                <button className="menu-btn" onClick={() => setActivePanel("loadout")}>
                  Select Weapon / Loadout
                </button>
                <button className="menu-btn" onClick={() => setActivePanel("settings")}>
                  Settings
                </button>
                <button className="menu-btn" onClick={() => setActivePanel("leaderboard")}>
                  Leaderboard
                </button>
                <button className="menu-btn" onClick={() => setActivePanel("none")}>
                  Home
                </button>
                <button className="menu-btn danger" onClick={() => setError("Exit is not available in browser build.")}>
                  Exit
                </button>
              </div>

              <div className="panel side-panel">
                {activePanel === "none" && (
                  <>
                    <h3>Session Control</h3>
                    <p>Pick a mode and enter the dead zone.</p>
                    <p>Choose solo for local survival or multiplayer for room matchmaking.</p>
                  </>
                )}

                {activePanel === "loadout" && (
                  <>
                    <h3>Loadout</h3>
                    <p>Select your primary weapon profile.</p>
                    <div className="menu-grid">
                      <button onClick={() => setWeapon("CARBINE-M4")} className={weapon === "CARBINE-M4" ? "active" : ""}>
                        CARBINE-M4
                      </button>
                      <button onClick={() => setWeapon("REAPER-AK")} className={weapon === "REAPER-AK" ? "active" : ""}>
                        REAPER-AK
                      </button>
                      <button onClick={() => setWeapon("VIGIL-9")} className={weapon === "VIGIL-9" ? "active" : ""}>
                        VIGIL-9
                      </button>
                    </div>
                  </>
                )}

                {activePanel === "settings" && (
                  <>
                    <h3>Settings</h3>
                    <p>Visual and control profile options.</p>
                    <div className="stat-stack">
                      <span>Graphics: High</span>
                      <span>Post FX: Enabled</span>
                      <span>Mouse Sensitivity: 1.0</span>
                      <span>Audio Master: 80%</span>
                    </div>
                  </>
                )}

                {activePanel === "leaderboard" && (
                  <>
                    <h3>Leaderboard</h3>
                    <div className="scoreboard-list">
                      {sortedScore.map((entry) => (
                        <div key={entry.id} className="score-row">
                          <span>{entry.id === selfId ? "YOU" : entry.id.slice(0, 8)}</span>
                          <span>{entry.score}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="matchmake-box">
                  <h3>Matchmaking</h3>
                  <div className="menu-grid">
                    <button onClick={createRoom}>Create Room</button>
                    <button onClick={() => joinRoom(joinCode)}>Join Room</button>
                  </div>
                  <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Enter Room ID" />
                  <div className="room-list">
                    {rooms.map((room) => (
                      <button key={room.roomId} onClick={() => joinRoom(room.roomId)} className="room-item">
                        {room.roomId} | {room.players}/{room.maxPlayers}
                      </button>
                    ))}
                    {!rooms.length && <span>No active rooms</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="menu-footer">
              <span>Status: {connection}</span>
              <span>Current Weapon: {weapon}</span>
              {error && <span className="error">{error}</span>}
            </div>
          </div>
        </div>
      )}

      {(mode === "playing" || mode === "paused") && (
        <>
          <div className="hud-root">
            <div className="panel health-widget">
              <div className="hud-label">Vital Status</div>
              <div className="health-track">
                <div className={`health-fill ${hpClass}`} style={{ width: `${hpRatio * 100}%` }} />
              </div>
              <div className="health-meta">
                <span>HP</span>
                <strong>{hpValue}</strong>
              </div>
            </div>

            <div className="panel stats-widget">
              <div className="hud-label">Combat Feed</div>
              <div className="stat-grid">
                <span>Mode</span>
                <b>{netMode}</b>
                <span>Room</span>
                <b>{roomId || "-"}</b>
                <span>Time</span>
                <b>{gameTime.toFixed(1)}s</b>
                <span>Spawn</span>
                <b>{spawnRateSec.toFixed(2)}s</b>
                <span>Zombies</span>
                <b>{zombieAlive}</b>
              </div>
            </div>

            <div className="panel ammo-widget">
              <div className="hud-label">Ammunition</div>
              <div className="ammo-main">
                <strong>{String(combat?.mag ?? 0).padStart(2, "0")}</strong>
                <span>/ {String(combat?.reserve ?? 0).padStart(3, "0")}</span>
              </div>
              <div className="ammo-sub">{combat?.isReloading ? "Reloading..." : weapon}</div>
            </div>

            <div className="panel mini-widget">
              <div className="stat-stack">
                <span>Score: {me?.score ?? 0}</span>
                <span>Kills: {kills}</span>
                <span>Ping: {me?.ping ?? 0} ms</span>
              </div>
            </div>

          </div>

          <div className="panel scoreboard modern">
            <h3>Leaderboard</h3>
            {sortedScore.map((entry) => (
              <div key={entry.id} className="score-row">
                <span>{entry.id === selfId ? "YOU" : entry.id.slice(0, 6)}</span>
                <span>{entry.score}</span>
              </div>
          ))}
        </div>

          {mode === "paused" && (
            <div className="panel pause-overlay">
              <h2>Paused</h2>
              <button onClick={() => setMode("playing")}>Resume</button>
              <button onClick={restart}>Restart</button>
              <button onClick={exitToMenu}>Quit to Menu</button>
            </div>
          )}

          {gameOver && (
            <div className="panel game-over">
              <h2>You Died</h2>
              <button onClick={restart}>Restart</button>
              <button onClick={exitToMenu}>Back to Menu</button>
            </div>
          )}

          <div className="hint">WASD Move | Shift Sprint | Space Jump | Mouse Aim | Click Fire | R Reload | Esc Pause</div>
        </>
      )}
    </div>
  );
}
