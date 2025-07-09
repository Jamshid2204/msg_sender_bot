const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: Number,
  groupId: Number,
  type: String,
  content: String,
  caption: String,
  sentAt: { type: Date, default: Date.now },
  telegramMessageId: Number // agar kerak bo‘lsa
});

module.exports = mongoose.model('SentMessage', schema);