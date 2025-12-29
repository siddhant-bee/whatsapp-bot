const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
  from: String,
  message: String,
  direction: String,
  time: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Chat", chatSchema);
