// server.js
// Demo server: Express + Socket.IO
// npm i express socket.io cors body-parser uuid

const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// In-memory stores (demo). Use Postgres/Mongo in prod.
const users = {}; // tag -> { tag, pubKey, socketId, createdAt }
const messages = {}; // convId -> [ { id, from, to, ciphertext, iv, ts } ]

// Helper: conversation id by tags (deterministic)
function convId(a, b) {
  return [a, b].sort().join('::');
}

// Register user public key
app.post('/api/register', (req, res) => {
  const { tag, pubKey } = req.body;
  if (!tag || !pubKey) return res.status(400).json({ error: 'tag and pubKey required' });
  if (users[tag]) return res.status(409).json({ error: 'tag_taken' });
  users[tag] = { tag, pubKey, socketId: null, createdAt: new Date().toISOString() };
  console.log('Registered', tag);
  return res.json({ ok: true });
});

// Get user public key by tag
app.get('/api/users/:tag', (req, res) => {
  const tag = req.params.tag;
  const u = users[tag];
  if (!u) return res.status(404).json({ error: 'not_found' });
  return res.json({ tag: u.tag, pubKey: u.pubKey, createdAt: u.createdAt });
});

// Get simple list (demo)
app.get('/api/users', (req, res) => {
  return res.json(Object.values(users).map(u => ({ tag: u.tag, createdAt: u.createdAt })));
});

// socket.io
io.on('connection', (socket) => {
  console.log('ws connect', socket.id);

  socket.on('register_socket', ({ tag }) => {
    if (users[tag]) {
      users[tag].socketId = socket.id;
      console.log('Socket registered for', tag);
    } else {
      // Optionally auto-register minimal user (no pubKey) - demo
      users[tag] = { tag, pubKey: null, socketId: socket.id, createdAt: new Date().toISOString() };
      console.log('Auto-created user for socket', tag);
    }
  });

  socket.on('send_message', (payload, cb) => {
    // payload: { from, to, ciphertext, iv, ts, messageId }
    const { from, to, ciphertext, iv, ts, messageId } = payload;
    if (!from || !to || !ciphertext || !iv) {
      if (cb) cb({ ok: false, error: 'invalid' });
      return;
    }
    const id = messageId || uuidv4();
    const cId = convId(from, to);
    messages[cId] = messages[cId] || [];
    const msg = { id, from, to, ciphertext, iv, ts: ts || new Date().toISOString() };
    messages[cId].push(msg);
    // try deliver
    const recipient = users[to];
    if (recipient && recipient.socketId) {
      io.to(recipient.socketId).emit('message', { chatId: cId, ...msg });
    }
    // ack to sender
    if (cb) cb({ ok: true, messageId: id });
  });

  socket.on('disconnect', () => {
    // cleanup socketId mapping
    for (const t in users) {
      if (users[t].socketId === socket.id) users[t].socketId = null;
    }
    console.log('ws disconnect', socket.id);
  });
});

const port = process.env.PORT || 3001;
server.listen(port, () => console.log('Server listening on', port));
