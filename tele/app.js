/**
 * Dibuat oleh Autoftbot pada 19 April 2025
 * Dilarang keras untuk diperjualbelikan.
 * Kalau mau ubah atau modifikasi, silakan fork saja proyeknya.
 */

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const { createCanvas, loadImage } = require('canvas');

dotenv.config();

// Konfigurasi
const CONFIG = {
    adminId: process.env.ADMIN_ID,
    loggingGroupId: process.env.LOGGING_GROUP_ID,
    dataFile: path.join(__dirname, 'user_data.json'),
    maxRequests: 5,
    requestWindow: 60 * 60 * 1000,
    otpRequests: 3,
    otpWindow: 5 * 60 * 1000,
    dorConfig: {
        apiUrl: 'https://api.tuyull.my.id/api/v1/dor',
        apiKey: process.env.DOR_API_KEY
    },
    otpConfig: {
        requestUrl: 'https://api.tuyull.my.id/api/v1/minta-otp',
        verifyUrl: 'https://api.tuyull.my.id/api/v1/verif-otp'
    }
};

const bot = new Telegraf(process.env.BOT_TOKEN);

function loadUserData() {
    try {
        if (fs.existsSync(CONFIG.dataFile)) {
            return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('Error loading user data:', error);
        return {};
    }
}

function saveUserData(data) {
    try {
        fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving user data:', error);
    }
}

const unverifiedMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📱 Minta OTP', callback_data: 'minta_otp' }]
        ]
    }
};

const verifiedMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Mulai DOR', callback_data: 'start_dor' }],
            [{ text: '🗑️ Hapus OTP', callback_data: 'hapus_otp' }]
        ]
    }
};

const messageTracker = {};

async function sendMessage(ctx, message, options = {}) {
    try {
        const userId = ctx.from.id;
        if (messageTracker[userId]) {
            try {
                await ctx.deleteMessage(messageTracker[userId]).catch(error => {
                    console.log(`Info: Tidak bisa menghapus pesan ${messageTracker[userId]} untuk user ${userId}`);
                });
            } catch (error) {
                console.log(`Info: Gagal menghapus pesan untuk user ${userId}`);
            }
        }
        const newMessage = await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...options
        });
        messageTracker[userId] = newMessage.message_id;
        return newMessage;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

