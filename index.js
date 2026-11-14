const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { initializeSocket } = require('./socket/socketHandler');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS config
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per windowMs
  message: { message: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 executions per minute
  message: { message: 'Too many code executions, please wait a moment' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Routes
app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));

// Apply specific rate limiting to execute endpoint
app.use('/api/projects/execute', executeLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'DevCollab API',
    timestamp: new Date().toISOString(),
    socketIO: 'active',
  });
});

const PORT = process.env.PORT || 5000;

// Connect to MongoDB, initialize Socket.IO, and start server
const startServer = async () => {
  try {
    await connectDB();

    // Initialize Socket.IO event handling
    initializeSocket(io);

    server.listen(PORT, () => {
      console.log(`🚀 [DevCollab Server] Listening on http://localhost:${PORT}`);
      console.log(`⚡ [Socket.IO] Real-time collaboration engine active`);
    });
  } catch (err) {
    console.error(`[Server Start Error]: ${err.message}`);
  }
};

startServer();
