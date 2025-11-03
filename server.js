// server.js
// WebService-only server: REST API + Socket.IO
// Does NOT serve index.html or static files (client is hosted elsewhere)

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);

// Configure allowed origin(s) via env var CLIENT_ORIGIN (or '*' for development)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// In-memory stores (MVP). Replace with DB for persistence.
const users = new Map();     // username -> { username, socketId, createdAt }
const chats = new Map();     // chatKey -> [{ id, from, to, text, ts }]

// Helpers
function chatKey(a, b) {
  return [a, b].sort().join('|');
}

// Health
app.get('/health', (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'dev' }));

// Register username via REST (optional - client can also register via socket)
app.post('/api/register', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (users.has(username)) return res.status(409).json({ error: 'username_taken' });
  users.set(username, { username, socketId: null, createdAt: new Date().toISOString() });
  return res.json({ ok: true, username });
});

// List users (online/offline status)
app.get('/api/users', (req, res) => {
  const arr = Array.from(users.values()).map(u => ({ username: u.username, online: !!u.socketId }));
  return res.json(arr);
});

// Get chat history between two users
app.get('/api/chats/:a/:b', (req, res) => {
  const { a, b } = req.params;
  const key = chatKey(a, b);
  const msgs = chats.get(key) || [];
  return res.json({ chatKey: key, messages: msgs });
});

// Socket.IO real-time
io.on('connection', (socket) => {
  console.log('WS connected', socket.id);

  // Register username from client through socket
  socket.on('register', (username) => {
    if (!username) return;
    // create user if not exists
    const existing = users.get(username) || { username, socketId: null, createdAt: new Date().toISOString() };
    existing.socketId = socket.id;
    users.set(username, existing);
    socket.data.username = username;
    console.log(`User registered on socket: ${username} -> ${socket.id}`);
    // Broadcast users list (or a lighter presence update)
    io.emit('users', Array.from(users.keys()));
  });

  // Send message
  socket.on('sendMessage', ({ from, to, text }) => {
    if (!from || !to || !text) return;
    const id = uuidv4();
    const ts = new Date().toISOString();
    const key = chatKey(from, to);
    const msg = { id, from, to, text, ts };
    if (!chats.has(key)) chats.set(key, []);
    chats.get(key).push(msg);

    // Emit to sender (ack / echo)
    socket.emit('message', msg);

    // Emit to recipient if online
    const recipient = users.get(to);
    if (recipient && recipient.socketId) {
      io.to(recipient.socketId).emit('message', msg);
    }
  });

  socket.on('disconnect', () => {
    const username = socket.data.username;
    if (username) {
      const u = users.get(username);
      if (u && u.socketId === socket.id) {
        u.socketId = null;
        users.set(username, u);
      }
      io.emit('users', Array.from(users.keys()));
      console.log('WS disconnected', username);
    } else {
      console.log('WS disconnected (unregistered)', socket.id);
    }
  });

});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`CLIENT_ORIGIN=${CLIENT_ORIGIN}`);
});
