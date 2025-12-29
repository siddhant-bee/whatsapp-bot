const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    from: String,
    message: String,
    direction: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", chatSchema);
