import type { WebSocket } from "ws";

// Use globalThis to share state between the custom server entry point
// and Next.js-bundled code (which are separate module instances).
const globalRooms = globalThis as unknown as {
  __wsRooms?: Map<string, Set<WebSocket>>;
};
if (!globalRooms.__wsRooms) {
  globalRooms.__wsRooms = new Map();
}
const rooms = globalRooms.__wsRooms;

export function addClient(gameCode: string, ws: WebSocket) {
  const code = gameCode.toUpperCase();
  if (!rooms.has(code)) {
    rooms.set(code, new Set());
  }
  rooms.get(code)!.add(ws);

  ws.on("close", () => {
    const room = rooms.get(code);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(code);
      }
    }
  });
}

export function notify(gameCode: string) {
  const code = gameCode.toUpperCase();
  const room = rooms.get(code);
  if (!room) return;

  const msg = JSON.stringify({ type: "invalidate" });
  for (const ws of room) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}
