import WebSocket, { WebSocketServer } from "ws";
import http from "http";
const SIGNAL_SECRET = process.env.SIGNAL_SECRET || "";

const sessions = {};
const connectionLimits = {};

const server = http.createServer((req, res) => {
  if (req.url === "/status") {
    if (req.headers["x-status-secret"] !== SIGNAL_SECRET) {
  res.writeHead(403);
  res.end("Forbidden");
  return;
}
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

function safeSend(ws, payload) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  } catch (err) {
    console.log("safeSend error:", err.message);
  }
}
wss.on("connection", (ws) => {
  const ip =
  ws._socket?.remoteAddress || "unknown";

const now = Date.now();

if (!connectionLimits[ip]) {
  connectionLimits[ip] = [];
}

connectionLimits[ip] =
  connectionLimits[ip].filter(
    (t) => now - t < 60000
  );

connectionLimits[ip].push(now);

if (connectionLimits[ip].length > 50) {
  console.log("🚫 Too many websocket connections:", ip);

  ws.terminate();
  return;
}
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

  const disconnectSessionId = data.sessionId;

  console.log("🔴 Viewer manually disconnected:", disconnectSessionId);

if (
  disconnectSessionId &&
  sessions[disconnectSessionId]
) {

  delete sessions[disconnectSessionId].viewer;
  sessions[disconnectSessionId].lastEvent =
  "Viewer disconnected";

sessions[disconnectSessionId].lastUpdated =
Date.now()  

  if (sessions[disconnectSessionId].broadcaster) {

    safeSend(
      sessions[disconnectSessionId].broadcaster,
      {
        type: "viewer-left"
      }
    );

  }

  if (!sessions[disconnectSessionId].broadcaster) {
    delete sessions[disconnectSessionId];

    console.log(
      "🧹 Session removed (viewer left):",
      disconnectSessionId
    );
  }
}

return;
}

    // ===============================
    // 👀 VIEWER JOIN
    // ===============================
    if (data.type === "join-viewer") {

  if (data.secret !== SIGNAL_SECRET) {
    console.log("❌ Unauthorized viewer");
    return;
  }

      if (!data.sessionId) {
  console.log("❌ Viewer missing sessionId");
  return;
}

currentSessionId = data.sessionId;
role = "viewer";
try {
  sessions[currentSessionId]?.viewer?.terminate?.();
} catch {}
      // 🔥 HARD RESET SESSION (fix stale dead sessions)
if (!sessions[currentSessionId]) {
  sessions[currentSessionId] = {};
}

sessions[currentSessionId].viewer = ws;

sessions[currentSessionId].lastEvent =
  "Viewer joined";

sessions[currentSessionId].lastUpdated =
  new Date().toLocaleString();

      console.log("👀 Viewer joined:", currentSessionId);

    if (sessions[currentSessionId].broadcaster) {

  const sendViewerReady = () => {
    if (
      sessions[currentSessionId] &&
      sessions[currentSessionId].broadcaster
    ) {
     safeSend(
  sessions[currentSessionId].broadcaster,
  {
    type: "viewer-ready"
  }
);

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

if (data.secret !== SIGNAL_SECRET) {
      console.log("❌ Unauthorized agent");
    return;
  }

  if (!data.sessionId) {
  console.log("❌ Agent missing sessionId");
  return;
}

currentSessionId = data.sessionId;
role = "agent";
try {
  sessions[currentSessionId]?.broadcaster?.terminate?.();
} catch {}

      // 🔥 KEEP VIEWER, REPLACE AGENT CLEANLY
   if (!sessions[currentSessionId]) {
  sessions[currentSessionId] = {};
}

sessions[currentSessionId].broadcaster = ws;

sessions[currentSessionId].lastEvent =
  "Agent joined";

sessions[currentSessionId].lastUpdated =
  new Date().toLocaleString();

      console.log("🟢 Agent joined:", currentSessionId);

      if (sessions[currentSessionId].viewer) {
     safeSend(ws, {
  type: "viewer-ready"
});

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

if (!s) {
  console.log(
    `⚠️ Missing session for ${data.type}:`,
    data.sessionId
  );
  return;
}

      if (data.type === "offer") {
        console.log("📡 Offer → viewer");

        s.lastEvent = "Offer sent to viewer";
        s.lastUpdated = new Date().toLocaleString();

safeSend(s.viewer, data);      }

      if (data.type === "answer") {
        console.log("📡 Answer → agent");

        s.lastEvent = "Answer sent to agent";
        s.lastUpdated = new Date().toLocaleString();

safeSend(s.broadcaster, data);      }

      if (data.type === "ice-candidate") {
        console.log("❄️ ICE candidate exchanged");

        s.lastEvent = "ICE candidate exchanged";
        s.lastUpdated = new Date().toLocaleString();

        if (data.from === "viewer") {
          safeSend(s.broadcaster, data);
        } else {
          safeSend(s.viewer, data);
        }
      }

      return;
    }
  });

  // ===============================
  // 🔥 CLEANUP ON DISCONNECT
  // ===============================

  ws.on("error", (err) => {
  console.log("⚠️ WebSocket error:", err.message);
});

  ws.on("close", () => {
    console.log("❌ Disconnected");

    if (currentSessionId && sessions[currentSessionId]) {
     if (role === "viewer") {

  delete sessions[currentSessionId].viewer;

  sessions[currentSessionId].lastEvent =
    "Viewer socket closed";

  sessions[currentSessionId].lastUpdated =
    new Date().toLocaleString();
}

    if (role === "agent") {

  delete sessions[currentSessionId].broadcaster;

  sessions[currentSessionId].lastEvent =
    "Agent socket closed";

  sessions[currentSessionId].lastUpdated =
    new Date().toLocaleString();
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
// 🔥 CLEAN STALE SESSIONS
setInterval(() => {

  const now = Date.now();

  for (const sessionId in sessions) {

    const session = sessions[sessionId];

    const updated =
  Number(session.lastUpdated || 0);

    if (now - updated > 30 * 60 * 1000) {

      console.log(
        "🧹 Removing stale WebRTC session:",
        sessionId
      );

      try {
        session.viewer?.terminate?.();
      } catch {}

      try {
        session.broadcaster?.terminate?.();
      } catch {}

      delete sessions[sessionId];
    }
  }

}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 WebRTC running on port", PORT);
});