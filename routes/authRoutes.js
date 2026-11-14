const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// In-memory fallback store for dev testing when MongoDB is offline
const inMemoryUsers = [];

/**
 * Generate a JSON Web Token valid for 30 days
 */
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'devcollab_super_secret_jwt_key_2026_aditya',
    { expiresIn: '30d' }
  );
};

/**
 * Helper to check if MongoDB is active (readyState === 1)
 */
const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user account
 * @access  Public
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Please provide username, email, and password' });
    }

    if (isDbConnected()) {
      // Live MongoDB database operations
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }

      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        return res.status(400).json({ message: 'Username is already taken' });
      }

      const user = await User.create({ username, email, password });

      return res.status(201).json({
        token: generateToken(user._id),
        user: {
          _id: user._id,
          username: user.username,
          email: user.email,
          avatarColor: user.avatarColor,
        },
      });
    } else {
      // In-Memory Dev Fallback (when local MongoDB service is not running)
      const existing = inMemoryUsers.find((u) => u.email === email || u.username === username);
      if (existing) {
        return res.status(400).json({ message: 'User already exists (in-memory mode)' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        _id: `mem_${Date.now()}`,
        username,
        email,
        password: hashedPassword,
        avatarColor: '#3b82f6',
      };

      inMemoryUsers.push(newUser);

      return res.status(201).json({
        token: generateToken(newUser._id),
        user: {
          _id: newUser._id,
          username: newUser.username,
          email: newUser.email,
          avatarColor: newUser.avatarColor,
        },
        devNote: 'Registered in dev fallback mode (MongoDB offline)',
      });
    }
  } catch (error) {
    console.error('[Register Error]:', error.message);
    res.status(500).json({ message: 'Server error during registration', error: error.message });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get JWT token
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    if (isDbConnected()) {
      const user = await User.findOne({ email });
      if (user && (await user.matchPassword(password))) {
        return res.json({
          token: generateToken(user._id),
          user: {
            _id: user._id,
            username: user.username,
            email: user.email,
            avatarColor: user.avatarColor,
          },
        });
      }
      return res.status(401).json({ message: 'Invalid email or password' });
    } else {
      // In-Memory Dev Fallback
      const user = inMemoryUsers.find((u) => u.email === email);
      if (user && (await bcrypt.compare(password, user.password))) {
        return res.json({
          token: generateToken(user._id),
          user: {
            _id: user._id,
            username: user.username,
            email: user.email,
            avatarColor: user.avatarColor,
          },
          devNote: 'Logged in dev fallback mode (MongoDB offline)',
        });
      }
      return res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('[Login Error]:', error.message);
    res.status(500).json({ message: 'Server error during login', error: error.message });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get authenticated user profile
 * @access  Private
 */
router.get('/me', protect, async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    console.error('[Get Profile Error]:', error.message);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

module.exports = router;
