/**
 * SyncCall — Main Server (updated with Whiteboard sync)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { router: authRouter, requireAuth } = require('./routes/auth');
const filesRouter = require('./routes/files');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'https://synccall-real-time-communication-app.onrender.com',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// ─── REST Routes ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRouter);
app.use('/files', filesRouter);

// ─── In-memory stores ────────────────────────────────────────────────────
const rooms          = new Map(); // roomId → Map<socketId, participant>
const whiteboardStore = new Map(); // roomId → base64 PNG snapshot

const JWT_SECRET = process.env.JWT_SECRET || 'synccall-secret-change-in-production';

// ─── Socket.io — verify JWT on connect ───────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// ─── Socket.io events ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.user.name} (${socket.id})`);
  let currentRoom = null;

  // ── JOIN ────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId }) => {
    currentRoom = roomId;
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    const participant = {
      socketId: socket.id,
      name: socket.user.name,
      avatar: socket.user.name.slice(0, 2).toUpperCase(),
      micOn: true,
      camOn: true,
    };

    room.set(socket.id, participant);
    socket.join(roomId);

    const others = [...room.values()].filter(p => p.socketId !== socket.id);
    socket.emit('room-state', { participants: others });
    socket.to(roomId).emit('peer-joined', { participant });

    // Send whiteboard snapshot to late joiners
    const snapshot = whiteboardStore.get(roomId);
    if (snapshot) socket.emit('whiteboard-state', { imageData: snapshot });
  });

  // ── WebRTC SIGNALING ────────────────────────────────────────────────
  socket.on('offer',         ({ targetId, offer })     => io.to(targetId).emit('offer',         { fromId: socket.id, offer }));
  socket.on('answer',        ({ targetId, answer })    => io.to(targetId).emit('answer',        { fromId: socket.id, answer }));
  socket.on('ice-candidate', ({ targetId, candidate }) => io.to(targetId).emit('ice-candidate', { fromId: socket.id, candidate }));

  // ── MEDIA STATE ─────────────────────────────────────────────────────
  socket.on('media-state', ({ micOn, camOn }) => {
    socket.to(currentRoom).emit('peer-media-state', { fromId: socket.id, micOn, camOn });
  });

  // ── CHAT ────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ text }) => {
    io.to(currentRoom).emit('chat-message', {
      fromId: socket.id,
      name: socket.user.name,
      text,
      ts: Date.now(),
    });
  });

  // ── FILE SHARING ────────────────────────────────────────────────────
  socket.on('share-file', ({ roomId, meta }) => {
    socket.to(roomId).emit('file-shared', meta);
  });

  // ── WHITEBOARD ──────────────────────────────────────────────────────
  socket.on('whiteboard-draw', ({ roomId, data }) => {
    socket.to(roomId).emit('whiteboard-draw', { data });
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    whiteboardStore.delete(roomId);
    socket.to(roomId).emit('whiteboard-clear');
  });

  // Peer saves a snapshot so late-joiners can catch up
  socket.on('whiteboard-snapshot', ({ roomId, imageData }) => {
    whiteboardStore.set(roomId, imageData);
  });

  // ── DISCONNECT ──────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) rooms.delete(currentRoom);
    }
    socket.to(currentRoom).emit('peer-left', { socketId: socket.id });
    console.log(`[disconnect] ${socket.user?.name} left ${currentRoom}`);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`SyncCall server running on port ${PORT}`));