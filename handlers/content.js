const { genText } = require('../gemini');
const { sendMessage } = require('../send');
const handleMenu = require('./menu');

const CONTENT_TYPES = {
    '1': { key: 'instagram', bm: 'Caption Instagram', en: 'Instagram Caption' },
    '2': { key: 'whatsapp',  bm: 'Mesej WhatsApp Blast', en: 'WhatsApp Blast Message' },
    '3': { key: 'tiktok',    bm: 'Skrip Video TikTok', en: 'TikTok Video Script' },
    '4': { key: 'facebook',  bm: 'Post Facebook', en: 'Facebook Post' },
    '5': { key: 'promosi',   bm: 'Idea Promosi Musim', en: 'Seasonal Promotion Ideas' },
};

async function handleContentMenu(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const tUpper = text.toUpperCase().trim();

    if (tUpper === 'MENU') {
        await userRef.update({ state: 'menu' });
        await handleMenu(phone, 'MENU', userRef);
        return;
    }

    const ct = CONTENT_TYPES[tUpper];
    if (ct) {
        await userRef.update({ state: 'content_generate', content_type: ct.key });
        await sendMessage(phone, lang === 'bm'
            ? `✨ *${ct.bm}*\n\nBeritahu saya lebih detail!\n\nContoh:\n• _promosi raya minggu depan_\n• _jualan clearance stok lama_\n• _produk baru baru sampai_\n• _diskaun 20% untuk 10 pembeli pertama_\n\nAtau taip *SKIP* untuk jana kandungan umum.\n_(Taip MENU untuk kembali)_`
            : `✨ *${ct.en}*\n\nTell me more details!\n\nExamples:\n• _raya promotion next week_\n• _clearance sale old stock_\n• _new product just arrived_\n• _20% discount for first 10 buyers_\n\nOr type *SKIP* to generate general content.\n_(Type MENU to go back)_`
        );
    } else {
        await sendMessage(phone, lang === 'bm' ? 'Sila pilih 1-5 atau taip *MENU* untuk kembali.' : 'Please choose 1-5 or type *MENU* to go back.');
    }
}

async function handleContentGenerate(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const ctype = userData.content_type || 'instagram';
    const tUpper = text.toUpperCase().trim();

    if (tUpper === 'MENU') {
        await userRef.update({ state: 'menu' });
        await handleMenu(phone, 'MENU', userRef);
        return;
    }

    const detail = tUpper === 'SKIP' ? '' : text;
    const langInstr = lang === 'bm' ? 'Bahasa Malaysia yang menarik dan natural' : 'natural and engaging English';
    const biz = userData.business_name || 'perniagaan saya';
    const product = userData.product || 'produk';

    const prompts = {
        instagram: `You are a social media expert for small Malaysian businesses.\nCreate an Instagram caption in ${langInstr} for:\n- Business: ${biz}\n- Product: ${product}\n- Special detail: ${detail || 'general promotion'}\n\nFormat:\n- 3-4 lines of engaging caption\n- 2 relevant emojis per line\n- Call to action (DM/WhatsApp)\n- 10-15 relevant Malaysian hashtags\n\nMake it sound authentic, not corporate.`,
        whatsapp:  `You are a marketing expert for small Malaysian businesses.\nCreate a WhatsApp broadcast message in ${langInstr} for:\n- Business: ${biz}\n- Product: ${product}\n- Special detail: ${detail || 'general promotion'}\n\nFormat:\n- Greeting with emoji\n- Short exciting offer (2-3 lines)\n- Key benefits (3 bullet points)\n- Clear call to action\n- Contact info placeholder\n\nKeep it under 200 words. Conversational tone like texting a friend.`,
        tiktok:    `You are a TikTok content creator for small Malaysian businesses.\nCreate a TikTok video script in ${langInstr} for:\n- Business: ${biz}\n- Product: ${product}\n- Special detail: ${detail || 'showcase product'}\n\nFormat:\nHOOK (0-3 sec): [attention grabbing opening line]\nCONTENT (3-25 sec): [what to show/say step by step]\nCTA (25-30 sec): [call to action]\nCAPTION: [TikTok caption with hashtags]\n\nMake it trendy and fun.`,
        facebook:  `You are a Facebook marketing expert for small Malaysian businesses.\nCreate a Facebook post in ${langInstr} for:\n- Business: ${biz}\n- Product: ${product}\n- Special detail: ${detail || 'general promotion'}\n\nFormat:\n- Attention-grabbing first line\n- Story or benefit (3-4 lines)\n- Clear offer or call to action\n- 5-8 relevant hashtags\n\nTone: Friendly, trustworthy, community-focused.`,
        promosi:   `You are a marketing strategist for small Malaysian businesses.\nGenerate 3 creative promotion ideas in ${langInstr} for:\n- Business: ${biz}\n- Product: ${product}\n- Context: ${detail || 'general seasonal promotion'}\n\nFor each idea:\n- Idea name\n- How to execute (2-3 steps)\n- Expected benefit\n\nFocus on low-cost, high-impact ideas. Include Malaysian cultural events (Raya, Ramadan, Merdeka) if applicable.`,
    };

    await sendMessage(phone, lang === 'bm' ? '⏳ Sedang menjana kandungan untuk awak...' : '⏳ Generating content for you...');

    let response = '';
    try { response = await genText(prompts[ctype] || prompts.instagram); } catch { response = lang === 'bm' ? 'Maaf, cuba lagi.' : 'Sorry, try again.'; }

    const labelsBm = { instagram: '📸 CAPTION INSTAGRAM', whatsapp: '📱 MESEJ WHATSAPP BLAST', tiktok: '🎵 SKRIP TIKTOK', facebook: '📘 POST FACEBOOK', promosi: '💡 IDEA PROMOSI' };
    const labelsEn = { instagram: '📸 INSTAGRAM CAPTION', whatsapp: '📱 WHATSAPP BLAST', tiktok: '🎵 TIKTOK SCRIPT', facebook: '📘 FACEBOOK POST', promosi: '💡 PROMOTION IDEAS' };
    const label = lang === 'bm' ? labelsBm[ctype] : labelsEn[ctype];

    await userRef.update({ state: 'content_menu' });

    await sendMessage(phone, lang === 'bm'
        ? `✨ *${label} SIAP!*\n\n━━━━━━━━━━━━━━━━━━━━\n${response}\n━━━━━━━━━━━━━━━━━━━━\n\n📋 *Copy dan paste terus!*\n\n✨ *Jana Kandungan Media Sosial*\n\nJana lagi? Pilih:\n\n1️⃣ Caption Instagram\n2️⃣ WhatsApp Blast\n3️⃣ Skrip TikTok\n4️⃣ Post Facebook\n5️⃣ Idea Promosi\n\n_(Taip MENU untuk kembali)_`
        : `✨ *${label} READY!*\n\n━━━━━━━━━━━━━━━━━━━━\n${response}\n━━━━━━━━━━━━━━━━━━━━\n\n📋 *Copy and paste directly!*\n\n✨ *Social Media Content Generator*\n\nGenerate more? Choose:\n\n1️⃣ Instagram Caption\n2️⃣ WhatsApp Blast\n3️⃣ TikTok Script\n4️⃣ Facebook Post\n5️⃣ Promotion Ideas\n\n_(Type MENU to go back)_`
    );
}

module.exports = { handleContentMenu, handleContentGenerate };