const messageTemplates = {
    welcome: (isVerified) => `
╭─〔 MENU UTAMA 〕────────────╮
│ 👋 Selamat datang di *DOR*!
│ Status: ${isVerified ? '✅ Terverifikasi' : '❌ Belum Verifikasi'}
│
├─〔 MENU 〕─────────────────
│ ${isVerified ? '🚀 Mulai DOR' : '📱 Minta OTP'}
│
│ Jika Otp Tidak Masuk Coba lagi dengan request ulang
│
├─〔 PERHATIAN 〕────────────
│ ⚠️ Hindari semua jenis kuota XTRA COMBO sebelum order:
│   ❌ XTRA COMBO
│   ❌ XTRA COMBO VIP
│   ❌ XTRA COMBO MINI
│   ❌ XTRA COMBO VIP PLUS
│ ⚠️ Lakukan UNREG dulu agar tidak bentrok.
│ Cara UNREG XTRA Combo:
│ 1. Dial \`*808#\`
│ 2. Pilih Info
│ 3. Pilih Info Kartu XL-ku
│ 4. Pilih Stop Langganan
│ ⚠️ Lakukan pembayaran dalam 5 menit
│ ⚠️ Jangan bagikan kode OTP
╰────────────────────────────╯`,

    otpRequest: `
╭─〔 MINTA OTP 〕────────────╮
│ 📱 Masukkan nomor HP Anda
│ Contoh: 081234567890
│
├─〔 PERHATIAN 〕────────────
│ • Nomor aktif & valid
│ • Bisa menerima SMS
│ • Format: 10-13 digit
╰────────────────────────────╯`,

    otpSent: (phoneNumber) => `
╭─〔 OTP TERKIRIM 〕─────────╮
│ OTP telah dikirim ke:
│ 📱 ${phoneNumber}
│
├─〔 PETUNJUK 〕─────────────
│ • Cek SMS masuk
│ • Masukkan kode OTP
│ • Berlaku 5 menit
╰────────────────────────────╯`,

    paymentSuccess: (reference, date) => `
╭─〔〕──╮
│ ✅ Berhasil!
│ 📝 Ref: ${reference}
│ 🕒 ${date}
│
├─〔 PROSES 〕────────────────
│ ⏳ Sedang memproses DOR...
│ Mohon tunggu sebentar
╰────────────────────────────╯`,

    dorSuccess: (phoneNumber) => `
╭─〔 DOR BERHASIL 〕─────────╮
│ ✅ DOR untuk:
│ 📱 ${phoneNumber}
│ 📦 Paket: Unlimited Turbo
│ ⏳ Proses: ± 60 menit
╰────────────────────────────╯`,

    sessionEnd: `
╭─〔 SESI BERAKHIR 〕────────╮
│ ✅ DOR selesai!
│ 🔄 Data sesi dihapus
│
├─〔 UNTUK DOR LAGI 〕───────
│ 1. Klik "Minta OTP"
│ 2. Login ulang
╰────────────────────────────╯`,

    error: (message) => `
╭─〔 ERROR 〕────────────────╮
│ ${message}
│
├─〔 SOLUSI 〕───────────────
│ • Coba lagi nanti
│ • Hubungi admin jika perlu
╰────────────────────────────╯`
};
const otpErrorTemplate = (message) => `
╭─〔 GAGAL REQUEST OTP 〕────╮
│ ❌ ${message}
│
├─〔 PETUNJUK 〕─────────────
│ 1. Klik "Minta OTP"
│ 2. Masukkan nomor yang valid
╰────────────────────────────╯`;
const otpCooldownTemplate = `
╭─〔 BATAS WAKTU OTP 〕──────╮
│ ⏰ Tunggu sebentar!
│ Anda perlu menunggu 3–5 menit
│ sebelum meminta OTP lagi
│
├─〔 PETUNJUK 〕─────────────
│ • Klik "Minta OTP" setelahnya
│ • Gunakan nomor yang valid
╰────────────────────────────╯`;

bot.command('start', async (ctx) => {
    const userData = loadUserData();
    const userId = ctx.from.id;
    const isVerified = userData[userId]?.verified;

    await sendMessage(ctx, messageTemplates.welcome(isVerified), 
        isVerified ? verifiedMenu : unverifiedMenu);
});

bot.action('minta_otp', async (ctx) => {
    try {
        const userData = loadUserData();
        const userId = ctx.from.id;

        if (userData[userId]?.verified) {
            await sendMessage(ctx, '⚠️ Anda sudah login. Silakan gunakan menu DOR.', verifiedMenu);
            return;
        }
        const lastRequest = userData[userId]?.lastOtpRequest || 0;
        const now = Date.now();
        const timeDiff = now - lastRequest;
        if (lastRequest > 0 && timeDiff < 3 * 60 * 1000) {
            await sendMessage(ctx, otpCooldownTemplate, unverifiedMenu);
            return;
        }
        userData[userId] = {
            ...userData[userId],
            waitingFor: 'phone_number',
            lastOtpRequest: now
        };
        saveUserData(userData);

        await sendMessage(ctx, messageTemplates.otpRequest, {
            reply_markup: {
                force_reply: true
            }
        });
    } catch (error) {
        await sendMessage(ctx, messageTemplates.error(error.message), unverifiedMenu);
    }
});

