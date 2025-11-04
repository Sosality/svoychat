// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import { pool } from "./db.js";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// Создаём HTTP + Socket.IO сервер
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // можешь ограничить до своего фронтенда
  },
});

// ===========================
// 🔐 Вспомогательные функции
// ===========================
function encryptPrivateKey(privKey, password) {
  return CryptoJS.AES.encrypt(privKey, process.env.SECRET_KEY + password).toString();
}
function decryptPrivateKey(ciphertext, password) {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, process.env.SECRET_KEY + password);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    console.error("Decryption failed:", err);
    return null;
  }
}

// ===========================
// 🧩 REST-эндпоинты
// ===========================
app.get("/", (_, res) => res.send("✅ SvoyChat API is running"));

// Регистрация
app.post("/api/register", async (req, res) => {
  const { username, password, pubKey, privKey } = req.body;
  if (!username || !password || !pubKey || !privKey)
    return res.status(400).json({ error: "Missing fields" });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const privEnc = encryptPrivateKey(privKey, password);
    await pool.query(
      `INSERT INTO users (username, password_hash, pub_key, priv_key_enc)
       VALUES ($1, $2, $3, $4)`,
      [username.toLowerCase(), passwordHash, pubKey, privEnc]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    if (err.code === "23505") return res.status(409).json({ error: "Username already exists" });
    res.status(500).json({ error: "Internal error" });
  }
});

// Авторизация
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username.toLowerCase()]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(403).json({ error: "Invalid password" });
    const privDec = decryptPrivateKey(user.priv_key_enc, password);
    res.json({ ok: true, username: user.username, pubKey: user.pub_key, privKey: privDec });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Получить публичный ключ
app.get("/api/keys/:username", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT pub_key FROM users WHERE username=$1", [req.params.username.toLowerCase()]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json({ username: req.params.username, pubKey: rows[0].pub_key });
  } catch {
    res.status(500).json({ error: "Internal error" });
  }
});

// Вернуть онлайн-пользователей для REST-запроса
app.get("/api/users", (_, res) => {
  const list = Array.from(io.sockets.adapter.rooms.get("online") || []);
  res.json(list.map((id) => onlineUsers[id]));
});

// ===========================
// ⚡ Socket.IO логика
// ===========================
const onlineUsers = {}; // socket.id -> username

io.on("connection", (socket) => {
  console.log("🟢 New connection:", socket.id);

  socket.on("register", (username) => {
    if (!username) return;
    onlineUsers[socket.id] = username;
    socket.join("online");
    console.log("✅", username, "зарегистрировался");
    io.emit("users", Object.values(onlineUsers));
    socket.emit("registered", { ok: true, username });
  });

  socket.on("sendMessage", (data, ack) => {
    const { from, to, text } = data;
    if (!from || !to || !text) return;
    const msg = { from, to, text, ts: new Date().toISOString() };
    // Отправляем адресату
    for (const [id, name] of Object.entries(onlineUsers)) {
      if (name === to) {
        io.to(id).emit("message", msg);
      }
    }
    // Отправляем себе
    socket.emit("message", msg);
    if (ack) ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const name = onlineUsers[socket.id];
    delete onlineUsers[socket.id];
    io.emit("users", Object.values(onlineUsers));
    console.log("🔴 Disconnected:", name || socket.id);
  });
});

// ===========================
// 🚀 Запуск
// ===========================
server.listen(PORT, () => console.log(`✅ Server with Socket.IO running on port ${PORT}`));
