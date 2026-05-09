const { db, FieldValue } = require('../db');
const { getCountry, getCurrency, today } = require('../config');
const { genText, parseJson } = require('../gemini');
const { sendMessage } = require('../send');
const handleMenu = require('./menu');
const { showCertificate } = require('../features/profile');
const { showSalesSummary } = require('../features/summary');

async function smartHandle(phone, text, userRef) {
    const snap = await userRef.get();
    const userData = snap.data();
    const lang = userData.language || 'bm';
    const cur = getCurrency(userData);
    const tUpper = text.toUpperCase().trim();

    // Hard commands first
    if (tUpper === 'MENU') { await handleMenu(phone, 'MENU', userRef); return; }
    if (['1','2','3','4','5','6','7','8','9'].includes(tUpper)) { await handleMenu(phone, text, userRef); return; }

    const businessProduct = userData.product || '';
    const intentPrompt = `You are an intent classifier for a WhatsApp business bot.
The user's business sells/offers: ${businessProduct}

Classify this message into ONE of these intents:
- log_sale: user is recording INCOME/REVENUE. Keywords: jual, dapat, sold, received money, orang, customer, client, pelanggan. IMPORTANT: If the user mentions their own product/service (like "${businessProduct}") and mentions receiving money or serving customers, this is a SALE not an expense. For service businesses, serving customers = making a sale.
- log_expense: user is recording a COST/SPENDING. Keywords: beli bahan, bought supplies, spent on, bayar bil, purchase materials, restock. Money GOING OUT to suppliers/bills, NOT from customers.
- check_score: user asking about credit score (skor, score, markah)
- check_summary: user asking about sales summary (ringkasan, summary, jualan, berapa duit)
- ask_ai: user asking a business question (how to, macam mana, tips, advice, cara)
- show_menu: user wants to see menu options
- unknown: cannot classify

KEY RULE: If the message mentions "dapat" (received) with an amount, it is ALWAYS a sale.
KEY RULE: Only classify as expense if the user is BUYING supplies or PAYING bills.

Message: "${text}"

Reply with ONLY the intent word, nothing else.`;

    const lowerText = text.toLowerCase().trim();
    const hasNumber = /\d/.test(text);

    const SALE_KW = ['jual','sold','dapat','terima','sale','jualan','pelanggan','customer','hasil'];
    const EXPENSE_KW = ['beli','bayar','bought','paid','pay','purchase','kos','belanja','spend','spent','modal','supplier','stok','stock'];
    const SCORE_KW = ['skor','score','kredit','markah','credit','point'];
    const SUMMARY_KW = ['ringkasan','summary','jumlah','total','berapa','pendapatan','revenue'];
    const MENU_KW = ['menu','help','bantuan','pilihan','option'];

    let intent = 'unknown';

    if (hasNumber && EXPENSE_KW.some(kw => lowerText.includes(kw))) {
        intent = 'log_expense';
    } else if (hasNumber && SALE_KW.some(kw => lowerText.includes(kw))) {
        intent = 'log_sale';
    } else if (hasNumber && lowerText.includes('rm')) {
        intent = 'log_sale';
    } else if (SCORE_KW.some(kw => lowerText.includes(kw))) {
        intent = 'check_score';
    } else if (SUMMARY_KW.some(kw => lowerText.includes(kw))) {
        intent = 'check_summary';
    } else if (MENU_KW.some(kw => lowerText.includes(kw))) {
        intent = 'show_menu';
    } else {
        try {
            const geminiIntent = (await genText(intentPrompt)).toLowerCase().replace(/['"`]/g, '').trim();
            const validIntents = ['log_sale','log_expense','check_score','check_summary','ask_ai','show_menu','unknown'];
            if (validIntents.includes(geminiIntent)) intent = geminiIntent;
        } catch {
            console.error('[smartHandle] Gemini intent failed, using keyword result:', intent);
        }
    }

    console.log('[smartHandle] intent:', intent, 'for:', text);

    if (intent === 'log_sale' || intent === 'log_expense') {
        const amountPatterns = [
            /(?:rm|rp|₱|myr)\s*(\d+(?:\.\d{1,2})?)/i,
            /(\d+(?:\.\d{1,2})?)\s*(?:rm|rp|₱|ringgit|rupiah)/i,
            /(\d+(?:\.\d{1,2})?)/,
        ];
        let amount = 0;
        for (const pattern of amountPatterns) {
            const match = text.match(pattern);
            if (match) { amount = parseFloat(match[1]); if (amount > 0) break; }
        }
        let item = text
            .replace(/(?:rm|rp|₱|ringgit|rupiah)\s*\d+(?:\.\d+)?/gi, '')
            .replace(/\d+(?:\.\d+)?\s*(?:rm|rp|₱|ringgit|rupiah)/gi, '')
            .replace(/\b\d+\b/g, '')
            .replace(/(?:jual|beli|bayar|sold|bought|paid|dapat|terima|rm|rp|jualan)\b/gi, '')
            .replace(/\s+/g, ' ').trim().substring(0, 50);
        if (!item || item.length < 2) item = 'item';

        const isExpense = intent === 'log_expense';
        const record = { amount, item, date: today() };

        if (amount > 0) {
            await userRef.update({
                [isExpense ? 'expenses' : 'sales']: FieldValue.arrayUnion(record),
            });
            await sendMessage(phone, lang === 'bm'
                ? `✅ *${isExpense ? 'Perbelanjaan' : 'Jualan'} direkod!*\n\n${isExpense ? '💸' : '💵'} Jumlah: ${cur}${amount}\n📦 Item: ${item}\n\nTaip *MENU* untuk pilihan lain.`
                : `✅ *${isExpense ? 'Expense' : 'Sale'} recorded!*\n\n${isExpense ? '💸' : '💵'} Amount: ${cur}${amount}\n📦 Item: ${item}\n\nType *MENU* for other options.`
            );
        } else {
            await sendMessage(phone, lang === 'bm'
                ? `⚠️ Tidak dapat kesan jumlah. Cuba: _"Jual nasi lemak RM15"_\n\nTaip *MENU* untuk kembali`
                : `⚠️ Couldn't detect amount. Try: _"Sold nasi lemak RM15"_\n\nType *MENU* to go back`
            );
        }
        return;
    }

    if (intent === 'check_score') { await showCertificate(phone, userRef); return; }
    if (intent === 'check_summary') { await showSalesSummary(phone, userRef); return; }
    if (intent === 'show_menu') { await handleMenu(phone, 'MENU', userRef); return; }

    // ask_ai or unknown — answer as AI advisor
    const langInstr = lang === 'bm' ? 'Bahasa Malaysia mudah' : 'simple English';
    const aiPrompt = `You are an AI business advisor for small Malaysian entrepreneurs.
Answer in ${langInstr}. Maximum 4 sentences.
If this is not a business question, politely redirect them to type MENU.

User business:
- Name: ${userData.business_name || 'Unknown'}
- Product: ${userData.product || 'Unknown'}
- Income: ${userData.monthly_revenue || 'Unknown'}

Question: ${text}`;

    let aiReply = '';
    try { aiReply = await genText(aiPrompt); } catch { aiReply = lang === 'bm' ? 'Maaf, cuba lagi.' : 'Sorry, try again.'; }

    await sendMessage(phone, lang === 'bm'
        ? `🤖 ${aiReply}\n\n_(Taip MENU untuk pilihan)_`
        : `🤖 ${aiReply}\n\n_(Type MENU for options)_`
    );
}

module.exports = { smartHandle };
