const { getCountry } = require('../config');
const { sendMessage } = require('../send');
const { generateCreditScore } = require('../features/credit');
const { showProfile, showCertificate, showScoreBreakdown } = require('../features/profile');
const { showSalesSummary } = require('../features/summary');
const { showLoanChecklist, showLoanReferral } = require('../features/loan');

async function handleMenu(phone, text, userRef) {
    const snap = await userRef.get();
    const userData = snap.data();
    const lang = userData.language || 'bm';
    const name = userData.owner_name || userData.business_name || 'Peniaga';
    const cc = getCountry(userData);
    const tUpper = text.toUpperCase().trim();

    if (['MENU', 'HI', 'HAI', 'HELLO', 'START'].includes(tUpper)) {
        if (lang === 'bm') {
            await sendMessage(phone,
                `📱 *Menu BizBuddy — ${name}*\n\n` +
                '1️⃣ Rekod Jualan\n' +
                '2️⃣ Jana Skor Kredit\n' +
                '3️⃣ Ringkasan Jualan\n' +
                '4️⃣ 🤖 Chat dengan AI\n\n' +
                '💡 Taip *PROFIL* untuk profil perniagaan\n' +
                '💡 Taip *SIJIL* untuk sijil kredit\n' +
                '💡 Taip *PECAHAN* untuk pecahan skor\n' +
                '💡 Taip *PINJAMAN* untuk semak kelayakan pinjaman\n' +
                '💡 Taip *RUJUK* untuk surat rujukan pinjaman\n' +
                '💡 Taip *ENGLISH* untuk tukar bahasa\n' +
                '🔒 Taip *DATA* untuk lihat data yang disimpan\n\n' +
                '_Balas dengan nombor pilihan_'
            );
        } else {
            await sendMessage(phone,
                `📱 *BizBuddy Menu — ${name}*\n\n` +
                '1️⃣ Record Sales\n' +
                '2️⃣ Generate Credit Score\n' +
                '3️⃣ Sales Summary\n' +
                '4️⃣ 🤖 Chat with AI\n\n' +
                '💡 Type *PROFILE* for business profile\n' +
                '💡 Type *CERTIFICATE* for credit certificate\n' +
                '💡 Type *BREAKDOWN* for score breakdown\n' +
                '💡 Type *LOAN* to check loan eligibility\n' +
                '💡 Type *REFER* for loan referral letter\n' +
                '💡 Type *BM* to switch to Bahasa Malaysia\n' +
                '🔒 Type *DATA* to view your stored data\n\n' +
                '_Reply with your choice number_'
            );
        }
        return;
    }

    if (tUpper === '1') {
        await userRef.update({ state: 'log_sale' });
        await sendMessage(phone, lang === 'bm'
            ? `💰 *Rekod Jualan*\n\nCeritakan jualan awak hari ini:\n\n✍️ *Taip* jualan awak\n_(Contoh: ${cc.sale_example_bm})_\n\n📸 *ATAU hantar gambar* resit/screenshot bayaran\n🎙️ *ATAU hantar nota suara*\n\n_(Taip MENU untuk kembali)_`
            : `💰 *Record Sales*\n\nTell me about your sales today:\n\n✍️ *Type* your sale\n_(Example: ${cc.sale_example_en})_\n\n📸 *OR send a photo* of receipt/payment screenshot\n🎙️ *OR send a voice note*\n\n_(Type MENU to go back)_`
        );
        return;
    }

    if (tUpper === '2') {
        const hasAnswers = userData.biz_age && userData.has_bank_account && userData.has_ssm;
        if (hasAnswers) {
            const bankVal = userData.has_bank_account || 'tidak';
            const ssmVal = userData.has_ssm || 'tidak';
            const bankVerified = userData.bank_verified || false;
            const ssmVerified = userData.ssm_verified || false;
            const fmtBm = (val, v) => val.toLowerCase().startsWith('y') || val.toLowerCase().startsWith('a') ? (v ? 'ya ✅ (disahkan)' : 'ya ⚠️ (belum disahkan)') : 'tidak';
            const fmtEn = (val, v) => val.toLowerCase().startsWith('y') || val.toLowerCase().startsWith('a') ? (v ? 'yes ✅ (verified)' : 'yes ⚠️ (unverified)') : 'no';
            await userRef.update({ state: 'credit_confirm' });
            await sendMessage(phone, lang === 'bm'
                ? `📊 *Jana Skor Kredit*\n\nMaklumat semasa awak:\n\n🏦 Akaun bank: *${fmtBm(bankVal, bankVerified)}*\n📝 ${cc.registration}: *${fmtBm(ssmVal, ssmVerified)}*\n\nAdakah maklumat ini masih *sama*?\n\nTaip *YA* → Jana skor terus\nTaip *TIDAK* → Kemaskini maklumat`
                : `📊 *Generate Credit Score*\n\nYour current info:\n\n🏦 Bank account: *${fmtEn(bankVal, bankVerified)}*\n📝 ${cc.registration}: *${fmtEn(ssmVal, ssmVerified)}*\n\nIs this info still *correct*?\n\nType *YES* → Generate score now\nType *NO* → Update info`
            );
        } else {
            await userRef.update({ state: 'credit_q1' });
            await sendMessage(phone, lang === 'bm'
                ? '📊 *Jana Skor Kredit*\n\nSaya perlu tanya 3 soalan untuk skor yang tepat.\n\nSoalan 1️⃣: Berapa lama perniagaan awak dah beroperasi?\n_(Contoh: 3 bulan, 1 tahun, 5 tahun)_'
                : '📊 *Generate Credit Score*\n\nI need to ask 3 questions for an accurate score.\n\nQuestion 1️⃣: How long has your business been operating?\n_(Example: 3 months, 1 year, 5 years)_'
            );
        }
        return;
    }

    if (tUpper === '3') { await showSalesSummary(phone, userRef); return; }

    if (tUpper === '4') {
        await userRef.update({ state: 'ai_chat' });
        await sendMessage(phone, lang === 'bm'
            ? `🤖 *BizBuddy AI*\n\nTanya apa sahaja! Contoh:\n• _"Ramalan jualan saya bulan depan?"_\n• _"Buatkan caption Instagram untuk ${userData.product || 'produk saya'}"_\n• _"Macam mana nak kurangkan kos?"_\n• _"Boleh saya eksport ke negara lain?"_\n• _"Macam mana nak mohon ${cc.loan_program}?"_\n\n_(Taip MENU untuk kembali)_`
            : `🤖 *BizBuddy AI*\n\nAsk me anything! Examples:\n• _"What's my sales forecast for next month?"_\n• _"Write an Instagram caption for ${userData.product || 'my product'}"_\n• _"How can I reduce my costs?"_\n• _"Can I export to other countries?"_\n• _"How do I apply for ${cc.loan_program}?"_\n\n_(Type MENU to go back)_`
        );
        return;
    }

    await sendMessage(phone, lang === 'bm' ? 'Taip *MENU* untuk lihat pilihan awak 😊' : 'Type *MENU* to see your options 😊');
}

module.exports = handleMenu;
