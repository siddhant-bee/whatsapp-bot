const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    phone: { type: String, unique: true },
    firstSeen: { type: Date, default: Date.now },
    lastMessageAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
