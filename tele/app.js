/**
 * Dibuat oleh Autoftbot pada 19 April 2025
 * Dilarang keras untuk diperjualbelikan.
 * Kalau mau ubah atau modifikasi, silakan fork saja proyeknya.
 */

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
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
    qrisConfig: {
        merchantId: process.env.QRIS_MERCHANT_ID,
        apiKey: process.env.QRIS_API_KEY,
        basePrice: process.env.BASE_PRICE,
        baseQrString: process.env.QRIS_BASE_QR_STRING,
        logoPath: path.join(__dirname, 'logo.png')
    },
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

    paymentQR: (amount, reference) => `
╭─〔 PEMBAYARAN 〕────────────╮
│ 💰 Total: Rp ${amount}
│ 📝 Ref: ${reference}
│ ⏰ Batas: 5 menit
│
├─〔 PETUNJUK 〕─────────────
│ 1. Scan QR
│ 2. Bayar sesuai nominal
│ 3. Tunggu konfirmasi
╰────────────────────────────╯`,

    paymentSuccess: (amount, reference, date) => `
╭─〔 PEMBAYARAN DITERIMA 〕──╮
│ ✅ Berhasil!
│ 💰 Rp ${amount}
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

async function checkPaymentStatus(reference, amount) {
    try {
        const response = await axios.get(
            `https://gateway.okeconnect.com/api/mutasi/qris/${CONFIG.qrisConfig.merchantId}/${CONFIG.qrisConfig.apiKey}`
        );
        
        if (response.data && response.data.status === "success" && response.data.data) {
            const transactions = response.data.data;
            const matchingTransactions = transactions.filter(tx => {
                const txAmount = parseInt(tx.amount);
                const txDate = new Date(tx.date);
                const now = new Date();
                const timeDiff = now - txDate;
                return txAmount === amount && 
                       tx.qris === "static" &&
                       tx.type === "CR" &&
                       timeDiff <= 5 * 60 * 1000;
            });
            
            if (matchingTransactions.length > 0) {
                const latestTransaction = matchingTransactions.reduce((latest, current) => {
                    const currentDate = new Date(current.date);
                    const latestDate = new Date(latest.date);
                    return currentDate > latestDate ? current : latest;
                });
                
                return {
                    success: true,
                    data: {
                        status: 'PAID',
                        amount: parseInt(latestTransaction.amount),
                        reference: latestTransaction.issuer_reff,
                        date: latestTransaction.date,
                        brand_name: latestTransaction.brand_name,
                        buyer_reff: latestTransaction.buyer_reff
                    }
                };
            }
        }
        
        return {
            success: false,
            data: {
                status: 'UNPAID',
                amount: amount,
                reference: reference
            }
        };
    } catch (error) {
        console.error('Error checking payment:', error);
        throw error;
    }
}

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

async function generateQRWithLogo(qrString) {
    try {
        const canvas = createCanvas(500, 500);
        const ctx = canvas.getContext('2d');
        await QRCode.toCanvas(canvas, qrString, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 500,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        
        if (fs.existsSync(CONFIG.qrisConfig.logoPath)) {
            const logo = await loadImage(CONFIG.qrisConfig.logoPath);
            const logoSize = canvas.width * 0.25;
            const logoPosition = (canvas.width - logoSize) / 2;
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(logoPosition - 5, logoPosition - 5, logoSize + 10, logoSize + 10);
            ctx.drawImage(logo, logoPosition, logoPosition, logoSize, logoSize);
        }
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error('Error generating QR with logo:', error);
        throw error;
    }
}

function savePaymentData(userId, paymentData) {
    const userData = loadUserData();
    if (!userData[userId]) {
        userData[userId] = {};
    }
    userData[userId].paymentData = paymentData;
    saveUserData(userData);
}

function getPaymentData(userId) {
    const userData = loadUserData();
    return userData[userId]?.paymentData || null;
}

function removePaymentData(userId) {
    const userData = loadUserData();
    if (userData[userId] && userData[userId].paymentData) {
        delete userData[userId].paymentData;
        saveUserData(userData);
    }
}

function escapeMarkdownV2(text) {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatTransactionLog(data) {
    const { phoneNumber, amount, reference, date, username, userId } = data;

    const userLine = username
        ? `🔖 Username: @${username}`
        : '🔖 Tidak ada username';

    const message = `
╭─〔 TRANSAKSI BERHASIL 〕────────╮
│ 💰 Jumlah: Rp ${amount}
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

    const existingPayment = getPaymentData(userId);
    if (existingPayment && existingPayment.status === 'PENDING') {
        const timeElapsed = Date.now() - existingPayment.timestamp;
        if (timeElapsed < 5 * 60 * 1000) {
            await sendMessage(ctx, messageTemplates.error('Anda masih memiliki pembayaran yang aktif. Mohon selesaikan atau tunggu 5 menit.'), verifiedMenu);
            return;
        } else {
            removePaymentData(userId);
        }
    }

    try {
        const randomAmount = Math.floor(Math.random() * 99) + 1;
        const totalAmount = CONFIG.qrisConfig.basePrice + randomAmount;
        const reference = 'DOR' + Date.now();
        const qrString = generateQrString(totalAmount);
        
        const qrBuffer = await generateQRWithLogo(qrString);

        const qrMessage = await ctx.replyWithPhoto(
            { source: qrBuffer },
            {
                caption: messageTemplates.paymentQR(totalAmount.toLocaleString(), reference),
                parse_mode: 'Markdown'
            }
        );

        // Track the QR code message
        messageTracker[userId] = qrMessage.message_id;

        const paymentData = {
            reference,
            amount: totalAmount,
            qrString,
            timestamp: Date.now(),
            status: 'PENDING',
            messageId: qrMessage.message_id,
            userId: userId
        };
        
        savePaymentData(userId, paymentData);

        let checkCount = 0;
        const maxChecks = 30;
        const checkInterval = setInterval(async () => {
            try {
                checkCount++;
                const currentPaymentData = getPaymentData(userId);
                
                if (!currentPaymentData || currentPaymentData.status !== 'PENDING') {
                    clearInterval(checkInterval);
                    return;
                }
                
                const status = await checkPaymentStatus(reference, totalAmount);
                
                if (status.data.status === 'PAID') {
                    clearInterval(checkInterval);
                    
                    currentPaymentData.status = 'PAID';
                    savePaymentData(userId, currentPaymentData);

                    try {
                        await ctx.deleteMessage(qrMessage.message_id).catch(err => {
                            console.log(`Info: Tidak bisa menghapus QR code untuk user ${userId}`);
                        });
                    } catch (error) {
                        console.log(`Info: Gagal menghapus QR code untuk user ${userId}`);
                    }

                    await sendMessage(ctx, messageTemplates.paymentSuccess(
       
