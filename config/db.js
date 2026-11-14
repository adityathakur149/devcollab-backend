const mongoose = require('mongoose');

/**
 * Resilient Mongoose connection handler.
 * Connects to MongoDB if running, otherwise logs warning without crashing server.
 */
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/devcollab';
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 3000, // Timeout after 3s if MongoDB isn't reachable
    });
    console.log(`[MongoDB] Connected successfully to ${conn.connection.host}`);
  } catch (error) {
    console.warn(`[MongoDB Warning] Could not connect to local MongoDB (${error.message}).`);
    console.warn(`[MongoDB Warning] Server running in mock/fallback mode. Install or start MongoDB to enable persistence.`);
  }
};

module.exports = connectDB;
