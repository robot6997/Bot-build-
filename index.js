// 🔥 GAK PAKE dotenv, LANGSUNG AMBIL DARI RAILWAY VARIABLES 🔥
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const moment = require('moment');
const axios = require('axios');
const crypto = require('crypto');

// ─── CONFIG (DIAMBIL DARI RAILWAY VARIABLES) ─────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'owner';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());

// 🔥🔥🔥 URL LOCAL BOT API RAILWAY LO 🔥🔥🔥
const LOCAL_API_URL = 'https://telegram-bot-api-production-df76.up.railway.app';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN tidak ada di Railway Variables!');
  process.exit(1);
}

// 🔥 INISIALISASI BOT PAKE LOCAL API RAILWAY 🔥
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: true,
  baseApiUrl: LOCAL_API_URL 
});

// ─── FOLDER & DATABASE ────────────────────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, 'temp');
const OUTPUT_DIR = path.join(__dirname, 'output');
const DB_DIR = path.join(__dirname, 'database');
const PREMIUM_FILE = path.join(DB_DIR, 'premium_users.json');
const HISTORY_FILE = path.join(DB_DIR, 'history.json');
const LOG_FILE = path.join(DB_DIR, 'bot.log');
const BANNER_IMAGE = path.join(__dirname, 'banner.jpg');
// Auto-create folders
[TEMP_DIR, OUTPUT_DIR, DB_DIR, path.join(__dirname, 'tumb')].forEach(dir => {
  try {
    fs.ensureDirSync(dir);
    console.log(`✅ Folder ready: ${path.basename(dir)}/`);
  } catch (e) {
    console.error(`❌ Gagal buat folder ${dir}:`, e.message);
  }
});

// Auto-create database files
[
  { file: PREMIUM_FILE, def: [] },
  { file: HISTORY_FILE, def: [] }
].forEach(({ file, def }) => {
  if (!fs.existsSync(file)) {
    fs.writeJsonSync(file, def, { spaces: 2 });
    console.log(`✅ Database created: ${path.basename(file)}`);
  }
});

