import WebSocket, { WebSocketServer } from "ws";
import http from "http";

const sessions = {};

const server = http.createServer((req, res) => {
  if (req.url === "/status") {
    const debugSessions = {};

    for (const id in sessions) {
      debugSessions[id] = {
        agentConnected: !!sessions[id].broadcaster,
        viewerConnected: !!sessions[id].viewer,
        lastEvent: sessions[id].lastEvent || "none",
        lastUpdated: sessions[id].lastUpdated || "never"
      };
    }

    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      status: "OK",
      activeSessions: debugSessions
    }, null, 2));

    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("🔌 Connected");
ws.isAlive = true;

ws.on("pong", () => {
  ws.isAlive = true;
});

  let currentSessionId = null;
  let role = null;

  ws.on("message", (msg) => {
    let data;

    try {
      data = JSON.parse(msg.toString());
    } catch {
      console.log("⚠️ Invalid JSON message ignored");
      return;
    }

    // ===============================
// 🔴 VIEWER MANUAL DISCONNECT
// ===============================
if (data.type === "viewer-disconnect") {
  console.log("🔴 Viewer manually disconnected");

  if (currentSessionId && sessions[currentSessionId]) {

    delete sessions[currentSessionId].viewer;

    // notify agent immediately
    if (sessions[currentSessionId].broadcaster) {
      sessions[currentSessionId].broadcaster.send(JSON.stringify({
        type: "viewer-left"
      }));
    }

    // clean empty session
    if (!sessions[currentSessionId].broadcaster) {
      delete sessions[currentSessionId];
      console.log("🧹 Session removed (viewer left):", currentSessionId);
    }
  }

  return;
}

    // ===============================
    // 👀 VIEWER JOIN
    // ===============================
    if (data.type === "join-viewer") {
      if (!data.sessionId) {
        console.log("⚠️ join-viewer missing sessionId");
        return;
      }

      currentSessionId = data.sessionId;
      role = "viewer";

      // 🔥 HARD RESET SESSION (fix stale dead sessions)
   sessions[currentSessionId] = {
  viewer: ws,
  broadcaster: sessions[currentSessionId]?.broadcaster || null,
  lastEvent: "Viewer joined",
  lastUpdated: new Date().toLocaleString()
};

      console.log("👀 Viewer joined:", currentSessionId);

    if (sessions[currentSessionId].broadcaster) {

  const sendViewerReady = () => {
    if (
      sessions[currentSessionId] &&
      sessions[currentSessionId].broadcaster
    ) {
      sessions[currentSessionId].broadcaster.send(JSON.stringify({
        type: "viewer-ready"
      }));

      console.log("🚀 viewer-ready sent to agent");
    }
  };

  // immediate send
  sendViewerReady();

  // retry after short delay (critical fix)
  setTimeout(sendViewerReady, 1000);
  setTimeout(sendViewerReady, 2500);
}
return;
}

    // ===============================
    // 🟢 AGENT JOIN
    // ===============================
    if (
      data.type === "join-agent" ||
      data.type === "join-broadcaster" ||
      data.type === "agent-join"
    ) {
      if (!data.sessionId) {
        console.log("⚠️ join-agent missing sessionId");
        return;
      }

      currentSessionId = data.sessionId;
      role = "agent";

      // 🔥 KEEP VIEWER, REPLACE AGENT CLEANLY
      sessions[currentSessionId] = {
        viewer: sessions[currentSessionId]?.viewer || null,
        broadcaster: ws,
        lastEvent: "Agent joined",
        lastUpdated: new Date().toLocaleString()
      };

      console.log("🟢 Agent joined:", currentSessionId);

      if (sessions[currentSessionId].viewer) {
        ws.send(JSON.stringify({
          type: "viewer-ready"
        }));

        console.log("🚀 viewer-ready sent to agent");
      }

      return;
    }

    // ===============================
    // 🔁 SIGNALING
    // ===============================
    if (["offer", "answer", "ice-candidate"].includes(data.type)) {
      if (!data.sessionId) {
        console.log(`⚠️ ${data.type} missing sessionId`);
        return;
      }

      const s = sessions[data.sessionId];
      if (!s) return;

      if (data.type === "offer") {
        console.log("📡 Offer → viewer");

        s.lastEvent = "Offer sent to viewer";
        s.lastUpdated = new Date().toLocaleString();

        s.viewer?.send(JSON.stringify(data));
      }

      if (data.type === "answer") {
        console.log("📡 Answer → agent");

        s.lastEvent = "Answer sent to agent";
        s.lastUpdated = new Date().toLocaleString();

        s.broadcaster?.send(JSON.stringify(data));
      }

      if (data.type === "ice-candidate") {
        console.log("❄️ ICE candidate exchanged");

        s.lastEvent = "ICE candidate exchanged";
        s.lastUpdated = new Date().toLocaleString();

        if (data.from === "viewer") {
          s.broadcaster?.send(JSON.stringify(data));
        } else {
          s.viewer?.send(JSON.stringify(data));
        }
      }

      return;
    }
  });

  // ===============================
  // 🔥 CLEANUP ON DISCONNECT
  // ===============================
  ws.on("close", () => {
    console.log("❌ Disconnected");

    if (currentSessionId && sessions[currentSessionId]) {
      if (role === "viewer") {
        delete sessions[currentSessionId].viewer;
      }

      if (role === "agent") {
        delete sessions[currentSessionId].broadcaster;
      }

      // 🔥 Remove empty dead session
      if (
        !sessions[currentSessionId].viewer &&
        !sessions[currentSessionId].broadcaster
      ) {
        delete sessions[currentSessionId];
        console.log("🧹 Empty session removed:", currentSessionId);
      }
    }
  });
});
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log("💀 Terminating dead connection");
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 WebRTC running on port", PORT);
});