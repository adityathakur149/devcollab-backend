const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');

// In-memory fallback store for dev testing when MongoDB is offline
const inMemoryProjects = [];

/**
 * Track active users per room: Map<roomId, Map<socketId, userInfo>>
 */
const activeRooms = new Map();

/**
 * In-memory chat history per room: Map<roomId, Array<messageObj>>
 * Stores last 100 messages per room. Not persisted to DB.
 */
const roomMessages = new Map();
const MAX_MESSAGES_PER_ROOM = 100;

/**
 * Initialize Socket.IO event handling
 * @param {import('socket.io').Server} io
 */
const initializeSocket = (io) => {
  // Middleware: authenticate socket connections via JWT
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'devcollab_super_secret_jwt_key_2026_aditya'
      );

      if (mongoose.connection.readyState === 1) {
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
          return next(new Error('Authentication error: User not found'));
        }
        socket.user = {
          _id: user._id.toString(),
          username: user.username,
          email: user.email,
          avatarColor: user.avatarColor,
        };
      } else {
        // Fallback for dev mode
        socket.user = {
          _id: decoded.id,
          username: 'DevUser',
          email: 'dev@collab.com',
          avatarColor: '#3b82f6',
        };
      }

      next();
    } catch (error) {
      console.error('[Socket Auth Error]:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`⚡ [Socket] ${socket.user.username} connected (${socket.id})`);

    /**
     * Event: join-room
     * User joins a project room for collaboration
     */
    socket.on('join-room', async (roomId) => {
      try {
        socket.join(roomId);

        // Track user in active rooms
        if (!activeRooms.has(roomId)) {
          activeRooms.set(roomId, new Map());
        }
        activeRooms.get(roomId).set(socket.id, {
          ...socket.user,
          socketId: socket.id,
          joinedAt: new Date().toISOString(),
        });

        // Get current code from DB if available
        let currentCode = null;
        let projectLanguage = 'javascript';
        let dbMessages = [];

        if (mongoose.connection.readyState === 1) {
          const project = await Project.findOne({ roomId });
          if (project) {
            currentCode = project.code;
            projectLanguage = project.language;
            dbMessages = project.messages || [];
          }
        } else {
          // Load from in-memory fallback
          const project = inMemoryProjects.find((p) => p.roomId === roomId);
          if (project) {
            currentCode = project.code;
            projectLanguage = project.language;
            dbMessages = project.messages || [];
          }
        }

        // Get chat history for this room (combine in-memory + DB)
        const memoryMessages = roomMessages.get(roomId) || [];
        // Merge messages, preferring DB messages as base
        const allMessages = [...dbMessages, ...memoryMessages];
        // Deduplicate by ID and sort by timestamp
        const uniqueMessages = Array.from(
          new Map(allMessages.map((m) => [m.id, m])).values()
        ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        // Cap at MAX_MESSAGES_PER_ROOM
        const messages = uniqueMessages.slice(-MAX_MESSAGES_PER_ROOM);

        // Send current state to the joining user
        socket.emit('room-joined', {
          roomId,
          users: Array.from(activeRooms.get(roomId).values()),
          code: currentCode,
          language: projectLanguage,
          messages,
        });

        // Notify others in the room
        socket.to(roomId).emit('user-joined', {
          user: socket.user,
          users: Array.from(activeRooms.get(roomId).values()),
        });

        console.log(`📌 [Socket] ${socket.user.username} joined room: ${roomId}`);
      } catch (error) {
        console.error('[Socket join-room Error]:', error.message);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    /**
     * Event: code-change
     * Broadcast code edits to all room members except sender
     */
    socket.on('code-change', async ({ roomId, code, changes }) => {
      try {
        // Broadcast to other users in the room
        socket.to(roomId).emit('code-update', {
          code,
          changes,
          user: socket.user,
        });

        // Persist code to DB (debounced — only save periodically)
        if (mongoose.connection.readyState === 1) {
          await Project.findOneAndUpdate(
            { roomId },
            { code, lastEditedBy: socket.user._id },
            { new: true }
          );
        } else {
          // Save to in-memory fallback
          const projectIdx = inMemoryProjects.findIndex((p) => p.roomId === roomId);
          if (projectIdx !== -1) {
            inMemoryProjects[projectIdx].code = code;
            inMemoryProjects[projectIdx].lastEditedBy = socket.user._id;
            inMemoryProjects[projectIdx].updatedAt = new Date().toISOString();
          }
        }
      } catch (error) {
        console.error('[Socket code-change Error]:', error.message);
      }
    });

    /**
     * Event: cursor-move
     * Broadcast cursor position and selection to other users
     */
    socket.on('cursor-move', ({ roomId, cursor }) => {
      socket.to(roomId).emit('cursor-update', {
        user: socket.user,
        cursor, // { lineNumber, column, selection? }
      });
    });

    /**
     * Event: language-change
     * Broadcast language change to all room members
     */
    socket.on('language-change', async ({ roomId, language }) => {
      try {
        socket.to(roomId).emit('language-update', { language, user: socket.user });

        if (mongoose.connection.readyState === 1) {
          await Project.findOneAndUpdate({ roomId }, { language });
        } else {
          // Save to in-memory fallback
          const projectIdx = inMemoryProjects.findIndex((p) => p.roomId === roomId);
          if (projectIdx !== -1) {
            inMemoryProjects[projectIdx].language = language;
            inMemoryProjects[projectIdx].updatedAt = new Date().toISOString();
          }
        }
      } catch (error) {
        console.error('[Socket language-change Error]:', error.message);
      }
    });

    /**
     * Event: chat-message
     * Receive a chat message and broadcast to everyone in the room
     */
    socket.on('chat-message', ({ roomId, text }) => {
      if (!text || !text.trim()) return;

      const message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        user: {
          _id: socket.user._id,
          username: socket.user.username,
          avatarColor: socket.user.avatarColor,
        },
        text: text.trim(),
        timestamp: new Date().toISOString(),
      };

      // Store in room history
      if (!roomMessages.has(roomId)) {
        roomMessages.set(roomId, []);
      }
      const messages = roomMessages.get(roomId);
      messages.push(message);

      // Cap at MAX_MESSAGES_PER_ROOM
      if (messages.length > MAX_MESSAGES_PER_ROOM) {
        messages.splice(0, messages.length - MAX_MESSAGES_PER_ROOM);
      }

      // Persist message to DB if connected, otherwise to in-memory fallback
      if (mongoose.connection.readyState === 1) {
        Project.findOneAndUpdate(
          { roomId },
          { $push: { messages: { $each: [message], $slice: -MAX_MESSAGES_PER_ROOM } } }
        ).catch((err) => console.error('[DB Chat Save Error]:', err.message));
      } else {
        // Save to in-memory project store
        const projectIdx = inMemoryProjects.findIndex((p) => p.roomId === roomId);
        if (projectIdx !== -1) {
          if (!inMemoryProjects[projectIdx].messages) {
            inMemoryProjects[projectIdx].messages = [];
          }
          inMemoryProjects[projectIdx].messages.push(message);
          // Cap at MAX_MESSAGES_PER_ROOM
          if (inMemoryProjects[projectIdx].messages.length > MAX_MESSAGES_PER_ROOM) {
            inMemoryProjects[projectIdx].messages = inMemoryProjects[projectIdx].messages.slice(-MAX_MESSAGES_PER_ROOM);
          }
        }
      }

      // Broadcast to everyone in the room (including sender)
      io.to(roomId).emit('chat-update', message);

      console.log(`💬 [Chat] ${socket.user.username} in ${roomId}: ${text.trim().substring(0, 50)}`);
    });

    /**
     * Event: leave-room
     * User explicitly leaves a room
     */
    socket.on('leave-room', (roomId) => {
      handleLeaveRoom(socket, roomId, io);
    });

    /**
     * Event: disconnect
     * Clean up user from all active rooms
     */
    socket.on('disconnect', () => {
      console.log(`💤 [Socket] ${socket.user.username} disconnected (${socket.id})`);

      // Remove user from all rooms they were in
      for (const [roomId, users] of activeRooms.entries()) {
        if (users.has(socket.id)) {
          handleLeaveRoom(socket, roomId, io);
        }
      }
    });
  });
};

/**
 * Remove a user from a room and notify remaining users
 */
function handleLeaveRoom(socket, roomId, io) {
  socket.leave(roomId);

  const room = activeRooms.get(roomId);
  if (room) {
    room.delete(socket.id);

    if (room.size === 0) {
      activeRooms.delete(roomId);
      // Clean up chat history when room empties
      roomMessages.delete(roomId);
    } else {
      // Notify remaining users
      io.to(roomId).emit('user-left', {
        user: socket.user,
        users: Array.from(room.values()),
      });
    }
  }

  console.log(`📌 [Socket] ${socket.user.username} left room: ${roomId}`);
}

module.exports = { initializeSocket };
