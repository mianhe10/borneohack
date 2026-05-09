const { db, FieldValue } = require('../db');
const { getCountry, getCurrency, isEnglish, today } = require('../config');
const { genText, parseJson } = require('../gemini');
const { sendMessage } = require('../send');
const handleMenu = require('./menu');
const { handleLogSale } = require('./sale');
const { handleAiChat } = require('./chat');
const { handleContentMenu, handleContentGenerate } = require('./content');
const { generateCreditScore } = require('../features/credit');
const { showProfile, showStoredData, showCertificate, showScoreBreakdown } = require('../features/profile');
const { showSalesSummary } = require('../features/summary');
const { showLoanChecklist, showLoanReferral } = require('../features/loan');

const YES = new Set(['ya', 'yes', 'y', 'sudah', 'ada', 'dah', 'yep', 'yup', 'ye', 'agree', 'setuju', 'ok']);
const NO  = new Set(['tidak', 'no', 'n', 'belum', 'tak', 'tiada', 'nope']);

async function handleText(phone, text) {
    const userRef = db.collection('users').doc(phone);
    const userSnap = await userRef.get();
    const textUpper = text.toUpperCase().trim();
    const lang = userSnap.exists ? (userSnap.data().language || 'bm') : 'bm';

    // ── Language toggle — works anytime ──
    if (textUpper === 'ENGLISH') {
        if (userSnap.exists) {
            await userRef.update({ language: 'en' });
            const fresh = (await userRef.get()).data();
            if (fresh.state === 'ask_consent') {
                await sendMessage(phone,
                    '👋 *Welcome to BizBuddy!*\n\n' +
                    "I'll help you build your business profile & credit score in 5 minutes.\n\n" +
                    '🔒 *Your Privacy & Data:*\n' +
                    '• BizBuddy stores your business data (name, sales, product) to build your credit profile.\n' +
                    '• Your data *will not be shared* with any party without your consent.\n' +
                    '• You can delete all your data anytime by typing *RESET*.\n\n' +
                    'Type *AGREE* to continue'
                );
                return;
            }
        }
        await sendMessage(phone,
            '🌐 *Language switched to English!*\n\nAll responses will now be in English.\nType *BM* to switch back to Bahasa Malaysia.'
        );
        return;
    }

    if (textUpper === 'BM') {
        if (userSnap.exists) {
            await userRef.update({ language: 'bm' });
            const fresh = (await userRef.get()).data();
            if (fresh.state === 'ask_consent') {
                await sendMessage(phone,
                    '👋 *Selamat datang ke BizBuddy!*\n\n' +
                    'Saya akan bantu awak bina profil perniagaan & skor kredit dalam masa 5 minit.\n\n' +
                    '🔒 *Privasi & Data Awak:*\n' +
                    '• BizBuddy menyimpan data perniagaan awak (nama, jualan, produk) untuk membina profil kredit.\n' +
                    '• Data awak *tidak akan dikongsi* dengan mana-mana pihak tanpa kebenaran awak.\n' +
                    '• Awak boleh padam semua data bila-bila masa dengan taip *RESET*.\n\n' +
                    'Taip *SETUJU* untuk teruskan'
                );
                return;
            }
        }
        await sendMessage(phone,
            '🌐 *Bahasa ditukar ke Bahasa Malaysia!*\n\nSemua respons akan dalam Bahasa Malaysia.\nTaip *ENGLISH* untuk tukar ke Bahasa Inggeris.'
        );
        return;
    }

    // ── New user ──
    if (!userSnap.exists) {
        await userRef.set({ state: 'ask_consent', sales: [], language: 'bm' });
        await sendMessage(phone,
            '👋 *Selamat datang ke BizBuddy!*\n\n' +
            'Saya akan bantu awak bina profil perniagaan & skor kredit dalam masa 5 minit.\n\n' +
            '🔒 *Privasi & Data Awak:*\n' +
            '• BizBuddy menyimpan data perniagaan awak (nama, jualan, produk) untuk membina profil kredit.\n' +
            '• Data awak *tidak akan dikongsi* dengan mana-mana pihak tanpa kebenaran awak.\n' +
            '• Awak boleh padam semua data bila-bila masa dengan taip *RESET*.\n\n' +
            '💡 _Tip: Taip ENGLISH untuk tukar bahasa_\n\n' +
            'Taip *SETUJU* untuk teruskan\nTaip *ENGLISH* dahulu jika mahu tukar bahasa'
        );
        return;
    }

    const userData = userSnap.data();
    const state = userData.state || 'menu';

    // ── Global commands ──
    if (textUpper === 'RESET') {
        await userRef.delete();
        await sendMessage(phone,
            lang === 'bm'
                ? '🔄 *Profil awak telah dipadam.*\n\nTaip *HAI* untuk mulakan semula.'
                : '🔄 *Your profile has been deleted.*\n\nType *HI* to start again.'
        );
        return;
    }

    if (textUpper === 'PROFIL' || textUpper === 'PROFILE') { await showProfile(phone, userRef); return; }
    if (textUpper === 'SIJIL' || textUpper === 'CERTIFICATE') { await showCertificate(phone, userRef); return; }
    if (textUpper === 'PINJAMAN' || textUpper === 'LOAN') { await showLoanChecklist(phone, userRef); return; }
    if (textUpper === 'DATA') { await showStoredData(phone, userRef); return; }
    if (textUpper === 'BREAKDOWN' || textUpper === 'PECAHAN') { await showScoreBreakdown(phone, userRef); return; }
    if (textUpper === 'RUJUK' || textUpper === 'REFER') { await showLoanReferral(phone, userRef); return; }

    if (textUpper === 'KEMASKINI' || textUpper === 'UPDATE') {
        await userRef.update({ state: 'credit_q1' });
        await sendMessage(phone,
            lang === 'bm'
                ? '🔄 *Kemaskini Maklumat Kredit*\n\nSoalan 1️⃣: Berapa lama perniagaan awak dah beroperasi?\n_(Contoh: 3 bulan, 1 tahun, 5 tahun)_'
                : '🔄 *Update Credit Info*\n\nQuestion 1️⃣: How long has your business been operating?\n_(Example: 3 months, 1 year, 5 years)_'
        );
        return;
    }

    if (textUpper === 'BATAL' || textUpper === 'CANCEL') {
        if (state === 'await_ssm_cert') {
            await userRef.update({ state: 'menu' });
            await sendMessage(phone,
                lang === 'bm' ? '❌ Pengesahan SSM dibatalkan.\n\nTaip *MENU* untuk kembali.' : '❌ SSM verification cancelled.\n\nType *MENU* to go back.'
            );
        } else {
            await sendMessage(phone,
                lang === 'bm' ? 'Tiada tindakan untuk dibatalkan.\n\nTaip *MENU* untuk kembali.' : 'Nothing to cancel.\n\nType *MENU* to go back.'
            );
        }
        return;
    }

    // ── SKIP ──
    if (textUpper === 'LANGKAU' || textUpper === 'SKIP') {
        if (state === 'content_generate') {
            // fall through to content handler
        } else if (state === 'await_ssm_cert_then_score') {
            await userRef.update({ state: 'menu' });
            await sendMessage(phone, lang === 'bm' ? '⏭️ Pengesahan SSM dilangkau (7 mata, bukan 10).\n\n⏳ Sedang mengira skor kredit awak...' : '⏭️ SSM verification skipped (7 pts instead of 10).\n\n⏳ Calculating your credit score...');
            await generateCreditScore(phone, userRef);
            return;
        } else if (state === 'await_ssm_cert') {
            await userRef.update({ state: 'menu' });
            await sendMessage(phone, lang === 'bm' ? '⏭️ Pengesahan SSM dilangkau.\n\nTaip *MENU* untuk kembali' : '⏭️ SSM verification skipped.\n\nType *MENU* to go back');
            return;
        } else if (state === 'await_bank_doc_then_reg') {
            const cc = getCountry((await userRef.get()).data());
            await userRef.update({ state: 'credit_q3' });
            await sendMessage(phone, lang === 'bm' ? `⏭️ Pengesahan bank dilangkau (7 mata, bukan 10).\n\nSoalan 3️⃣: ${cc.reg_question_bm}\n_(Balas: Ya / Tidak)_` : `⏭️ Bank verification skipped (7 pts instead of 10).\n\nQuestion 3️⃣: ${cc.reg_question_en}\n_(Reply: Yes / No)_`);
            return;
        } else if (state === 'await_bank_doc_then_score' || state === 'await_bank_doc') {
            await userRef.update({ state: 'menu' });
            await sendMessage(phone, lang === 'bm' ? '⏭️ Pengesahan bank dilangkau (7 mata, bukan 10).\n\nTaip *MENU* untuk kembali' : '⏭️ Bank verification skipped (7 pts instead of 10).\n\nType *MENU* to go back');
            return;
        } else {
            await sendMessage(phone, lang === 'bm' ? 'Tiada tindakan untuk dilangkau.\n\nTaip *MENU* untuk kembali.' : 'Nothing to skip.\n\nType *MENU* to go back.');
            return;
        }
    }

    // ── State machine ──
    if (state === 'ask_consent') {
        if (YES.has(textUpper.toLowerCase())) {
            await userRef.update({ state: 'ask_country', consent: true, consent_date: new Date().toISOString() });
            await sendMessage(phone,
                lang === 'bm'
                    ? '✅ *Terima kasih!* Data awak dilindungi.\n\n🌏 *Negara mana awak beroperasi?*\n\n1️⃣ 🇲🇾 Malaysia\n2️⃣ 🇮🇩 Indonesia\n3️⃣ 🇵🇭 Philippines\n\n_Balas dengan nombor pilihan_'
                    : '✅ *Thank you!* Your data is protected.\n\n🌏 *Which country do you operate in?*\n\n1️⃣ 🇲🇾 Malaysia\n2️⃣ 🇮🇩 Indonesia\n3️⃣ 🇵🇭 Philippines\n\n_Reply with your choice number_'
            );
        } else {
            await sendMessage(phone,
                lang === 'bm'
                    ? '⚠️ Awak perlu bersetuju untuk menggunakan BizBuddy.\n\nTaip *SETUJU* untuk teruskan\nTaip *ENGLISH* untuk tukar bahasa dahulu'
                    : '⚠️ You need to agree to use BizBuddy.\n\nType *AGREE* to continue\nType *BM* to switch to Bahasa Malaysia first'
            );
        }
        return;
    }

    if (state === 'ask_country') {
        const countryMap = { '1': 'MY', '2': 'ID', '3': 'PH' };
        const code = countryMap[textUpper];
        if (code) {
            const { COUNTRY_CONFIG } = require('../config');
            const cc = COUNTRY_CONFIG[code];
            await userRef.update({ country: code, state: 'ask_state' });
            const stateList = Object.entries(cc.states)
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                .map(([k, v]) => `${k}️⃣ ${v}`).join('\n');
            const max = Object.keys(cc.states).length;
            await sendMessage(phone,
                lang === 'bm'
                    ? `${cc.flag} *${cc.name} dipilih!*\n\n📍 *Di negeri/wilayah mana awak beroperasi?*\n\n${stateList}\n\n_Balas dengan nombor (1-${max})_`
                    : `${cc.flag} *${cc.name} selected!*\n\n📍 *Which state/region do you operate in?*\n\n${stateList}\n\n_Reply with a number (1-${max})_`
            );
        } else {
            await sendMessage(phone,
                lang === 'bm' ? 'Sila pilih 1-3:\n1️⃣ 🇲🇾 Malaysia\n2️⃣ 🇮🇩 Indonesia\n3️⃣ 🇵🇭 Philippines' : 'Please choose 1-3:\n1️⃣ 🇲🇾 Malaysia\n2️⃣ 🇮🇩 Indonesia\n3️⃣ 🇵🇭 Philippines'
            );
        }
        return;
    }

    if (state === 'ask_state') {
        const freshData = (await userRef.get()).data();
        const cc = getCountry(freshData);
        const stateName = cc.states[textUpper];
        if (stateName) {
            await userRef.update({ user_state: stateName, state: 'ask_owner_name' });
            await sendMessage(phone,
                lang === 'bm'
                    ? `📍 *${stateName}* — noted!\n\nMata wang: ${cc.currency}\nProgram pinjaman: ${cc.loan_program}\nPendaftaran: ${cc.registration}\n\nJom mulakan! 🚀\n\nSoalan 1️⃣: Apa *nama awak*?`
                    : `📍 *${stateName}* — noted!\n\nCurrency: ${cc.currency}\nLoan program: ${cc.loan_program}\nRegistration: ${cc.registration}\n\nLet's get started! 🚀\n\nQuestion 1️⃣: What is your *name*?`
            );
        } else {
            const max = Object.keys(cc.states).length;
            await sendMessage(phone, lang === 'bm' ? `Sila pilih nombor 1-${max} sahaja.` : `Please choose a number from 1-${max}.`);
        }
        return;
    }

    if (state === 'ask_owner_name') {
        await userRef.update({ owner_name: text, state: 'ask_business_name' });
        await sendMessage(phone,
            lang === 'bm'
                ? `Hai *${text}*! 😊\n\nSoalan 2️⃣: Apa *nama perniagaan* awak?\n_(Contoh: Kuih Farah, Tudung Siti, Kedai Ahmad)_`
                : `Hi *${text}*! 😊\n\nQuestion 2️⃣: What is your *business name*?\n_(Example: Farah Kuih, Siti Hijab, Ahmad Store)_`
        );
        return;
    }

    if (state === 'ask_business_name') {
        await userRef.update({ business_name: text, state: 'ask_product' });
        await sendMessage(phone,
            lang === 'bm'
                ? `*${text}* — nama yang menarik! 🌟\n\nSoalan 3️⃣: Apa yang awak *jual atau tawarkan*?\n_(Contoh: kuih tradisional, tudung, servis gunting rambut)_`
                : `*${text}* — great name! 🌟\n\nQuestion 3️⃣: What do you *sell or offer*?\n_(Example: traditional kuih, hijab, haircut service)_`
        );
        return;
    }

    if (state === 'ask_product') {
        let productClean = text;
        try {
            const extractPrompt = `Extract ONLY the product or service keywords from this text: "${text}"\nReturn a short comma-separated list of products/services, maximum 5 words total.\nDo NOT include filler words like "kedai saya", "I sell", "my shop is", "yang menjual" etc.\nReturn ONLY the extracted keywords, nothing else.`;
            const res = await genText(extractPrompt);
            if (res.length >= 2 && res.length <= 60) productClean = res.replace(/^["']|["']$/g, '');
        } catch { /* fallback to raw text */ }

        await userRef.update({ product: productClean, state: 'ask_revenue' });
        const cc = getCountry((await userRef.get()).data());
        await sendMessage(phone,
            lang === 'bm'
                ? `*${productClean}* — menarik! 🛍️\n\nSoalan 4️⃣: Dalam sebulan, lebih kurang berapa *pendapatan* awak?\n_(Contoh: ${cc.income_examples})_`
                : `*${productClean}* — interesting! 🛍️\n\nQuestion 4️⃣: Roughly how much is your *monthly income*?\n_(Example: ${cc.income_examples})_`
        );
        return;
    }

    if (state === 'ask_revenue') {
        const d = userData;
        await userRef.update({ monthly_revenue: text, state: 'menu', registered_date: today() });
        await sendMessage(phone,
            lang === 'bm'
                ? `🎉 *Profil perniagaan awak dah siap, ${d.owner_name}!*\n\n━━━━━━━━━━━━━━━━━━━━\n📋 *PROFIL PERNIAGAAN AWAK*\n━━━━━━━━━━━━━━━━━━━━\n👤 Nama: ${d.owner_name}\n🏪 Perniagaan: ${d.business_name}\n📦 Produk: ${d.product}\n💵 Pendapatan: ${text}/bulan\n📅 Tarikh Daftar: ${today()}\n━━━━━━━━━━━━━━━━━━━━\n\nTaip *MENU* untuk mula rekod jualan awak! 🚀`
                : `🎉 *Your business profile is ready, ${d.owner_name}!*\n\n━━━━━━━━━━━━━━━━━━━━\n📋 *YOUR BUSINESS PROFILE*\n━━━━━━━━━━━━━━━━━━━━\n👤 Name: ${d.owner_name}\n🏪 Business: ${d.business_name}\n📦 Product: ${d.product}\n💵 Income: ${text}/month\n📅 Registered: ${today()}\n━━━━━━━━━━━━━━━━━━━━\n\nType *MENU* to start recording your sales! 🚀`
        );
        return;
    }

    if (state === 'menu') {
        const MENU_CMDS = new Set(['1','2','3','4','5','6','7','8','9','MENU','PROFIL','PROFILE','SIJIL','CERTIFICATE','PINJAMAN','LOAN','RESET','DATA','BREAKDOWN','PECAHAN','RUJUK','REFER','KEMASKINI','UPDATE','HAI','HI','HELLO','START']);
        if (MENU_CMDS.has(textUpper)) {
            await handleMenu(phone, text, userRef);
        } else {
            const { smartHandle } = require('./smart');
            await smartHandle(phone, text, userRef);
        }
        return;
    }

    if (state === 'log_sale') { await handleLogSale(phone, text, userRef); return; }
    if (state === 'ai_chat') { await handleAiChat(phone, text, userRef); return; }
    if (state === 'content_menu') { await handleContentMenu(phone, text, userRef); return; }
    if (state === 'content_generate') { await handleContentGenerate(phone, text, userRef); return; }

    if (state === 'credit_confirm') {
        if (YES.has(textUpper.toLowerCase())) {
            await userRef.update({ state: 'menu' });
            await sendMessage(phone, lang === 'bm' ? '⏳ Sedang mengira skor kredit awak...' : '⏳ Calculating your credit score...');
            await generateCreditScore(phone, userRef);
        } else if (NO.has(textUpper.toLowerCase())) {
            await userRef.update({ state: 'credit_update_bank' });
            await sendMessage(phone, lang === 'bm' ? '🔄 *Kemaskini Maklumat*\n\nSoalan 1️⃣: Adakah awak ada *akaun bank perniagaan*?\n_(Balas: Ya / Tidak)_' : '🔄 *Update Info*\n\nQuestion 1️⃣: Do you have a *business bank account*?\n_(Reply: Yes / No)_');
        } else if (textUpper === 'MENU') {
            await userRef.update({ state: 'menu' });
            await handleMenu(phone, 'MENU', userRef);
        } else {
            await sendMessage(phone, lang === 'bm' ? 'Sila balas *YA* atau *TIDAK*\n\nYA → Jana skor terus\nTIDAK → Kemaskini maklumat\nMENU → Kembali' : 'Please reply *YES* or *NO*\n\nYES → Generate score now\nNO → Update info\nMENU → Go back');
        }
        return;
    }

    if (state === 'credit_update_bank') {
        const cc = getCountry(userData);
        if (YES.has(textUpper.toLowerCase())) {
            await userRef.update({ has_bank_account: 'yes', state: 'await_bank_doc_then_reg' });
            await sendMessage(phone, lang === 'bm'
                ? '🏦 *Sahkan Akaun Bank Awak*\n\nHantar screenshot atau gambar:\n• Penyata bank\n• Buku bank (passbook)\n• Online banking\n• E-wallet (TNG, GoPay, dll)\n\n✅ Pastikan *nama pemegang akaun* kelihatan.\n\n📸 *Hantar gambar sekarang*\n\nTaip *LANGKAU* untuk langkau (7 mata, bukan 10)'
                : '🏦 *Verify Your Bank Account*\n\nSend a screenshot or photo of:\n• Bank statement\n• Passbook\n• Online banking\n• E-wallet (TNG, GoPay, etc)\n\n✅ Make sure *account holder name* is visible.\n\n📸 *Send the image now*\n\nType *SKIP* to skip (7 pts instead of 10)'
            );
        } else if (NO.has(textUpper.toLowerCase())) {
            await userRef.update({ has_bank_account: 'no', state: 'credit_update_reg' });
            await sendMessage(phone, lang === 'bm' ? `✅ Dikemaskini!\n\nSoalan 2️⃣: ${cc.reg_question_bm}\n_(Balas: Ya / Tidak)_` : `✅ Updated!\n\nQuestion 2️⃣: ${cc.reg_question_en}\n_(Reply: Yes / No)_`);
        } else {
            await sendMessage(phone, lang === 'bm' ? '⚠️ Sila balas *Ya* atau *Tidak* sahaja.\n\nSoalan 1️⃣: Adakah awak ada *akaun bank perniagaan*?\n_(Balas: Ya / Tidak)_' : '⚠️ Please reply *Yes* or *No* only.\n\nQuestion 1️⃣: Do you have a *business bank account*?\n_(Reply: Yes / No)_');
        }
        return;
    }

    if (state === 'credit_update_reg') {
        const cc = getCountry(userData);
        if (YES.has(textUpper.toLowerCase())) {
            await userRef.update({ has_ssm: 'yes', state: 'await_ssm_cert_then_score' });
            await sendMessage(phone, lang === 'bm'
                ? `✅ Bagus! Awak ada ${cc.registration}.\n\n📄 *Hantar gambar sijil ${cc.registration} awak untuk pengesahan.*\n\nIni membantu meningkatkan skor kredit awak!\n\n✅ Pastikan gambar jelas dan nombor pendaftaran kelihatan.\n\n📸 *Hantar gambar sijil ${cc.registration} sekarang*\n\nTaip *LANGKAU* jika tidak mahu sahkan sekarang`
                : `✅ Great! You have ${cc.registration}.\n\n📄 *Please send a photo of your ${cc.registration} certificate to verify.*\n\nThis helps boost your credit score!\n\n✅ Make sure the image is clear and registration number is visible.\n\n📸 *Send your ${cc.registration} certificate image now*\n\nType *SKIP* if you don't want to verify now`
            );
        } else if (NO.has(textUpper.toLowerCase())) {
            await userRef.update({ has_ssm: 'no', state: 'menu' });
            await sendMessage(phone, lang === 'bm' ? '⏳ Sedang mengira skor kredit awak...' : '⏳ Calculating your credit score...');
            await generateCreditScore(phone, userRef);
        } else {
            await sendMessage(phone, lang === 'bm' ? `⚠️ Sila balas *Ya* atau *Tidak* sahaja.\n\n${cc.reg_question_bm}\n_(Balas: Ya / Tidak)_` : `⚠️ Please reply *Yes* or *No* only.\n\n${cc.reg_question_en}\n_(Reply: Yes / No)_`);
        }
        return;
    }

    if (state === 'credit_q1') {
        await userRef.update({ biz_age: text, state: 'credit_q2' });
        await sendMessage(phone, lang === 'bm' ? '✅ Noted!\n\nSoalan 2️⃣: Adakah awak ada *akaun bank perniagaan*?\n_(Balas: Ya / Tidak)_' : '✅ Noted!\n\nQuestion 2️⃣: Do you have a *business bank account*?\n_(Reply: Yes / No)_');
        return;
    }

    if (state === 'credit_q2') {
        const cc = getCountry(userData);
        if (YES.has(textUpper.toLowerCase())) {
            await userRef.update({ has_bank_account: 'yes', state: 'await_bank_doc_then_reg' });
            await sendMessage(phone, lang === 'bm'
                ? '🏦 *Sahkan Akaun Bank Awak*\n\nHantar screenshot atau gambar:\n• Penyata bank\n• Buku bank (passbook)\n• Online banking\n• E-wallet (TNG, GoPay, dll)\n\n✅ Pastikan *nama pemegang akaun* kelihatan.\n\n📸 *Hantar gambar sekarang*\n\nTaip *LANGKAU* untuk langkau (7 mata, bukan 10)'
                : '🏦 *Verify Your Bank Account*\n\nSend a screenshot or photo of:\n• Bank statement\n• Passbook\n• Online banking\n• E-wallet (TNG, GoPay, etc)\n\n✅ Make sure *account holder name* is visible.\n\n📸 *Send the image now*\n\nType *SKIP* to skip (7 pts instead of 10)'
            );
        } else if (NO.has(textUpper.toLowerCase())) {
            await userRef.update({ has_bank_account: 'no', state: 'credit_q3' });
            await sendMessage(phone, lang === 'bm' ? `✅ Noted!\n\nSoalan 3️⃣: ${cc.reg_question_bm}\n_(Balas: Ya / Tidak)_` : `✅ Noted!\n\nQuestion 3️⃣: ${cc.reg_question_en}\n_(Reply: Yes / No)_`);
        } else {
            await sendMessage(phone, lang === 'bm' ? '⚠️ Sila balas *Ya* atau *Tidak* sahaja.\n\nSoalan 2️⃣: Adakah awak ada *akaun bank perniagaan*?\n_(Balas: Ya / Tidak)_' : '⚠️ Please reply *Yes* or *No* only.\n\nQuestion 2️⃣: Do you have a *business bank account*?\n_(Reply: Yes / No)_');
        }
        return;
    }

    if (state === 'credit_q3') {
        const cc = getCountry(userData);
        if (YES.has(textUpper.toLowerCase())) {
            await userRef.update({ has_ssm: 'yes', state: 'await_ssm_cert_then_score' });
            await sendMessage(phone, lang === 'bm'
                ? `✅ Bagus! Awak ada ${cc.registration}.\n\n📄 *Hantar gambar sijil ${cc.registration} awak untuk pengesahan.*\n\nIni membantu meningkatkan skor kredit awak!\n\n📸 *Hantar gambar sijil ${cc.registration} sekarang*\n\nTaip *LANGKAU* jika tidak mahu sahkan sekarang`
                : `✅ Great! You have ${cc.registration}.\n\n📄 *Please send a photo of your ${cc.registration} certificate to verify.*\n\nThis helps boost your credit score!\n\n📸 *Send your ${cc.registration} certificate image now*\n\nType *SKIP* if you don't want to verify now`
            );
        } else if (NO.has(textUpper.toLowerCase())) {
            await userRef.update({ has_ssm: 'no', state: 'menu' });
            await sendMessage(phone, lang === 'bm' ? '⏳ Sedang mengira skor kredit awak...' : '⏳ Calculating your credit score...');
            await generateCreditScore(phone, userRef);
        } else {
            await sendMessage(phone, lang === 'bm' ? `⚠️ Sila balas *Ya* atau *Tidak* sahaja.\n\n${cc.reg_question_bm}\n_(Balas: Ya / Tidak)_` : `⚠️ Please reply *Yes* or *No* only.\n\n${cc.reg_question_en}\n_(Reply: Yes / No)_`);
        }
        return;
    }
}

module.exports = { handleText };
