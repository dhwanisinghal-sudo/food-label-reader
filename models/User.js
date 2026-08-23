/**
 * User.js
 * Mongoose model for a registered account. Passwords are never stored in
 * plain text — only a bcrypt hash. comparePassword() is the only way to
 * check a candidate password against the stored hash.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Hash the plain-text password before saving. Runs automatically on
// user.save() when the password field was set — controllers never see
// or store the raw password themselves.
userSchema.methods.setPassword = async function setPassword(plainPassword) {
  const SALT_ROUNDS = 12;
  this.passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
};

userSchema.methods.comparePassword = async function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

// Never leak the hash to the client, even by accident (e.g. res.json(user)).
userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
