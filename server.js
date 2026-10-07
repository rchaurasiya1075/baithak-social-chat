const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;

const state = {
  members: {},
  messages: [
    {
      id: "m0",
      type: "system",
      text: "Baithak khul gaya. Room code yahin share karo — koi paise nahi.",
      at: Date.now() - 60000
    }
  ],
  matches: []
};

function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function publicState() {
  return {
    members: Object.values(state.members).map((m) => ({ id: m.id, name: m.name })),
    messages: state.messages.slice(-200),
    matches: state.matches
  };
}

function broadcast() {
  const payload = JSON.stringify({ type: "state", state: publicState() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("no");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", state: publicState() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      const name = String(msg.name || "Player").slice(0, 24);
      const id = uid("u");
      state.members[id] = { id, name };
      ws.userId = id;
      state.messages.push({ id: uid("m"), type: "system", text: name + " group me aaya.", at: Date.now() });
      ws.send(JSON.stringify({ type: "welcome", userId: id, name }));
      broadcast();
      return;
    }

    const user = state.members[ws.userId];
    if (!user) return;

    if (msg.type === "chat") {
      const text = String(msg.text || "").trim().slice(0, 400);
      if (!text) return;
      state.messages.push({ id: uid("m"), type: "chat", userId: user.id, name: user.name, text, at: Date.now() });
      broadcast();
      return;
    }

    if (msg.type === "challenge") {
      const match = {
        id: uid("g"),
        game: String(msg.game || "Ludo King").slice(0, 32),
        mode: String(msg.mode || "Classic").slice(0, 24),
        note: String(msg.note || "").slice(0, 80),
        hostId: user.id,
        hostName: user.name,
        guestId: null,
        guestName: null,
        code: "",
        status: "open",
        createdAt: Date.now(),
        codeAt: null
      };
      state.matches.unshift(match);
      state.messages.push({ id: uid("m"), type: "challenge", matchId: match.id, at: Date.now() });
      broadcast();
      return;
    }

    const match = state.matches.find((m) => m.id === msg.matchId);
    if (!match) return;

    if (msg.type === "accept" && match.status === "open" && match.hostId !== user.id) {
      match.status = "locked";
      match.guestId = user.id;
      match.guestName = user.name;
      state.messages.push({
        id: uid("m"),
        type: "system",
        text: user.name + " ne " + match.hostName + " ka " + match.game + " challenge accept kiya.",
        at: Date.now()
      });
      broadcast();
      return;
    }

    if (msg.type === "code" && match.status === "locked" && match.hostId === user.id) {
      match.code = String(msg.code || "").replace(/\s/g, "").slice(0, 12).toUpperCase();
      if (!match.code) return;
      match.status = "live";
      match.codeAt = Date.now();
      state.messages.push({
        id: uid("m"),
        type: "system",
        text: "Room code live hai. Opponent copy karke join kare. 15 min timer chalu.",
        at: Date.now()
      });
      broadcast();
      return;
    }

    if (msg.type === "done" && match.status === "live" && (match.hostId === user.id || match.guestId === user.id)) {
      match.status = "done";
      state.messages.push({
        id: uid("m"),
        type: "system",
        text: match.game + " match complete mark hua (" + user.name + ").",
        at: Date.now()
      });
      broadcast();
      return;
    }

    if (msg.type === "cancel" && match.status !== "done" && (match.hostId === user.id || match.guestId === user.id)) {
      match.status = "cancelled";
      state.messages.push({
        id: uid("m"),
        type: "system",
        text: user.name + " ne match cancel kiya.",
        at: Date.now()
      });
      broadcast();
    }
  });

  ws.on("close", () => {
    if (ws.userId && state.members[ws.userId]) {
      const name = state.members[ws.userId].name;
      delete state.members[ws.userId];
      state.messages.push({ id: uid("m"), type: "system", text: name + " nikal gaya.", at: Date.now() });
      broadcast();
    }
  });
});

server.listen(PORT, () => {
  console.log("Baithak social chat  http://localhost:" + PORT);
});
