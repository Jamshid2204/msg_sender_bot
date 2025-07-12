require('dotenv').config();
const TelegramBot  = require('node-telegram-bot-api');
const mongoose     = require('mongoose');
const connectDB    = require('./db');
const Group        = require('./models/Group');
const User         = require('./models/User');
const SentMessage  = require('./models/SentMessage');

connectDB();

const token    = process.env.BOT_TOKEN;
const ownerIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',') : [];

const bot = new TelegramBot(token, { polling: true });

let BOT_ID = null;
bot.getMe()
  .then(me => {
    BOT_ID = me.id;
    console.log(`🤖 Bot started as @${me.username} (ID: ${BOT_ID})`);
  })
  .catch(err => console.error('❌ Bot ID olishda xato:', err.message));

const getGroupList = () => Group.find({});

// Media group'lar uchun vaqtinchalik saqlovchilar
const mediaGroups = {};
const mediaTimers = {};

bot.on('message', async (msg) => {
  const { chat, from, media_group_id } = msg;
  const chatId = chat.id;
  const userId = from?.id;

  if (chat.type === 'group' || chat.type === 'supergroup') return;

  if (!ownerIds.includes(String(userId))) {
    return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
  }

  await User.updateOne(
    { id: userId },
    { $set: {
        username: from.username,
        first_name: from.first_name,
        last_name: from.last_name,
        is_bot: from.is_bot
      }},
    { upsert: true }
  );

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
    const list = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
    return bot.sendMessage(chatId, `📋 Guruhlar:\n${list}`);
  }

  if (msg.text === "Oxirgi xabarni o'chirish") {
    const groups = await getGroupList();
    let deleted = 0;
    for (const g of groups) {
      const last = await SentMessage.findOne({ groupId: g.id }).sort({ sentAt: -1 });
      if (last) {
        try {
          await bot.deleteMessage(g.id, last.telegramMessageId);
          deleted++;
        } catch {}
      }
    }
    return bot.sendMessage(chatId, `${deleted} ta xabar o‘chirildi.`);
  }

  // --- Media Group (Abolm) yuborilganda
  if (media_group_id && (msg.photo || msg.video)) {
    if (!mediaGroups[media_group_id]) mediaGroups[media_group_id] = [];

    const mediaItem = msg.photo
      ? { type: 'photo', media: msg.photo.at(-1).file_id, caption: msg.caption || '', parse_mode: 'HTML' }
      : { type: 'video', media: msg.video.file_id, caption: msg.caption || '', parse_mode: 'HTML' };

    mediaGroups[media_group_id].push(mediaItem);

    clearTimeout(mediaTimers[media_group_id]);
    mediaTimers[media_group_id] = setTimeout(async () => {
      const mediaItems = mediaGroups[media_group_id];
      delete mediaGroups[media_group_id];
      delete mediaTimers[media_group_id];

      const groups = await getGroupList();
      const sentGroups = [];

      for (const g of groups) {
        try {
          const mem = await bot.getChatMember(g.id, BOT_ID).catch(() => null);
          const isAdmin = mem?.status === 'administrator' || mem?.status === 'creator';

          if (!isAdmin) {
            for (const ownerId of ownerIds) {
              await bot.sendMessage(ownerId, `⚠️ Bot admin emas:\n📛 ${g.name}\n`);
            }
            continue;
          }

          const tgMsg = await bot.sendMediaGroup(g.id, mediaItems);
          if (tgMsg?.length) {
            sentGroups.push(g.name || g.id);
            for (const item of tgMsg) {
              await SentMessage.create({
                userId,
                groupId: g.id,
                type: item.photo ? 'photo' : 'video',
                content: item.photo ? item.photo.at(-1).file_id : item.video.file_id,
                caption: item.caption || null,
                telegramMessageId: item.message_id,
                sentAt: new Date()
              });
            }
          }
        } catch (e) {
          console.error(`Xatolik (${g?.id || 'unknown'}):`, e.message);
        }
      }

      const resultTxt = sentGroups.length
        ? '\n\n' + sentGroups.map((n, i) => `${i + 1}. ${n}`).join('\n')
        : '\n\n⚠️ Hech bir guruhga yuborilmadi';
      bot.sendMessage(chatId, `✅ ${sentGroups.length} ta guruhga yuborildi.${resultTxt}`);
    }, 1500);

    return;
  }

  // --- Oddiy text / photo / video (albom emas)
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

  const groups     = await getGroupList();
  const sentGroups = [];

  for (const g of groups) {
    try {
      const mem = await bot.getChatMember(g.id, BOT_ID).catch(() => null);
      const isAdmin = mem?.status === 'administrator' || mem?.status === 'creator';

      if (!isAdmin) {
        for (const ownerId of ownerIds) {
          await bot.sendMessage(ownerId, `⚠️ Bot admin emas:\n📛 ${g.name}\n`);
        }
        continue;
      }

      let tgMsg;
      if (content.type === 'text')
        tgMsg = await bot.sendMessage(g.id, content.data);
      else if (content.type === 'photo')
        tgMsg = await bot.sendPhoto(g.id, content.data, { caption: content.caption });
      else if (content.type === 'video')
        tgMsg = await bot.sendVideo(g.id, content.data, { caption: content.caption });

      if (tgMsg) {
        sentGroups.push(g.name || g.id);
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

  const resultTxt = sentGroups.length
    ? '\n\n' + sentGroups.map((n, i) => `${i + 1}. ${n}`).join('\n')
    : '\n\n⚠️ Hech bir guruhga yuborilmadi';
  bot.sendMessage(chatId, `✅ ${sentGroups.length} ta guruhga yuborildi.${resultTxt}`);
});

// Guruhga qo‘shilish yoki chiqarish
bot.on('my_chat_member', async (update) => {
  const { chat, new_chat_member } = update;
  const status = new_chat_member.status;

  if (chat.type !== 'group' && chat.type !== 'supergroup') return;

  if (['member', 'administrator', 'creator'].includes(status)) {
    if (!(await Group.exists({ id: chat.id }))) {
      await Group.create({ id: chat.id, name: chat.title || 'No name' });
      console.log(`➕ Bot guruhga qo‘shildi: ${chat.title} (${chat.id})`);
    }
  } else if (['left', 'kicked'].includes(status)) {
    await Group.deleteOne({ id: chat.id });
    console.log(`❌ Bot guruhdan chiqarildi va DB dan o‘chirildi: ${chat.title} (${chat.id})`);
  }
});
