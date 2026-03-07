import { MESSAGE_TYPES } from "../game/constants";
import { HostAuthority } from "./host/HostAuthority";

export class NetClient {
  constructor({ url, onMessage, onOpen, onClose, onError }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onError = onError;
    this.ws = null;
    this.selfId = null;
    this.roomId = null;
    this.hostId = null;
    this.isHost = false;
    this.authority = null;
    this.peers = new Map();
    this.channels = new Map();
    this.pendingJoinInfo = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!this.url) {
      this.onError?.("Signaling URL is not configured.");
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.onError?.(`Failed to open signaling socket (${this.url}).`);
      return;
    }
    this.ws.addEventListener("open", () => this.onOpen?.());
    this.ws.addEventListener("close", () => this.onClose?.());
    this.ws.addEventListener("error", () => this.onError?.(`Signaling connection error (${this.url})`));
    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleSignalMessage(msg);
      } catch {
        this.onError?.("Malformed signaling packet");
      }
    });
  }

  sendWhenOpen(type, payload = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send(type, payload);
      return;
    }

    this.connect();
    if (!this.ws) return;

    const once = () => {
      this.send(type, payload);
    };
    this.ws.addEventListener("open", once, { once: true });
  }

  disconnect() {
    this.teardownSession(false);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  createRoom() {
    this.sendWhenOpen(MESSAGE_TYPES.CREATE_ROOM);
  }

  joinRoom(roomId) {
    this.sendWhenOpen(MESSAGE_TYPES.JOIN_ROOM, { roomId });
  }

  leaveRoom() {
    this.teardownSession(true);
    this.send("LEAVE_ROOM");
  }

  move(position, rotation, seq) {
    if (!this.roomId) return;
    if (this.isHost) {
      this.authority?.handleMove(this.selfId, { position, rotation, seq });
      return;
    }
    this.sendToHost({
      type: MESSAGE_TYPES.PLAYER_MOVE,
      position,
      rotation,
      seq
    });
  }

  shoot(direction, origin) {
    if (!this.roomId) return;
    if (this.isHost) {
      this.authority?.handleShoot(this.selfId, { direction, origin });
      return;
    }
    this.sendToHost({
      type: MESSAGE_TYPES.SHOOT,
      direction,
      origin
    });
  }

  restart() {
    if (!this.roomId) return;
    if (this.isHost) {
      this.authority?.restart();
      return;
    }
    this.sendToHost({ type: MESSAGE_TYPES.RESTART });
  }

  ping(clientTs) {
    if (!this.roomId) {
      this.send("PING", { clientTs });
      return;
    }
    if (this.isHost) {
      this.onMessage?.({ type: MESSAGE_TYPES.PONG, clientTs, serverTs: Date.now() });
      return;
    }
    this.sendToHost({ type: MESSAGE_TYPES.PING, clientTs });
  }

  handleSignalMessage(msg) {
    if (!msg?.type) return;

    if (msg.type === "HELLO") {
      this.selfId = msg.selfId;
      return;
    }

    if (msg.type === MESSAGE_TYPES.ROOM_LIST) {
      this.onMessage?.(msg);
      return;
    }

    if (msg.type === "ROOM_JOINED") {
      this.roomId = msg.roomId;
      this.selfId = msg.selfId || this.selfId;
      this.hostId = msg.hostId;
      this.isHost = !!msg.isHost;

      if (this.isHost) {
        this.startHostAuthority();
        const snap = this.authority?.getJoinSnapshot() || { players: {}, zombies: {}, gameTime: 0, spawnRateSec: 2.5 };
        this.onMessage?.({
          type: MESSAGE_TYPES.ROOM_JOINED,
          roomId: this.roomId,
          selfId: this.selfId,
          ...snap
        });
      } else {
        this.pendingJoinInfo = { roomId: this.roomId, selfId: this.selfId };
      }
      return;
    }

    if (msg.type === "PEER_JOINED") {
      if (!this.isHost) return;
      this.createHostPeer(msg.peerId);
      return;
    }

    if (msg.type === "PEER_LEFT") {
      this.closePeer(msg.peerId);
      if (this.isHost) {
        this.authority?.removePlayer(msg.peerId);
      } else if (msg.peerId === this.hostId) {
        this.onError?.("Host disconnected.");
      } else {
        this.onMessage?.({ type: MESSAGE_TYPES.PLAYER_LEFT, playerId: msg.peerId });
      }
      return;
    }

    if (msg.type === "SIGNAL") {
      this.handlePeerSignal(msg.from, msg.data);
      return;
    }

    if (msg.type === "PONG" || msg.type === MESSAGE_TYPES.ERROR) {
      this.onMessage?.(msg);
    }
  }

  startHostAuthority() {
    this.authority?.stop();
    this.authority = new HostAuthority({
      hostId: this.selfId,
      onStateDiff: (diff) => {
        const packet = { type: MESSAGE_TYPES.STATE_UPDATE, ...diff };
        this.onMessage?.(packet);
        for (const channel of this.channels.values()) {
          this.sendChannel(channel, packet);
        }
      },
      onGameOver: ({ gameTime }) => {
        const packet = { type: MESSAGE_TYPES.GAME_OVER, gameTime };
        this.onMessage?.(packet);
        for (const channel of this.channels.values()) {
          this.sendChannel(channel, packet);
        }
      }
    });
    this.authority.start();
  }

  getRtcConfig() {
    const stun = import.meta.env.VITE_STUN_URL?.trim() || "stun:stun.l.google.com:19302";
    const turnUrl = import.meta.env.VITE_TURN_URL?.trim();
    const turnUser = import.meta.env.VITE_TURN_USERNAME?.trim();
    const turnPass = import.meta.env.VITE_TURN_CREDENTIAL?.trim();
    const iceServers = [{ urls: stun }];
    if (turnUrl && turnUser && turnPass) {
      iceServers.push({ urls: turnUrl, username: turnUser, credential: turnPass });
    }
    return { iceServers };
  }

  createPeerConnection(peerId) {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId);
    }
    const pc = new RTCPeerConnection(this.getRtcConfig());
    this.peers.set(peerId, pc);
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.send("SIGNAL", {
        to: peerId,
        data: { type: "ice", candidate: event.candidate }
      });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        this.closePeer(peerId);
        if (this.isHost) {
          this.authority?.removePlayer(peerId);
        } else if (peerId === this.hostId) {
          this.onError?.("Lost connection to host.");
        }
      }
    };
    return pc;
  }

  createHostPeer(peerId) {
    const pc = this.createPeerConnection(peerId);
    const channel = pc.createDataChannel("game", { ordered: true });
    this.setupDataChannel(peerId, channel);
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        this.send("SIGNAL", {
          to: peerId,
          data: { type: "offer", sdp: pc.localDescription }
        });
      })
      .catch(() => {
        this.onError?.(`Failed to create WebRTC offer for ${peerId}`);
      });
  }

  handlePeerSignal(from, data) {
    if (!from || !data?.type) return;
    const pc = this.createPeerConnection(from);

    if (!this.isHost && from === this.hostId && !pc.ondatachannel) {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(from, event.channel);
      };
    }

    if (data.type === "offer") {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(from, event.channel);
      };
      pc.setRemoteDescription(data.sdp)
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          this.send("SIGNAL", {
            to: from,
            data: { type: "answer", sdp: pc.localDescription }
          });
        })
        .catch(() => {
          this.onError?.("Failed to accept WebRTC offer.");
        });
      return;
    }

    if (data.type === "answer") {
      pc.setRemoteDescription(data.sdp).catch(() => {
        this.onError?.("Failed to apply WebRTC answer.");
      });
      return;
    }

    if (data.type === "ice") {
      pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  setupDataChannel(peerId, channel) {
    this.channels.set(peerId, channel);
    channel.onopen = () => {
      if (!this.isHost) return;
      this.authority?.addPlayer(peerId);
      const snap = this.authority?.getJoinSnapshot() || { players: {}, zombies: {}, gameTime: 0, spawnRateSec: 2.5 };
      this.sendChannel(channel, {
        type: "WELCOME",
        roomId: this.roomId,
        selfId: peerId,
        ...snap
      });
    };
    channel.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleChannelMessage(peerId, msg);
    };
    channel.onerror = () => {};
    channel.onclose = () => {
      this.closePeer(peerId);
      if (this.isHost) {
        this.authority?.removePlayer(peerId);
      }
    };
  }

  handleChannelMessage(peerId, msg) {
    if (!msg?.type) return;

    if (this.isHost) {
      if (msg.type === MESSAGE_TYPES.PLAYER_MOVE) {
        this.authority?.handleMove(peerId, msg);
        return;
      }
      if (msg.type === MESSAGE_TYPES.SHOOT) {
        this.authority?.handleShoot(peerId, msg);
        return;
      }
      if (msg.type === MESSAGE_TYPES.RESTART) {
        this.authority?.restart();
        return;
      }
      if (msg.type === MESSAGE_TYPES.PING) {
        const latency = typeof msg.clientTs === "number" ? Math.max(0, Date.now() - msg.clientTs) : 0;
        this.authority?.setPlayerPing(peerId, latency);
        const channel = this.channels.get(peerId);
        this.sendChannel(channel, {
          type: MESSAGE_TYPES.PONG,
          clientTs: msg.clientTs,
          serverTs: Date.now()
        });
      }
      return;
    }

    if (msg.type === "WELCOME") {
      this.onMessage?.({
        type: MESSAGE_TYPES.ROOM_JOINED,
        roomId: msg.roomId || this.pendingJoinInfo?.roomId,
        selfId: msg.selfId || this.pendingJoinInfo?.selfId || this.selfId,
        players: msg.players || {},
        zombies: msg.zombies || {},
        gameTime: typeof msg.gameTime === "number" ? msg.gameTime : 0,
        spawnRateSec: typeof msg.spawnRateSec === "number" ? msg.spawnRateSec : 2.5
      });
      this.pendingJoinInfo = null;
      return;
    }

    if (
      msg.type === MESSAGE_TYPES.STATE_UPDATE ||
      msg.type === MESSAGE_TYPES.GAME_OVER ||
      msg.type === MESSAGE_TYPES.PONG ||
      msg.type === MESSAGE_TYPES.ERROR ||
      msg.type === MESSAGE_TYPES.PLAYER_LEFT
    ) {
      this.onMessage?.(msg);
    }
  }

  sendChannel(channel, payload) {
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(payload));
  }

  sendToHost(payload) {
    const channel = this.channels.get(this.hostId);
    this.sendChannel(channel, payload);
  }

  closePeer(peerId) {
    const channel = this.channels.get(peerId);
    if (channel) {
      this.channels.delete(peerId);
      channel.close();
    }
    const pc = this.peers.get(peerId);
    if (pc) {
      this.peers.delete(peerId);
      pc.close();
    }
  }

  teardownSession(notifyPeers) {
    if (notifyPeers && this.isHost) {
      for (const channel of this.channels.values()) {
        this.sendChannel(channel, {
          type: MESSAGE_TYPES.ERROR,
          code: "HOST_LEFT",
          message: "Host ended the room."
        });
      }
    }
    for (const peerId of Array.from(this.peers.keys())) {
      this.closePeer(peerId);
    }
    this.authority?.stop();
    this.authority = null;
    this.roomId = null;
    this.hostId = null;
    this.isHost = false;
    this.pendingJoinInfo = null;
  }
}