// ─── LOGGING SYSTEM ───────────────────────────────────────────────────────────
function writeLog(level, message) {
  const time = moment().format('YYYY-MM-DD HH:mm:ss');
  const logMsg = `[${time}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logMsg);
  } catch (e) {}
}

// ─── USER SESSIONS ────────────────────────────────────────────────────────────
const userSessions = {};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isOwner = (id) => String(id) === String(OWNER_ID);
const isAdmin = (id) => isOwner(id) || ADMIN_IDS.includes(String(id));
const isPremium = (userId) => {
  try {
    return fs.readJsonSync(PREMIUM_FILE).includes(String(userId));
  } catch { return false; }
};

const addPremiumUser = (userId) => {
  try {
    const users = fs.readJsonSync(PREMIUM_FILE);
    if (!users.includes(String(userId))) {
      users.push(String(userId));
      fs.writeJsonSync(PREMIUM_FILE, users, { spaces: 2 });
      writeLog('PREMIUM', `Added ${userId}`);
      return true;
    }
    return false;
  } catch { return false; }
};

const removePremiumUser = (userId) => {
  try {
    let users = fs.readJsonSync(PREMIUM_FILE);
    users = users.filter(id => id !== String(userId));
    fs.writeJsonSync(PREMIUM_FILE, users, { spaces: 2 });
    writeLog('PREMIUM', `Removed ${userId}`);
  } catch {}
};

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateHash(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch { return 'unknown'; }
}

// ─── FUNCTION: SCAN & GANTI DOMAIN DI SEMUA FILE DART ────────────────────────
function replaceDomainInDartFiles(rootDir, oldDomain, newDomain) {
  let totalDartFiles = 0;
  let modifiedFiles = 0;
  const modifiedFileList = [];
  const escapedOld = escapeRegex(oldDomain);
  const domainRegex = new RegExp(escapedOld, 'g');
  const skippedFolders = ['build', '.dart_tool', '.git', '.idea', 'android', 'ios', 'web', 'test', 'windows', 'linux', 'macos', '.vscode', 'assets', 'fonts', 'images'];

  function scanDir(currentDir, depth) {
    if (!fs.existsSync(currentDir) || depth > 20) return;
    
    let items;
    try { items = fs.readdirSync(currentDir); } catch { return; }
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          if (!skippedFolders.includes(item)) scanDir(fullPath, depth + 1);
        } else if (item.endsWith('.dart')) {
          totalDartFiles++;
          try {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes(oldDomain)) {
              const newContent = content.replace(domainRegex, newDomain);
              fs.writeFileSync(fullPath, newContent, 'utf8');
              modifiedFiles++;
              modifiedFileList.push(path.relative(rootDir, fullPath));
            }
          } catch {}
        }
      } catch {}
    }
  }

  const libDir = path.join(rootDir, 'lib');
  if (fs.existsSync(libDir)) scanDir(libDir, 0);
  if (totalDartFiles === 0 || !fs.existsSync(libDir)) scanDir(rootDir, 0);

  return { totalDartFiles, modifiedFiles, modifiedFileList };
}

// ─── FUNCTION: CHECK ACCESS ──────────────────────────────────────────────────
function checkAccess(userId, chatId) {
  if (isAdmin(userId)) return true;
  if (!isPremium(userId)) {
    bot.sendMessage(chatId,
      `🔒 AKSES TERBATAS\n\nBot ini hanya untuk pengguna Premium!\n\nHubungi Owner: @${OWNER_USERNAME}\n\nKetik /start untuk mengecek ulang.`,
      {
        reply_markup: { inline_keyboard: [[{ text: '👤 HUBUNGI OWNER', url: `https://t.me/${OWNER_USERNAME}` }]] }
      }
    );
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: /start
// ═══════════════════════════════════════════════════════════════════════════════
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const name = msg.from.first_name;
  const isUserAdmin = isAdmin(userId);
  const isUserPremium = isPremium(userId);

  let text = '';
  let keyboard = [];

  if (isUserAdmin) {
    text = `🔄 BOT RENAME DOMAIN DART (RAILWAY 2GB)\n\nHalo ${name}! (Admin)\n\n` +
      `📊 Status: Premium ✅\n\n` +
      `📋 Cara Pakai:\n1️⃣ Kirim file ZIP (Max 2 GB)\n2️⃣ Kirim domain lama\n3️⃣ Kirim domain baru\n4️⃣ Bot proses rename\n5️⃣ File hasil dikirim\n\n` +
      `⚡ Hanya file .dart yang diubah!\n🛡️ Kode lain tetap aman!\n\n` +
      `🔧 Command Admin:\n/addprem <id>\n/delprem <id>\n/listprem\n/history\n/logs\n\n` +
      `Kirim file ZIP untuk memulai!`;
  } else if (isUserPremium) {
    text = `🔄 BOT RENAME DOMAIN DART (RAILWAY 2GB)\n\nHalo ${name}!\n\n` +
      `📊 Status: Premium ✅\n\n` +
      `📋 Cara Pakai:\n1️⃣ Kirim file ZIP (Max 2 GB)\n2️⃣ Kirim domain lama\n3️⃣ Kirim domain baru\n4️⃣ Bot proses rename\n5️⃣ File hasil dikirim\n\n` +
      `⚡ Hanya file .dart yang diubah!\n🛡️ Kode lain tetap aman!\n\n` +
      `Kirim file ZIP untuk memulai!`;
  } else {
    text = `🔒 AKSES TERBATAS\n\nHalo ${name}!\n\nBot ini hanya untuk pengguna Premium!\n\n` +
      `Hubungi Owner: @${OWNER_USERNAME}\n\nKetik /start untuk mengecek ulang.`;
    keyboard = [[{ text: '👤 HUBUNGI OWNER', url: `https://t.me/${OWNER_USERNAME}` }]];
  }

  const options = {};
  if (keyboard.length > 0) options.reply_markup = { inline_keyboard: keyboard };

  if (fs.existsSync(BANNER_IMAGE)) {
    bot.sendPhoto(chatId, BANNER_IMAGE, { caption: text, reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined })
      .catch(() => bot.sendMessage(chatId, text, options));
  } else {
    bot.sendMessage(chatId, text, options);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: ADMIN & PREMIUM
// ═══════════════════════════════════════════════════════════════════════════════
bot.onText(/\/addprem(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses ditolak!');

  let targetId;
  if (msg.reply_to_message) targetId = String(msg.reply_to_message.from.id);
  else if (match[1]) targetId = match[1].trim();
  else return bot.sendMessage(chatId, '📝 Reply user atau /addprem <id>');

  if (addPremiumUser(targetId)) {
    bot.sendMessage(chatId, `✅ User ${targetId} sekarang Premium!`);
    bot.sendMessage(targetId, '🎉 SELAMAT! Anda sekarang Premium! Ketik /start.').catch(() => {});
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} sudah Premium!`);
  }
});

bot.onText(/\/delprem(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return bot.sendMessage(chatId, '❌ Akses ditolak!');

  let targetId;
  if (msg.reply_to_message) targetId = String(msg.reply_to_message.from.id);
  else if (match[1]) targetId = match[1].trim();
  else return bot.sendMessage(chatId, '📝 Reply user atau /delprem <id>');

  removePremiumUser(targetId);
  bot.sendMessage(chatId, `✅ User ${targetId} dihapus dari Premium!`);
  bot.sendMessage(targetId, '⚠️ PREMIUM DICABUT').catch(() => {});
});

bot.onText(/\/listprem/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const users = fs.readJsonSync(PREMIUM_FILE);
  if (users.length === 0) return bot.sendMessage(msg.chat.id, '📋 Belum ada pengguna Premium.');
  let text = `👑 DAFTAR PREMIUM\nTotal: ${users.length}\n\n`;
  users.forEach((id, i) => text += `${i + 1}. ${id}\n`);
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/history/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const history = fs.readJsonSync(HISTORY_FILE);
  if (history.length === 0) return bot.sendMessage(msg.chat.id, '📋 Belum ada riwayat rename.');
  let text = '📋 RIWAYAT RENAME\n\n';
  history.slice(-10).reverse().forEach(h => {
    text += `📁 ${h.fileName}\n👤 ${h.userId}\n🔄 ${h.oldDomain} → ${h.newDomain}\n📝 ${h.modifiedFiles} file\n📅 ${moment(h.timestamp).format('DD/MM HH:mm')}\n━━━━━━━━━━━━━━━━\n`;
  });
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/logs/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!fs.existsSync(LOG_FILE)) return bot.sendMessage(msg.chat.id, '📋 Log kosong.');
  const logs = fs.readFileSync(LOG_FILE, 'utf8');
  const lastLogs = logs.split('\n').slice(-20).join('\n');
  bot.sendMessage(msg.chat.id, `📋 20 LOG TERAKHIR\n\n${lastLogs}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER: TERIMA FILE ZIP (MAX 2 GB)
// ═══════════════════════════════════════════════════════════════════════════════
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const doc = msg.document;
  const fileName = doc.file_name || 'file.zip';

  if (!checkAccess(userId, chatId)) return;
  if (!fileName.endsWith('.zip')) return bot.sendMessage(chatId, '❌ Hanya file ZIP yang didukung!');

  // 🔥 BATAS UPLOAD 2 GB 🔥
  const maxSize = 2000 * 1024 * 1024;
  if (doc.file_size > maxSize) return bot.sendMessage(chatId, '❌ File terlalu besar! Maksimal 2GB.');

  const oldSession = userSessions[userId];
  if (oldSession && oldSession.filePath && fs.existsSync(oldSession.filePath)) {
    try { fs.unlinkSync(oldSession.filePath); } catch {}
  }

  const loadingMsg = await bot.sendMessage(chatId, `📥 Mengunduh file...\n\n📁 ${fileName}\n📏 ${(doc.file_size / 1024 / 1024).toFixed(1)} MB\n\nMohon tunggu...`);

  try {
    const filePath = path.join(TEMP_DIR, `${userId}_${Date.now()}_${fileName}`);
    const file = await bot.getFile(doc.file_id);
    
    // 🔥 URL DOWNLOAD MENYESUAIKAN LOCAL API RAILWAY 🔥
    const fileUrl = `${LOCAL_API_URL}/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    const response = await axios({ method: 'GET', url: fileUrl, responseType: 'stream', timeout: 600000 });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    userSessions[userId] = { step: 'waiting_domain_old', filePath, fileName };
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    bot.sendMessage(chatId, `✅ File ${fileName} diunduh!\n\n📋 Step 2: Kirim domain lama.\n\nContoh: http://domain-lama.com\n\nKetik domain lamanya saja`);
  } catch (e) {
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    bot.sendMessage(chatId, `❌ Gagal: ${e.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER: TERIMA DOMAIN LAMA & BARU
// ═══════════════════════════════════════════════════════════════════════════════
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const session = userSessions[userId];
  if (!session) return;

  if (!checkAccess(userId, chatId)) {
    delete userSessions[userId];
    if (session.filePath && fs.existsSync(session.filePath)) try { fs.unlinkSync(session.filePath); } catch {}
    return;
  }

  if (session.step === 'waiting_domain_old') {
    session.oldDomain = text.trim();
    session.step = 'waiting_domain_new';
    bot.sendMessage(chatId, `✅ Domain lama: ${session.oldDomain}\n\n📋 Step 3: Kirim domain baru.\n\nContoh: http://domain-baru.com\n\nKetik domain barunya saja`);
  } else if (session.step === 'waiting_domain_new') {
    session.newDomain = text.trim();
    bot.sendMessage(chatId, 
      `📋 KONFIRMASI RENAME DOMAIN\n\n📁 File: ${session.fileName}\n🔄 Domain Lama: ${session.oldDomain}\n✨ Domain Baru: ${session.newDomain}\n\n⚠️ Hanya file .dart yang diubah!\n🛡️ Kode lain tetap aman!\n\nPilih opsi:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ PROSES RENAME', callback_data: 'rename_confirm' }],
            [{ text: '❌ BATALKAN', callback_data: 'rename_cancel' }]
          ]
        }
      }
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const userId = String(q.from.id);
  const data = q.data;
  await bot.answerCallbackQuery(q.id);

  const session = userSessions[userId];
  if (!session || session.step !== 'waiting_domain_new') return bot.sendMessage(chatId, '❌ Session expired!');

  if (data === 'rename_cancel') {
    if (session.filePath && fs.existsSync(session.filePath)) try { fs.unlinkSync(session.filePath); } catch {}
    delete userSessions[userId];
    bot.sendMessage(chatId, '✅ Proses dibatalkan!');
  } else if (data === 'rename_confirm') {
    await processRename(chatId, userId, session);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROSES RENAME DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function processRename(chatId, userId, session) {
  const loadingMsg = await bot.sendMessage(chatId, `🔄 PROSES RENAME\n\n📁 Ekstrak... [■□□□□□□□□□] 10%`);

  try {
    const { filePath, fileName, oldDomain, newDomain } = session;
    const workDir = path.join(TEMP_DIR, `work_${userId}_${Date.now()}`);
    fs.ensureDirSync(workDir);

    writeLog('RENAME', `Start ${fileName} | ${oldDomain} -> ${newDomain}`);

    await updateProgress(loadingMsg, `📁 Ekstrak... [■■■□□□□□□□] 30%`);
    new AdmZip(filePath).extractAllTo(workDir, true);
    
    await updateProgress(loadingMsg, `🔍 Mencari & Ganti .dart... [■■■■■■□□□□] 60%`);
    const result = replaceDomainInDartFiles(workDir, oldDomain, newDomain);
    
    writeLog('RENAME', `Modified ${result.modifiedFiles} files`);
    
    await updateProgress(loadingMsg, `📦 Build ZIP... [■■■■■■■■■□] 90%`);
    const outputFileName = fileName.replace('.zip', '_renamed.zip');
    const outputPath = path.join(OUTPUT_DIR, outputFileName);
    fs.ensureDirSync(OUTPUT_DIR);

    const newZip = new AdmZip();
    newZip.addLocalFolder(workDir);
    newZip.writeZip(outputPath);

    try { if (fs.existsSync(workDir)) fs.removeSync(workDir); } catch {}
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

    const fileSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    const fileHash = generateHash(outputPath);

    let listText = '';
    if (result.modifiedFileList.length > 0) {
      listText = '\n📄 File diubah:\n';
      result.modifiedFileList.slice(0, 10).forEach(f => listText += `• ${f}\n`);
      if (result.modifiedFileList.length > 10) listText += `... dan ${result.modifiedFileList.length - 10} lainnya\n`;
    }

    await updateProgress(loadingMsg, `✅ RENAME SUKSES!\n\nMengirim file... [■■■■■■■■■■] 100%`);

    // 🔥 KIRIM FILE LANGSUNG (MAX 2 GB) 🔥
    await bot.sendDocument(chatId, outputPath, {
      caption: `✅ RENAME SUKSES!\n\n📁 ${outputFileName}\n📏 ${fileSize} MB\n🔄 ${oldDomain}\n✨ ${newDomain}\n📝 ${result.modifiedFiles}/${result.totalDartFiles} file diubah${listText}\n🔐 SHA256: ${fileHash.substring(0, 16)}...\n📅 ${moment().format('DD/MM/YYYY HH:mm')}\n\n🛡️ Hanya file .dart yang diubah!`
    });

    try {
      const history = fs.readJsonSync(HISTORY_FILE);
      history.push({ userId, fileName, outputFile: outputFileName, oldDomain, newDomain, totalDartFiles: result.totalDartFiles, modifiedFiles: result.modifiedFiles, timestamp: new Date().toISOString() });
      fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
    } catch {}

    setTimeout(() => { try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {} }, 3600000);
    delete userSessions[userId];

  } catch (e) {
    writeLog('ERROR', `Rename failed: ${e.message}`);
    await updateProgress(loadingMsg, `❌ GAGAL!\n\n${e.message}`);
    try { fs.removeSync(path.join(TEMP_DIR, `work_${userId}_${Date.now()}`)); } catch {}
    try { if (session.filePath && fs.existsSync(session.filePath)) fs.unlinkSync(session.filePath); } catch {}
    delete userSessions[userId];
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function updateProgress(msg, text) {
  try { await bot.editMessageText(text, { chat_id: msg.chat.id, message_id: msg.message_id }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════
setInterval(() => {
  [TEMP_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      const fp = path.join(dir, file);
      try { if (Date.now() - fs.statSync(fp).mtimeMs > 1800000) fs.statSync(fp).isDirectory() ? fs.removeSync(fp) : fs.unlinkSync(fp); } catch {}
    });
  });
  writeLog('CLEANUP', 'Auto cleanup executed');
}, 300000);

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════
console.log('='.repeat(50));
console.log('🔄 Bot Rename Domain Dart (Railway 2GB Mode)');
console.log(`📡 Endpoint: ${LOCAL_API_URL}`);
console.log('✅ Ready, BOSS BAGUS!');
