const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const TEAMS = new Set([
  "Real Madrid", "Barcelona", "Manchester United", "Manchester City",
  "Liverpool", "Bayern Münih", "Borussia Dortmund", "PSG", "Beşiktaş",
  "Fenerbahçe", "Galatasaray", "Trabzonspor", "Arsenal", "Chelsea", "Milan", "Inter"
]);

const cleanName = (v) => String(v || "Oyuncu").replace(/[<>]/g, "").trim().slice(0, 16) || "Oyuncu";
const makeCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join("");
  } while (rooms.has(code));
  return code;
};
const safeRoom = (r) => ({
  code: r.code,
  hostId: r.hostId,
  players: r.players.map(p => ({
    name: p.name, team: p.team, ready: p.ready, connected: !!p.socketId
  })),
  status: r.status,
  message: r.message,
  round: r.round,
  scores: [...r.scores],
  kicks: [...r.kicks],
  shooter: r.shooter,
  selections: r.players.map((p, i) => !!r.choices[i]),
  result: r.result,
  suddenDeath: r.suddenDeath
});
function publish(r) {
  io.to(r.code).emit("room:state", safeRoom(r));
}
function getPlayer(r, socket) {
  return r.players.findIndex(p => p.socketId === socket.id);
}
function roomFor(socket) {
  const code = socket.data.room;
  return code && rooms.get(code);
}
function resetMatch(r) {
  r.status = "playing";
  r.round = 1;
  r.scores = [0, 0];
  r.kicks = [0, 0];
  r.shooter = 0;
  r.choices = [null, null];
  r.result = null;
  r.suddenDeath = false;
  r.message = `${r.players[0].name} şut kullanıyor.`;
}
function nextKick(r) {
  r.choices = [null, null];
  r.result = null;
  const total = r.kicks[0] + r.kicks[1];
  if (total >= 10) {
    if (r.scores[0] !== r.scores[1]) {
      r.status = "finished";
      r.message = r.scores[0] > r.scores[1]
        ? `${r.players[0].name} kazandı!`
        : `${r.players[1].name} kazandı!`;
      publish(r);
      return;
    }
    // Sudden death continues in pairs; one kick each before deciding.
    r.suddenDeath = true;
  }
  r.shooter = total % 2 === 0 ? 0 : 1;
  r.round = total + 1;
  r.message = `${r.players[r.shooter].name} şut kullanıyor.`;
  publish(r);
}
function resolveKick(r) {
  const shooter = r.shooter;
  const keeper = 1 - shooter;
  const shot = r.choices[shooter];
  const dive = r.choices[keeper];
  const goal = shot.direction !== dive.direction;
  if (goal) r.scores[shooter]++;
  r.kicks[shooter]++;
  r.result = {
    shooter, keeper,
    shotDirection: shot.direction,
    keeperDirection: dive.direction,
    goal,
    shooterName: r.players[shooter].name,
    keeperName: r.players[keeper].name
  };
  r.message = goal ? "GOOOL!" : "KALECİ KURTARDI!";
  io.to(r.code).emit("kick:result", r.result);
  publish(r);
  // Give both clients time to play the same outcome animation.
  setTimeout(() => {
    if (rooms.get(r.code) !== r || r.status !== "playing") return;
    nextKick(r);
  }, 3600);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name }) => {
    const code = makeCode();
    const r = {
      code, hostId: socket.id,
      players: [{ socketId: socket.id, name: cleanName(name), team: null, ready: false }],
      status: "waiting", message: "Rakibini bekliyorsun.",
      round: 0, scores: [0, 0], kicks: [0, 0], shooter: 0,
      choices: [null, null], result: null, suddenDeath: false
    };
    rooms.set(code, r);
    socket.join(code);
    socket.data.room = code;
    socket.emit("room:created", { code });
    publish(r);
  });

  socket.on("room:join", ({ code, name }) => {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    const r = rooms.get(code);
    if (!r) return socket.emit("app:error", "Bu oda koduyla bir oda bulunamadı.");
    if (r.status !== "waiting" || r.players.length >= 2)
      return socket.emit("app:error", "Bu oda dolu veya maç başlamış.");
    if (socket.data.room) return socket.emit("app:error", "Önce mevcut odandan ayrıl.");
    r.players.push({ socketId: socket.id, name: cleanName(name), team: null, ready: false });
    socket.join(code);
    socket.data.room = code;
    r.message = "İki oyuncu da takımını seçebilir.";
    publish(r);
  });

  socket.on("team:select", ({ team }) => {
    const r = roomFor(socket);
    if (!r || r.status !== "waiting") return;
    const i = getPlayer(r, socket);
    if (i < 0 || r.players[i].ready || !TEAMS.has(team)) return;
    r.players[i].team = team;
    r.message = `${r.players[i].name} takımını seçti.`;
    publish(r);
  });

  socket.on("player:ready", ({ ready }) => {
    const r = roomFor(socket);
    if (!r || r.status !== "waiting") return;
    const i = getPlayer(r, socket);
    if (i < 0) return;
    const p = r.players[i];
    if (ready && !p.team) return socket.emit("app:error", "Önce bir takım seçmelisin.");
    p.ready = !!ready;
    r.message = p.ready ? `${p.name} hazır.` : `${p.name} hazır değil.`;
    publish(r);
  });

  socket.on("match:start", () => {
    const r = roomFor(socket);
    if (!r || r.status !== "waiting") return;
    if (socket.id !== r.hostId) return socket.emit("app:error", "Maçı yalnızca oda sahibi başlatabilir.");
    if (r.players.length !== 2 || !r.players.every(p => p.ready && p.team))
      return socket.emit("app:error", "İki oyuncu da takımını seçip hazır olmalı.");
    resetMatch(r);
    publish(r);
  });

  socket.on("kick:choose", ({ direction }) => {
    const r = roomFor(socket);
    if (!r || r.status !== "playing" || r.result) return;
    if (!["left", "center", "right"].includes(direction)) return;
    const i = getPlayer(r, socket);
    if (i < 0 || r.choices[i]) return;
    const role = i === r.shooter ? "shot" : "dive";
    r.choices[i] = { direction };
    socket.emit("kick:locked", { role });
    if (r.choices.every(Boolean)) resolveKick(r);
    else {
      r.message = "İki oyuncunun gizli seçimi bekleniyor...";
      publish(r);
    }
  });

  socket.on("match:rematch", () => {
    const r = roomFor(socket);
    if (!r || r.status !== "finished") return;
    const i = getPlayer(r, socket);
    if (i < 0) return;
    r.rematch = r.rematch || [false, false];
    r.rematch[i] = true;
    if (r.rematch.every(Boolean)) {
      r.rematch = [false, false];
      resetMatch(r);
    } else r.message = "Rövanş için rakibin bekleniyor.";
    publish(r);
  });

  socket.on("room:leave", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const r = roomFor(socket);
  if (!r) return;
  const i = getPlayer(r, socket);
  if (i >= 0) {
    if (r.status === "waiting") {
      r.players.splice(i, 1);
      if (r.players.length) {
        r.hostId = r.players[0].socketId;
        r.message = "Rakibin bağlantısı kesildi. Yeni oyuncu bekleniyor.";
        publish(r);
      } else rooms.delete(r.code);
    } else {
      r.players[i].socketId = null;
      r.status = "paused";
      r.message = "Oyuncunun bağlantısı kesildi. Oda sahibi sayfayı yenileyerek yeniden bağlanabilir.";
      publish(r);
    }
  }
  socket.leave(r.code);
  delete socket.data.room;
}

server.listen(PORT, "0.0.0.0", () => console.log(`Penaltı Arenası ${PORT} portunda hazır`));
