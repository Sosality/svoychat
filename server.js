// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const users = new Map(); // username -> socket.id
const chats = new Map(); // ключ 'a|b' -> массив сообщений

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("register", (username) => {
    users.set(username, socket.id);
    socket.data.username = username;
    console.log(`✅ ${username} вошёл`);
    io.emit("users", Array.from(users.keys()));
  });

  socket.on("sendMessage", ({ from, to, text }) => {
    const chatKey = [from, to].sort().join("|");
    if (!chats.has(chatKey)) chats.set(chatKey, []);
    const message = { from, to, text, time: new Date() };
    chats.get(chatKey).push(message);

    const receiverSocket = users.get(to);
    if (receiverSocket) {
      io.to(receiverSocket).emit("message", message);
    }
    socket.emit("message", message);
  });

  socket.on("disconnect", () => {
    if (socket.data.username) {
      users.delete(socket.data.username);
      io.emit("users", Array.from(users.keys()));
      console.log(`🔴 ${socket.data.username} отключился`);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server started on port ${PORT}`));
