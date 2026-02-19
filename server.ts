import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { addClient } from "~/server/ws/notify";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname: "0.0.0.0", port });

void app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();
  const server = createServer((req, res) => {
    void handle(req, res, parse(req.url!, true));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = parse(req.url!, true);

    if (pathname === "/ws") {
      const gameCode = query.gameCode;
      if (typeof gameCode !== "string" || !gameCode) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        addClient(gameCode, ws);
      });
    } else {
      // Forward to Next.js for HMR WebSocket handling
      upgradeHandler(req, socket, head);
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`> Ready on http://0.0.0.0:${port}`);
  });
});
