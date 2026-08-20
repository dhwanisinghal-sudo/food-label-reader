/**
 * db.js
 * Connects to MongoDB Atlas using MONGODB_URI from .env.
 *
 * Designed to degrade gracefully: if MONGODB_URI isn't set, or the
 * connection fails, the app should keep working exactly as before —
 * scans just won't be saved to history. This matches how the rest of
 * the app handles missing config (HF_TOKEN, OpenFoodFacts failures, etc).
 */

const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn('MONGODB_URI not set — scan history will not be saved. Add it to .env to enable.');
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
    });
    isConnected = true;
    console.log('MongoDB connected.');
    return true;
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    console.warn('Continuing without database — scan history will not be saved.');
    isConnected = false;
    return false;
  }
}

function isDbConnected() {
  return isConnected;
}

module.exports = { connectDB, isDbConnected };
