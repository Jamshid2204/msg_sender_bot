require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const connectDB = require('./db');
const Group = require('./models/Group');
const User = require('./models/User');
const SentMessage = require('./models/SentMessage');

connectDB();

const token     = process.env.BOT_TOKEN;
const ownerIds  = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',') : [];

const bot = new TelegramBot(token, { polling: true });

let BOT_ID = null;
bot.getMe()
  .then(me => {
    BOT_ID = me.id;
    console.log(`🤖 Bot started as @${me.username} (ID: ${BOT_ID})`);
  })
  .catch(err => console.error('Bot ID ni olishda xato:', err.message));

const getGroupList = () => Group.find({});

// ===================== MESSAGE HANDLER =====================
bot.on('message', async (msg) => {
  const { chat, from } = msg;
  const chatId = chat.id;
  const userId = from?.id;

  /* 1) Foydalanuvchini saqlash */
  if (from) {
    await User.updateOne(
      { id: userId },
      {
        $set: {
          username:   from.username,
          first_name: from.first_name,
          last_name:  from.last_name,
          is_bot:     from.is_bot
        }
      },
      { upsert: true }
    );
  }

  /* 2) Guruhni DB ga qo‘shish */
  if (chat.type === 'group' || chat.type === 'supergroup') {
    if (!(await Group.exists({ id: chatId }))) {
      await Group.create({ id: chatId, name: chat.title || 'No name' });
      console.log(`➕ Yangi guruh: ${chat.title || 'No name'} (${chatId})`);
    }
    return;                              // Guruhdagi oddiy xabarlarni qayta ishlamaymiz
  }

  /* 3) Egasi bo‘lmasa — rad */
  if (!ownerIds.includes(String(userId))) {
    return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
  }

  /* 4) /start, “Guruhlar ro'yxati”, “Oxirgi xabarni o'chirish” */
  if (msg.text === '/start') {
    return bot.sendMessage(chatId, 'Botga xush kelibsiz!', {
      reply_markup: {
        keyboard: [
          [{ text: "Guruhlar ro'yxati" }],
          [{ text: "Oxirgi xabarni o'chirish" }]
        ],
        resize_keyboard: true
      }
    });
  }
  if (msg.text === "Guruhlar ro'yxati") {
    const groups = await getGroupList();
    if (!groups.length) return bot.sendMessage(chatId, "Bot hech qanday guruhga qo'shilmagan.");
    const list = groups.map((g,i)=>`${i+1}. ${g.name}`).join('\n');
    return bot.sendMessage(chatId, `📋 Guruhlar:\n${list}`);
  }
  if (msg.text === "Oxirgi xabarni o'chirish") {
    const groups = await getGroupList();
    let deleted = 0;
    for (const g of groups) {
      const last = await SentMessage.findOne({ groupId: g.id }).sort({ sentAt: -1 });
      if (last) {
        try { await bot.deleteMessage(g.id, last.telegramMessageId); deleted++; } catch {}
      }
    }
    return bot.sendMessage(chatId, `${deleted} ta xabar o‘chirildi.`);
  }

  /* 5) Kontentni aniqlash */
  const content = {};
  if (msg.text && !msg.text.startsWith('/')) {
    content.type = 'text';  content.data = msg.text;
  } else if (msg.photo) {
    content.type = 'photo'; content.data = msg.photo.at(-1).file_id;
    content.caption = msg.caption || '';
  } else if (msg.video) {
    content.type = 'video'; content.data = msg.video.file_id;
    content.caption = msg.caption || '';
  } else return;

  /* 6) Barcha guruhlarga yuborish */
  const groups       = await getGroupList();
  const sentGroups   = [];     // ← Muvaffaqiyatli guruҳlar ro‘yxati
  let   sentCount    = 0;

  for (const g of groups) {
    try {
      if (!BOT_ID) continue;   // getMe tugamagan bo‘lishi mumkin

      const mem = await bot.getChatMember(g.id, BOT_ID).catch(()=>null);
      const isAdmin = mem?.status === 'administrator' || mem?.status === 'creator';

      if (!isAdmin) {
        // Guruhga yozmaslik, faqat owner(lar)ga ogohlantirish
        for (const ownerId of ownerIds) {
          await bot.sendMessage(ownerId,
            `⚠️ Bot admin emas:\n📛 ${g.name}\n`);
        }
        continue;
      }

      // ------- Xabar yuborish -------
      let tgMsg;
      if (content.type === 'text')
        tgMsg = await bot.sendMessage(g.id, content.data);
      else if (content.type === 'photo')
        tgMsg = await bot.sendPhoto(g.id, content.data, { caption: content.caption });
      else if (content.type === 'video')
        tgMsg = await bot.sendVideo(g.id, content.data, { caption: content.caption });

      if (tgMsg) {
        sentCount++;
        sentGroups.push(g.name || g.id);   // nom bo‘lmasa ID
        await SentMessage.create({
          userId,
          groupId: g.id,
          type: content.type,
          content: content.data,
          caption: content.caption || null,
          telegramMessageId: tgMsg.message_id,
          sentAt: new Date()
        });
      }
    } catch (e) {
      console.error(`Xatolik (${g?.id || 'unknown'}):`, e.message);
    }
  }

  /* 7) Natijani egaga yuborish */
  const listText = sentGroups.length
      ? '\n' + sentGroups.map((n,i)=>`${i+1}. ${n}`).join('\n')
      : '\n\n⚠️ Hech bir guruhga yuborilmadi';
  bot.sendMessage(chatId, `✅ ${sentCount} ta guruhga yuborildi.${listText}`);
});

/* 8) Bot guruhdan chiqsa — DB dan o‘chirish */
bot.on('my_chat_member', async (u) => {
  const { chat, new_chat_member } = u;
  const status = new_chat_member.status;

  if ((chat.type==='group'||chat.type==='supergroup') &&
      (status==='kicked' || status==='left')) {
    await Group.deleteOne({ id: chat.id });
    console.log(`❌ Guruh bazadan o‘chirildi: ${chat.title} (${chat.id})`);
  }
});