bot.on('text', async (ctx) => {
    const userData = loadUserData();
    const userId = ctx.from.id;
    
    if (userData[userId]?.waitingFor === 'phone_number') {
        const phoneNumber = ctx.message.text.trim();
        
        if (!/^[0-9]{10,13}$/.test(phoneNumber)) {
            await sendMessage(ctx, messageTemplates.error('Format nomor HP tidak valid!\nGunakan 10-13 digit angka.'), {
                reply_markup: {
                    force_reply: true
                }
            });
            return;
        }

        try {
            const response = await axios.get(`${CONFIG.otpConfig.requestUrl}?nomor_hp=${phoneNumber}`, {
                headers: {
                    'Authorization': CONFIG.dorConfig.apiKey
                }
            });

            if (response.data.status === "success") {
                userData[userId] = {
                    ...userData[userId],
                    phoneNumber,
                    waitingFor: 'otp_code',
                    otpData: response.data.data
                };
                saveUserData(userData);
                
                await sendMessage(ctx, messageTemplates.otpSent(phoneNumber), {
                    reply_markup: {
                        force_reply: true
                    }
                });
            } else {
                userData[userId] = {
                    ...userData[userId],
                    waitingFor: null
                };
                saveUserData(userData);
                
                throw new Error(response.data.message || "Gagal mengirim OTP");
            }
        } catch (error) {
            userData[userId] = {
                ...userData[userId],
                waitingFor: null
            };
            saveUserData(userData);
            if (error.message.includes("time limit") || 
                (error.response?.data?.response_text?.error && 
                 error.response.data.response_text.error.includes("time limit"))) {
                await sendMessage(ctx, otpCooldownTemplate, unverifiedMenu);
            } else {
                await sendMessage(ctx, otpErrorTemplate(error.message), unverifiedMenu);
            }
        }
    } else if (userData[userId]?.waitingFor === 'otp_code') {
        const otpCode = ctx.message.text.trim();
        
        try {
            const response = await axios.get(`${CONFIG.otpConfig.verifyUrl}?nomor_hp=${userData[userId].phoneNumber}&kode_otp=${otpCode}`, {
                headers: {
                    'Authorization': CONFIG.dorConfig.apiKey
                }
            });

            if (response.data.status === "success") {
                userData[userId] = {
                    ...userData[userId],
                    verified: true,
                    accessToken: response.data.data.access_token,
                    waitingFor: null
                };
                saveUserData(userData);
                
                await sendMessage(ctx, `
╭─〔 VERIFIKASI BERHASIL 〕────╮
│ ✅ Login berhasil!
│ 📱 Nomor: ${userData[userId].phoneNumber}
│
├─〔 PETUNJUK 〕─────────────
│ 1. Klik "Mulai DOR"
│ 2. Lanjutkan proses
╰────────────────────────────╯`, verifiedMenu);
            } else {
                userData[userId] = {
                    ...userData[userId],
                    waitingFor: null
                };
                saveUserData(userData);
                
                throw new Error(response.data.message || "Gagal verifikasi OTP");
            }
        } catch (error) {
            userData[userId] = {
                ...userData[userId],
                waitingFor: null
            };
            saveUserData(userData);
            
            await sendMessage(ctx, otpErrorTemplate(error.message), unverifiedMenu);
        }
    }
});

bot.action('start_dor', async (ctx) => {
    const userData = loadUserData();
    const userId = ctx.from.id;
    
    if (!userData[userId]?.verified) {
        await sendMessage(ctx, messageTemplates.error('Anda belum terverifikasi'), unverifiedMenu);
        return;
    }
    
    const dorMenu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Konfirmasi DOR', callback_data: 'confirm_dor' }],
                [{ text: '❌ Batalkan', callback_data: 'cancel_dor' }]
            ]
        }
    };
    
    await sendMessage(ctx, `
╭─〔 KONFIRMASI DOR 〕────────────╮
│ 📱 *Detail Target:*
│ Nomor: ${userData[userId].phoneNumber}
│
├─〔 PERHATIAN 〕────────────────
│ • Jangan gunakan nomor dengan:
│   - XTRA COMBO
│   - XTRA COMBO VIP
│   - XTRA COMBO MINI
│   - XTRA COMBO VIP PLUS
│
│ • Bayar dalam 5 menit
│ • Saldo hangus jika gagal
│ • Admin tidak bertanggung jawab jika salah
╰──────────────────────────────╯
    `, {
        ...dorMenu
    });
});

function deleteUserData(userId) {
    try {
        const userData = loadUserData();
        if (userData[userId]) {
            delete userData[userId];
            saveUserData(userData);
            console.log(`Data user ${userId} berhasil dihapus`);
        }
    } catch (error) {
        console.error('Error deleting user data:', error);
    }
}

