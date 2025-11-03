// server.js — улучшённый лог, acks, диагностические эндпоинты
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);

// Разрешаем origin из env или '*'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const PORT = process.env.PORT || 10000;

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  },
  // pingTimeout/pingInterval можно настроить, но оставим дефолт
});

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// In-memory (MVP)
const users = new Map();   // username -> { username, socketId, connectedAt }
const chats = new Map();   // chatKey -> [{ id, from, to, text, ts }]

// Helpers
const chatKey = (a, b) => [a, b].sort().join('|');

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Debug: список юзеров и чатов
app.get('/debug/state', (req, res) => {
  const u = Array.from(users.values());
  const c = {};
  for (const [k, v] of chats.entries()) c[k] = v.length;
  res.json({ users: u, chatsCount: c });
});

// Optional: get chat history
app.get('/api/chats/:a/:b', (req, res) => {
  const { a, b } = req.params;
  const key = chatKey(a, b);
  return res.json({ chatKey: key, messages: chats.get(key) || [] });
});

// Provide simple register via REST (optional)
app.post('/api/register', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (users.has(username)) return res.status(409).json({ error: 'username_taken' });
  users.set(username, { username, socketId: null, connectedAt: null });
  console.log('[REST] registered user', username);
  return res.json({ ok: true, username });
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('WS: connected socketId=', socket.id, ' (remote=', socket.handshake.address, ')');

  socket.on('register', (username) => {
    if (!username) {
      socket.emit('error', { error: 'username required' });
      return;
    }
    const now = new Date().toISOString();
    users.set(username, { username, socketId: socket.id, connectedAt: now });
    socket.data.username = username;
    console.log(`WS: register -> ${username} (socket=${socket.id})`);
    // broadcast current users (could be optimized)
    io.emit('users', Array.from(users.keys()));
    // ack to client
    socket.emit('registered', { ok: true, username, ts: now });
  });

  // sendMessage: with optional ack callback
  socket.on('sendMessage', (payload, cb) => {
    // payload: { from, to, text }
    try {
      if (!payload || !payload.from || !payload.to || !payload.text) {
        if (typeof cb === 'function') cb({ ok: false, error: 'invalid_payload' });
        return;
      }
      const id = uuidv4();
      const ts = new Date().toISOString();
      const msg = { id, from: payload.from, to: payload.to, text: payload.text, ts };
      const key = chatKey(payload.from, payload.to);
      if (!chats.has(key)) chats.set(key, []);
      chats.get(key).push(msg);

      console.log(`WS: sendMessage from=${payload.from} to=${payload.to} id=${id}`);

      // deliver to recipient if online
      const recipient = users.get(payload.to);
      if (recipient && recipient.socketId) {
        io.to(recipient.socketId).emit('message', msg);
        console.log(`WS: delivered to ${payload.to} (socket=${recipient.socketId})`);
      } else {
        console.log(`WS: recipient ${payload.to} not online — stored in memory`);
      }

      // Echo back to sender (so UI shows it)
      socket.emit('message', msg);

      // Call ack if provided
      if (typeof cb === 'function') cb({ ok: true, id, ts });
    } catch (err) {
      console.error('WS: sendMessage error', err);
      if (typeof cb === 'function') cb({ ok: false, error: 'server_error' });
    }
  });

  socket.on('disconnect', (reason) => {
    const username = socket.data.username;
    console.log('WS: disconnect', socket.id, 'reason=', reason, 'username=', username || '-');
    if (username && users.has(username)) {
      const u = users.get(username);
      if (u.socketId === socket.id) {
        u.socketId = null;
        users.set(username, u);
      }
      // broadcast update
      io.emit('users', Array.from(users.keys()));
    }
  });

  // Debug events
  socket.on('pingServer', () => socket.emit('pongServer', { ts: new Date().toISOString() }));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`CLIENT_ORIGIN=${CLIENT_ORIGIN}`);
});
