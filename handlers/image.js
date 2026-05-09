const axios = require('axios');
const { db, FieldValue } = require('../db');
const { getCountry, getCurrency, today } = require('../config');
const { genTextWithImage, genTextWithAudio, parseJson } = require('../gemini');
const { sendMessage } = require('../send');
const { generateCreditScore } = require('../features/credit');

const WA_TOKEN = process.env.WA_ACCESS_TOKEN;

async function downloadImage(imageId) {
    const infoRes = await axios.get(
        `https://graph.facebook.com/v18.0/${imageId}`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
    const imageUrl = infoRes.data.url;
    const imgRes = await axios.get(imageUrl, {
        headers: { Authorization: `Bearer ${WA_TOKEN}` },
        responseType: 'arraybuffer',
    });
    const mimeType = imgRes.headers['content-type'] || 'image/jpeg';
    return { buffer: Buffer.from(imgRes.data), mimeType };
}

async function handleImage(phone, imageId) {
    const userRef = db.collection('users').doc(phone);
    const snap = await userRef.get();
    const userData = snap.exists ? snap.data() : {};
    const lang = userData.language || 'bm';
    const state = userData.state || 'menu';

    await sendMessage(phone, lang === 'bm' ? '📸 Gambar diterima! Sedang menganalisis... ⏳' : '📸 Image received! Analyzing... ⏳');

    let buffer, mimeType;
    try {
        ({ buffer, mimeType } = await downloadImage(imageId));
    } catch (err) {
        console.error('[handleImage] download failed:', err.message);
        await sendMessage(phone, lang === 'bm' ? '❌ Gagal muat turun gambar. Cuba lagi.' : '❌ Failed to download image. Try again.');
        return;
    }

    // Route based on state
    if (state === 'await_ssm_cert' || state === 'await_ssm_cert_then_score') {
        await handleSsmVerification(phone, userRef, userData, buffer, mimeType, state === 'await_ssm_cert_then_score');
        return;
    }
    if (['await_bank_doc_then_reg', 'await_bank_doc_then_score', 'await_bank_doc'].includes(state)) {
        await handleBankVerification(phone, userRef, userData, buffer, mimeType, state);
        return;
    }

    // Triage — SSM cert or payment?
    const triagePrompt = `Analyze this image carefully. What type of document is it?
Return ONLY valid JSON, nothing else:
{"doc_type": "ssm_cert" | "payment" | "other", "confidence": "high" | "medium" | "low"}
"ssm_cert" = Malaysian SSM business registration certificate, or NIB/DTI equivalent
"payment" = receipt, invoice, bank transfer, payment screenshot, QR payment confirmation
"other" = anything else`;

    let triageData = { doc_type: 'other' };
    try { triageData = parseJson(await genTextWithImage(triagePrompt, buffer, mimeType)); } catch { /* fallback */ }

    if (triageData.doc_type === 'ssm_cert') {
        await handleSsmVerification(phone, userRef, userData, buffer, mimeType, false);
        return;
    }

    // Payment screenshot flow
    const payPrompt = `Analyze this image. Is this a payment screenshot or receipt?
Return ONLY valid JSON nothing else:
{"amount": number, "item": "string", "is_payment": true}
If not payment: {"amount": 0, "item": "unknown", "is_payment": false}`;

    let payData = { amount: 0, is_payment: false };
    try { payData = parseJson(await genTextWithImage(payPrompt, buffer, mimeType)); } catch { /* fallback */ }

    if (payData.is_payment && payData.amount > 0) {
        await userRef.update({
            sales: FieldValue.arrayUnion({ amount: payData.amount, item: payData.item || 'jualan', date: today(), source: 'screenshot' }),
        });
        const cur = getCurrency(userData);
        await sendMessage(phone, lang === 'bm'
            ? `✅ *Bayaran direkod dari gambar!*\n\n💵 Jumlah: ${cur}${payData.amount}\n📦 Item: ${payData.item || 'Jualan'}\n\nTaip *MENU* untuk kembali`
            : `✅ *Payment recorded from image!*\n\n💵 Amount: ${cur}${payData.amount}\n📦 Item: ${payData.item || 'Sale'}\n\nType *MENU* to go back`
        );
    } else {
        await sendMessage(phone, lang === 'bm'
            ? 'Saya tidak dapat mengesan bayaran dalam gambar ini.\nCuba hantar screenshot yang lebih jelas.\n\n💡 _Jika ini sijil SSM/pendaftaran perniagaan, taip *VERIFY* untuk sahkan perniagaan awak._\n\nTaip *MENU* untuk kembali'
            : 'I could not detect a payment in this image.\nPlease send a clearer screenshot.\n\n💡 _If this is your SSM/business registration cert, type *VERIFY* to verify your business._\n\nType *MENU* to go back'
        );
    }
}

async function handleSsmVerification(phone, userRef, userData, buffer, mimeType, afterScore = false) {
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const regType = cc.registration;
    const registeredBizName = (userData.business_name || '').trim().toLowerCase();

    const extractPrompt = `You are verifying a business registration certificate from ${cc.name}. The registration body is ${regType}.
Extract the following from this certificate image. Return ONLY valid JSON, nothing else:
{"is_registration_cert": true or false, "reg_number": "string", "business_name": "string", "owner_name": "string or null", "reg_date": "string or null", "status": "active or unknown", "cert_type": "string"}
If this is NOT a ${regType} registration certificate, set "is_registration_cert": false.`;

    let certData = { is_registration_cert: false };
    try { certData = parseJson(await genTextWithImage(extractPrompt, buffer, mimeType)); } catch { /* fallback */ }

    if (!certData.is_registration_cert) {
        await sendMessage(phone, lang === 'bm'
            ? `❌ *Dokumen tidak dikenali sebagai sijil ${regType}.*\n\nSila hantar gambar sijil pendaftaran perniagaan ${regType} yang jelas.\n\nTaip *MENU* untuk kembali`
            : `❌ *Document not recognised as a ${regType} registration certificate.*\n\nPlease send a clear photo of your ${regType} business registration certificate.\n\nType *MENU* to go back`
        );
        return;
    }

    const certBizName = (certData.business_name || '').trim().toLowerCase();
    const regNumber = certData.reg_number || 'N/A';
    const regDate = certData.reg_date || 'N/A';
    const certType = certData.cert_type || regType;
    const ownerOnCert = certData.owner_name || '';

    // Fuzzy name match
    const stopwords = new Set(['sdn','bhd','enterprise','trading','the','and','co','sdn.','bhd.']);
    const regWords = new Set(registeredBizName.split(' ').filter(w => !stopwords.has(w)));
    const certWords = new Set(certBizName.split(' ').filter(w => !stopwords.has(w)));
    let nameMatch = true;
    if (regWords.size > 0 && certWords.size > 0) {
        const overlap = [...regWords].filter(w => certWords.has(w)).length;
        nameMatch = overlap / Math.max(regWords.size, 1) >= 0.5;
    }

    await userRef.update({
        has_ssm: 'yes', ssm_verified: true, ssm_reg_number: regNumber,
        ssm_cert_type: certType, ssm_reg_date: regDate,
        ssm_cert_business_name: certData.business_name || '',
        ssm_name_match: nameMatch, ssm_verified_date: today(), state: 'menu',
    });

    const matchIcon = nameMatch ? '✅' : '⚠️';
    const matchBm = nameMatch ? 'Nama perniagaan *sepadan*!' : 'Nama perniagaan *tidak sepadan sepenuhnya* — kemaskini jika perlu.';
    const matchEn = nameMatch ? 'Business name *matches* your profile!' : "Business name *doesn't fully match* — please update if needed.";
    const ownerLine = ownerOnCert ? (lang === 'bm' ? `👤 Nama Pemilik: ${ownerOnCert}\n` : `👤 Owner Name: ${ownerOnCert}\n`) : '';
    const nextLine = afterScore
        ? (lang === 'bm' ? '⏳ Sedang mengira skor kredit awak...' : '⏳ Calculating your credit score...')
        : (lang === 'bm' ? 'Taip *SKOR* untuk lihat skor kredit terbaru awak\nTaip *MENU* untuk kembali' : 'Type *SCORE* to see your updated credit score\nType *MENU* to go back');

    await sendMessage(phone, lang === 'bm'
        ? `🎉 *Sijil ${regType} Disahkan!*\n\n━━━━━━━━━━━━━━━━━━━━\n📋 *Butiran Sijil*\n━━━━━━━━━━━━━━━━━━━━\n🏢 Nama Perniagaan: *${certData.business_name || 'N/A'}*\n🔢 No. Pendaftaran: *${regNumber}*\n📄 Jenis: ${certType}\n📅 Tarikh Daftar: ${regDate}\n${ownerLine}━━━━━━━━━━━━━━━━━━━━\n${matchIcon} ${matchBm}\n\n🏅 *+10 mata kredit* untuk pengesahan sijil!\n\n${nextLine}`
        : `🎉 *${regType} Certificate Verified!*\n\n━━━━━━━━━━━━━━━━━━━━\n📋 *Certificate Details*\n━━━━━━━━━━━━━━━━━━━━\n🏢 Business Name: *${certData.business_name || 'N/A'}*\n🔢 Registration No: *${regNumber}*\n📄 Type: ${certType}\n📅 Registration Date: ${regDate}\n${ownerLine}━━━━━━━━━━━━━━━━━━━━\n${matchIcon} ${matchEn}\n\n🏅 *+10 credit points* for certificate verification!\n\n${nextLine}`
    );

    if (afterScore) await generateCreditScore(phone, userRef);
}

async function handleBankVerification(phone, userRef, userData, buffer, mimeType, mode) {
    const lang = userData.language || 'bm';
    const ownerName = (userData.owner_name || '').trim().toLowerCase();

    const triagePrompt = `Analyze this image. What type of financial document is it?
Return ONLY valid JSON:
{"doc_type": "bank_statement" | "passbook" | "online_banking" | "e_wallet" | "other", "confidence": "high" | "medium" | "low"}`;

    let triageData = { doc_type: 'other' };
    try { triageData = parseJson(await genTextWithImage(triagePrompt, buffer, mimeType)); } catch { /* fallback */ }

    const docType = triageData.doc_type || 'other';
    if (docType === 'other') {
        await sendMessage(phone, lang === 'bm'
            ? '❌ *Dokumen tidak dikenali sebagai dokumen kewangan.*\n\nSila hantar:\n• Screenshot penyata bank\n• Gambar buku bank (passbook)\n• Screenshot online banking / e-wallet\n\nTaip *LANGKAU* jika tidak mahu sahkan sekarang'
            : '❌ *Document not recognised as a financial document.*\n\nPlease send:\n• Bank statement screenshot\n• Bank book (passbook) photo\n• Online banking / e-wallet screenshot\n\nType *SKIP* if you don\'t want to verify now'
        );
        return;
    }

    const extractPrompts = {
        bank_statement: 'Extract from this bank statement. Return ONLY valid JSON:\n{"is_bank_document": true, "account_holder_name": "name as printed", "bank_name": "bank name", "account_number_last4": "last 4 digits or null", "business_name_on_account": "business name if present else null", "doc_type": "statement"}',
        passbook: 'Extract from this bank passbook. Return ONLY valid JSON:\n{"is_bank_document": true, "account_holder_name": "name on passbook", "bank_name": "bank name", "account_number_last4": "last 4 digits or null", "business_name_on_account": null, "doc_type": "passbook"}',
        online_banking: 'Extract from this online/mobile banking screenshot. Return ONLY valid JSON:\n{"is_bank_document": true, "account_holder_name": "name shown in app", "bank_name": "bank or app name", "account_number_last4": "last 4 digits or null", "business_name_on_account": null, "doc_type": "online_banking"}',
        e_wallet: 'Extract from this e-wallet screenshot. Return ONLY valid JSON:\n{"is_bank_document": true, "account_holder_name": "registered name", "bank_name": "wallet name (TNG/GoPay/GCash/Maya/Dana)", "account_number_last4": "last 4 of phone/account or null", "business_name_on_account": null, "doc_type": "e_wallet"}',
    };

    let bankData = { is_bank_document: false };
    try {
        bankData = parseJson(await genTextWithImage(extractPrompts[docType] || extractPrompts.online_banking, buffer, mimeType));
        bankData.is_bank_document = true;
    } catch { /* fallback */ }

    if (!bankData.is_bank_document) {
        await sendMessage(phone, lang === 'bm' ? '❌ Gagal membaca dokumen. Sila cuba hantar gambar yang lebih jelas.\n\nTaip *LANGKAU* untuk langkau' : '❌ Failed to read document. Please try a clearer image.\n\nType *SKIP* to skip');
        return;
    }

    const holderName = (bankData.account_holder_name || '').trim().toLowerCase();
    const bizOnAcc = (bankData.business_name_on_account || '').trim().toLowerCase();
    const bankName = bankData.bank_name || 'N/A';
    const accLast4 = bankData.account_number_last4 || '';

    // Fuzzy name match
    const stopwords = new Set(['sdn','bhd','enterprise','trading','bin','binti','bte','mr','ms','mrs']);
    const ownerWords = new Set(ownerName.split(' ').filter(w => !stopwords.has(w)));
    const holderWords = new Set(holderName.split(' ').filter(w => !stopwords.has(w)));
    const bizWords = new Set(bizOnAcc.split(' ').filter(w => !stopwords.has(w)));
    let nameMatch = true;
    if (ownerWords.size > 0 && (holderWords.size > 0 || bizWords.size > 0)) {
        const ov1 = [...ownerWords].filter(w => holderWords.has(w)).length / Math.max(ownerWords.size, 1);
        const ov2 = bizWords.size > 0 ? [...ownerWords].filter(w => bizWords.has(w)).length / Math.max(ownerWords.size, 1) : 0;
        nameMatch = Math.max(ov1, ov2) >= 0.5;
    }

    await userRef.update({
        has_bank_account: 'yes', bank_verified: true, bank_name: bankName,
        bank_holder_name: bankData.account_holder_name || '',
        bank_acc_last4: accLast4, bank_name_match: nameMatch,
        bank_verified_date: today(),
    });

    const matchIcon = nameMatch ? '✅' : '⚠️';
    const matchBm = nameMatch ? 'Nama *sepadan* dengan profil awak!' : 'Nama *tidak sepadan sepenuhnya* — kemaskini profil jika perlu.';
    const matchEn = nameMatch ? 'Name *matches* your profile!' : "Name *doesn't fully match* — update profile if needed.";
    const accLine = accLast4 ? (lang === 'bm' ? `🔢 No. Akaun: ****${accLast4}\n` : `🔢 Account: ****${accLast4}\n`) : '';
    const docLabelBm = { statement: 'Penyata Bank', passbook: 'Buku Bank', online_banking: 'Online Banking', e_wallet: 'E-Wallet' }[docType] || 'Dokumen Bank';
    const docLabelEn = { statement: 'Bank Statement', passbook: 'Passbook', online_banking: 'Online Banking', e_wallet: 'E-Wallet' }[docType] || 'Bank Document';

    await sendMessage(phone, lang === 'bm'
        ? `🎉 *Akaun Bank Disahkan!*\n\n━━━━━━━━━━━━━━━━━━━━\n🏦 Bank: *${bankName}*\n👤 Pemegang: *${bankData.account_holder_name || 'N/A'}*\n${accLine}📄 Jenis: ${docLabelBm}\n━━━━━━━━━━━━━━━━━━━━\n${matchIcon} ${matchBm}\n\n🏅 *+10 mata kredit penuh* untuk akaun bank yang disahkan!\n`
        : `🎉 *Bank Account Verified!*\n\n━━━━━━━━━━━━━━━━━━━━\n🏦 Bank: *${bankName}*\n👤 Holder: *${bankData.account_holder_name || 'N/A'}*\n${accLine}📄 Type: ${docLabelEn}\n━━━━━━━━━━━━━━━━━━━━\n${matchIcon} ${matchEn}\n\n🏅 *+10 full credit points* for verified bank account!\n`
    );

    // Route based on mode
    if (mode === 'await_bank_doc_then_reg') {
        const cc = getCountry((await userRef.get()).data());
        await userRef.update({ state: 'credit_q3' });
        await sendMessage(phone, lang === 'bm'
            ? `\n⏩ Soalan seterusnya...\n\nSoalan 3️⃣: ${cc.reg_question_bm}\n_(Balas: Ya / Tidak)_`
            : `\n⏩ Next question...\n\nQuestion 3️⃣: ${cc.reg_question_en}\n_(Reply: Yes / No)_`
        );
    } else {
        await userRef.update({ state: 'menu' });
        await sendMessage(phone, lang === 'bm' ? 'Taip *SKOR* untuk lihat skor kredit terbaru awak\nTaip *MENU* untuk kembali' : 'Type *SCORE* to see your updated credit score\nType *MENU* to go back');
    }
}

async function transcribeAudio(phone, audioId) {
    const { handleText } = require('./text');
    const userRef = db.collection('users').doc(phone);
    const snap = await userRef.get();
    const lang = snap.exists ? (snap.data().language || 'bm') : 'bm';

    await sendMessage(phone, lang === 'bm' ? '🎙️ Nota suara diterima! Sedang proses...' : '🎙️ Voice note received! Processing...');

    let buffer, mimeType;
    try {
        ({ buffer, mimeType } = await downloadImage(audioId));
    } catch (err) {
        console.error('[transcribeAudio] download failed:', err.message);
        await sendMessage(phone, lang === 'bm' ? '❌ Gagal proses nota suara. Cuba lagi.' : '❌ Failed to process voice note. Try again.');
        return;
    }

    const prompt = `Transcribe this audio message accurately. Output ONLY the spoken words, no explanations or punctuation changes. Preserve the original language (Malay or English).`;
    let transcript = '';
    try {
        transcript = await genTextWithAudio(prompt, buffer, mimeType || 'audio/ogg');
    } catch (err) {
        console.error('[transcribeAudio] transcription failed:', err.message);
        await sendMessage(phone, lang === 'bm' ? '❌ Gagal transkripsi suara. Cuba taip teks.' : '❌ Could not transcribe voice. Please type instead.');
        return;
    }

    transcript = transcript.trim();
    if (!transcript) {
        await sendMessage(phone, lang === 'bm' ? '❌ Tiada teks dikesan. Cuba lagi dengan lebih jelas.' : '❌ No speech detected. Try again more clearly.');
        return;
    }

    console.log(`[VOICE→TEXT] ${phone}: ${transcript}`);
    await handleText(phone, transcript);
}

module.exports = { handleImage, transcribeAudio };
