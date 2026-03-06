import { MESSAGE_TYPES } from "../game/constants";

export class NetClient {
  constructor({ url, onMessage, onOpen, onClose, onError }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onError = onError;
    this.ws = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => this.onOpen?.());
    this.ws.addEventListener("close", () => this.onClose?.());
    this.ws.addEventListener("error", () => this.onError?.("Connection error"));
    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.onMessage?.(msg);
      } catch {
        this.onError?.("Malformed server packet");
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
    this.send(MESSAGE_TYPES.LEAVE_ROOM);
  }

  move(position, rotation, seq) {
    this.send(MESSAGE_TYPES.PLAYER_MOVE, { position, rotation, seq });
  }

  shoot(direction) {
    this.send(MESSAGE_TYPES.SHOOT, { direction });
  }

  restart() {
    this.sendWhenOpen(MESSAGE_TYPES.RESTART);
  }

  ping(clientTs) {
    this.send(MESSAGE_TYPES.PING, { clientTs });
  }
}
