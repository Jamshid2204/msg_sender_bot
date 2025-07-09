require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const connectDB = require('./db');
const Group = require('./models/Group');
const User = require('./models/User');
const SentMessage = require('./models/SentMessage');

connectDB();

const token = process.env.BOT_TOKEN;
const ownerIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',') : [];

const bot = new TelegramBot(token, { polling: true });

async function getGroupList() {
  return await Group.find({});
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.from) {
    await User.updateOne(
      { id: msg.from.id },
      {
        $set: {
          username: msg.from.username,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          is_bot: msg.from.is_bot
        }
      },
      { upsert: true }
    );
  }

  if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
    const exists = await Group.findOne({ id: chatId });
    if (!exists) {
      await new Group({ id: chatId, name: msg.chat.title }).save();
      console.log(`➕ Yangi guruh: ${msg.chat.title} (${chatId})`);
    }
    return;
  }

  if (msg.chat.type === 'private' && !ownerIds.includes(String(userId))) {
    return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
  }

  if (msg.text === '/start') {
    const keyboard = {
      keyboard: [
        [{ text: "Guruhlar ro'yxati" }],
        [{ text: "Oxirgi xabarni o'chirish" }]
      ],
      resize_keyboard: true
    };
    return bot.sendMessage(chatId, 'Botga xush kelibsiz!', { reply_markup: keyboard });
  }

  if (msg.text === "Guruhlar ro'yxati") {
    const groups = await getGroupList();
    if (!groups.length) return bot.sendMessage(chatId, "Bot hech qanday guruhga qo'shilmagan.");
    const list = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
    return bot.sendMessage(chatId, `📋 Guruhlar:\n${list}`);
  }

  if (msg.text === "Oxirgi xabarni o'chirish") {
    const groups = await getGroupList();
    let deleted = 0;
    for (const group of groups) {
      const lastMsg = await SentMessage.findOne({ groupId: group.id }).sort({ sentAt: -1 });
      if (lastMsg) {
        try {
          await bot.deleteMessage(group.id, lastMsg.telegramMessageId);
          deleted++;
        } catch {}
      }
    }
    return bot.sendMessage(chatId, `${deleted} ta xabar o‘chirildi.`);
  }

  const content = {};
  if (msg.text && !msg.text.startsWith('/')) {
    content.type = 'text';
    content.data = msg.text;
  } else if (msg.photo) {
    content.type = 'photo';
    content.data = msg.photo[msg.photo.length - 1].file_id;
    content.caption = msg.caption || '';
  } else if (msg.video) {
    content.type = 'video';
    content.data = msg.video.file_id;
    content.caption = msg.caption || '';
  } else return;

  const groups = await getGroupList();
  let count = 0;

  for (const group of groups) {
    try {
      let sent;
      if (content.type === 'text') {
        sent = await bot.sendMessage(group.id, content.data);
      } else if (content.type === 'photo') {
        sent = await bot.sendPhoto(group.id, content.data, { caption: content.caption });
      } else if (content.type === 'video') {
        sent = await bot.sendVideo(group.id, content.data, { caption: content.caption });
      }

      if (sent) {
        await SentMessage.create({
          userId,
          groupId: group.id,
          type: content.type,
          content: content.data,
          caption: content.caption || null,
          sentAt: new Date(),
          telegramMessageId: sent.message_id
        });
        count++;
      }
    } catch (e) {
      console.error(`Xatolik:`, e.message);
    }
  }

  return bot.sendMessage(chatId, `✅ ${count} ta guruhga yuborildi.`);
});
