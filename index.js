require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const GROUPS_FILE = 'groups.json';
const LAST_MESSAGES_FILE = 'last_messages.json';

// Укажите токен вашего бота
const token = process.env.BOT_TOKEN;
// const token = '5911571118:AAGfHbn-mySxkNrb0G7jc7fvJr60w-LN9mk';

// Создайте экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// Load group info from file if it exists
let groupIds = [];
if (fs.existsSync(GROUPS_FILE)) {
    try {
        groupIds = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    } catch (e) {
        console.error('Failed to load group IDs:', e);
        groupIds = [];
    }
}

// Load last messages from file if it exists
let lastMessages = {};
if (fs.existsSync(LAST_MESSAGES_FILE)) {
    try {
        lastMessages = JSON.parse(fs.readFileSync(LAST_MESSAGES_FILE, 'utf8'));
    } catch (e) {
        console.error('Failed to load last messages:', e);
        lastMessages = {};
    }
}

// Слушаем события, когда бот добавляется в группу
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Handle /start command only in private chat
    if (msg.text === '/start' && msg.chat.type === 'private') {
        const keyboard = {
            keyboard: [[{ text: "Guruhlar ro'yxati" }]],
            resize_keyboard: true,
            one_time_keyboard: false
        };
        await bot.sendMessage(chatId, 'botga xush kelibsiz', { reply_markup: keyboard });
    }

    // Handle group list button in private chat
    if (msg.chat.type === 'private' && msg.text === "Guruhlar ro'yxati") {
        if (groupIds.length === 0) {
            await bot.sendMessage(chatId, "Bot hech qanday guruhga qo'shilmagan.");
        } else {
            const groupList = groupIds.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
            await bot.sendMessage(chatId, `Bot quyidagi guruhlarga qo'shilgan:\n${groupList}`);
        }
        return;
    }

    // Track group IDs and names
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        if (!groupIds.some(g => g.id === chatId)) {
            groupIds.push({ id: chatId, name: msg.chat.title || 'No name' });
            // Save groupIds to file here
            fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupIds, null, 2));
        }
    }

    // Handle private messages (text, photo, video)
    if (msg.chat.type === 'private' && msg.text !== '/start') {
        if (groupIds.length === 0) {
            await bot.sendMessage(chatId, "Bot hech qanday guruhga qo'shilmagan.");
            return;
        }

        let sentToGroups = 0;
        let lastSentMsg = null;
        // Handle photo
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1].file_id; // largest size
            const caption = msg.caption || '';
            for (const group of groupIds) {
                try {
                    const sentMsg = await bot.sendPhoto(group.id, photo, { caption });
                    lastMessages[group.id] = sentMsg.message_id;
                    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
                    sentToGroups++;
                } catch (err) {
                    console.error(`Failed to send photo to group ${group.id}:`, err.message);
                }
            }
            await bot.sendMessage(chatId, `Sizning fotosuratingiz ${sentToGroups} ta guruhga yuborildi.`);
            return;
        }
        // Handle video
        if (msg.video) {
            const video = msg.video.file_id;
            const caption = msg.caption || '';
            for (const group of groupIds) {
                try {
                    const sentMsg = await bot.sendVideo(group.id, video, { caption });
                    lastMessages[group.id] = sentMsg.message_id;
                    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
                    sentToGroups++;
                } catch (err) {
                    console.error(`Failed to send video to group ${group.id}:`, err.message);
                }
            }
            await bot.sendMessage(chatId, `Sizning videongiz ${sentToGroups} ta guruhga yuborildi.`);
            return;
        }
        // Handle text (default)
        if (msg.text) {
            const text = msg.text;
            for (const group of groupIds) {
                try {
                    const sentMsg = await bot.sendMessage(group.id, text);
                    lastMessages[group.id] = sentMsg.message_id;
                    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
                    sentToGroups++;
                } catch (err) {
                    console.error(`Failed to send to group ${group.id}:`, err.message);
                }
            }
            await bot.sendMessage(chatId, 'Sizning xabaringiz guruhlarga yuborildi.');
            return;
        }
    }

    // Handle /delete_last command in private chat
    if (msg.chat.type === 'private' && msg.text === '/delete_last') {
        let deletedCount = 0;
        for (const group of groupIds) {
            const groupId = group.id;
            const messageId = lastMessages[groupId];
            if (messageId) {
                try {
                    await bot.deleteMessage(groupId, messageId);
                    deletedCount++;
                } catch (err) {
                    console.error(`Failed to delete message in group ${groupId}:`, err.message);
                }
            }
        }
        await bot.sendMessage(chatId, `${deletedCount} ta guruhda oxirgi xabar o'chirildi.`);
        return;
    }
});
