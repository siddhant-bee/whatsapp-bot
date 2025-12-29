const mongoose = require("mongoose");
const moment = require("moment-timezone");

const chatSchema = new mongoose.Schema({
  from: String,
  message: String,
  direction: String,

  createdAt: {
    type: Date,
    default: () => moment().tz("Asia/Kolkata").toDate()
  }
});

module.exports = mongoose.model("Chat", chatSchema);