function escapeMarkdownV2(text) {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatTransactionLog(data) {
    const { phoneNumber, reference, date, username, userId } = data;

    const userLine = username
        ? `🔖 Username: @${username}`
        : '🔖 Tidak ada username';

    const message = `
╭─〔 TRANSAKSI BERHASIL 〕────────╮
│ 📱 Nomor: ${phoneNumber}
│ 🧾 Referensi: ${reference}
│ ⏰ Waktu: ${date}
│
├─〔 INFO USER 〕─────────────────
│ 👤 ID: ${userId}
│ ${userLine}
╰───────────────────────────────╯`;

    return escapeMarkdownV2(message);
}

async function sendTransactionLog(data) {
    try {
        const logMessage = formatTransactionLog(data);

        await bot.telegram.sendMessage(CONFIG.loggingGroupId, logMessage, {
            parse_mode: 'MarkdownV2'
        });

        console.log(`✅ Log berhasil dikirim untuk user ${data.userId}`);
    } catch (error) {
        console.error('❌ Gagal kirim log transaksi:', error);
    }
}

bot.action('confirm_dor', async (ctx) => {
    const userData = loadUserData();
    const userId = ctx.from.id;
    
    if (!userData[userId]?.verified) {
        await sendMessage(ctx, messageTemplates.error('Anda belum terverifikasi'), unverifiedMenu);
        return;
    }

    const reference = 'DOR' + Date.now();

                    const dorData = {
                        kode: "uts2",
                        nama_paket: "Paket Kere Hore",
                        nomor_hp: userData[userId].phoneNumber,
                        payment: "pulsa",
                        id_telegram: process.env.ID_TELEGRAM,
                        password: process.env.PASSWORD,
                        access_token: userData[userId].accessToken
                    };

                    const dorResponse = await axios.post(CONFIG.dorConfig.apiUrl, dorData, {
                        headers: {
                            'Authorization': CONFIG.dorConfig.apiKey
                        }
                    });

                    if (dorResponse.data.status === "success") {
                        await sendMessage(ctx, messageTemplates.dorSuccess(userData[userId].phoneNumber));
                        deleteUserData(userId);
                        
                        if (messageTracker[userId]) {
                            delete messageTracker[userId];
                        }
                        
                        await sendMessage(ctx, messageTemplates.sessionEnd, unverifiedMenu);
                    } else {
                        throw new Error(dorResponse.data.message || "Gagal memproses DOR");
                } 
        }, 10000);

    } catch (error) {
        await sendMessage(ctx, messageTemplates.error(error.message), verifiedMenu);
    }
});

bot.action('cancel_dor', async (ctx) => {
    await sendMessage(ctx, '❌ DOR dibatalkan.', verifiedMenu);
});

function calculateCRC16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

bot.action('hapus_otp', async (ctx) => {
    try {
        const userData = loadUserData();
        const userId = ctx.from.id;
        
        if (!userData[userId]) {
            await sendMessage(ctx, messageTemplates.error('Anda belum memiliki data OTP untuk dihapus.'), unverifiedMenu);
            return;
        }

        // Hapus data OTP dan verifikasi
        delete userData[userId].phoneNumber;
        delete userData[userId].verified;
        delete userData[userId].accessToken;
        delete userData[userId].otpData;
        saveUserData(userData);

        await sendMessage(ctx, `
╭─〔 OTP DIHAPUS 〕──────────╮
│ ✅ Data OTP berhasil dihapus
│
├─〔 PETUNJUK 〕─────────────
│ 1. Klik "Minta OTP"
│ 2. Masukkan nomor baru
╰────────────────────────────╯`, unverifiedMenu);
    } catch (error) {
        await sendMessage(ctx, messageTemplates.error('Gagal menghapus data OTP. Silakan coba lagi.'), unverifiedMenu);
    }
});

bot.catch((err, ctx) => {
    console.error('Error:', err);
    ctx.reply(messageTemplates.error('Terjadi kesalahan. Silakan coba lagi nanti.'), unverifiedMenu);
});

bot.launch()
    .then(() => {
        console.log('Bot started successfully');
    })
    .catch((err) => {
        console.error('Failed to start bot:', err);
    });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 
