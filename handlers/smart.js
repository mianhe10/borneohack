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

    let intent = 'unknown';
    try {
        intent = (await genText(intentPrompt)).toLowerCase().replace(/['"`]/g, '');
    } catch { /* fallback */ }

    if (intent === 'log_sale') {
        const extractPrompt = `Extract sale information from: "${text}"\nReturn ONLY valid JSON:\n{"amount": number, "item": "string"}\nIf cannot extract amount use 0.`;
        let sale = { amount: 0, item: text };
        try { sale = parseJson(await genText(extractPrompt)); } catch { /* fallback */ }

        await userRef.update({
            sales: FieldValue.arrayUnion({ amount: sale.amount, item: sale.item, date: today() }),
        });
        await sendMessage(phone, lang === 'bm'
            ? `✅ *Jualan direkod terus!*\n\n💵 Jumlah: ${cur}${sale.amount}\n📦 Item: ${sale.item}\n\nTaip *MENU* untuk pilihan lain.`
            : `✅ *Sale recorded directly!*\n\n💵 Amount: ${cur}${sale.amount}\n📦 Item: ${sale.item}\n\nType *MENU* for other options.`
        );
        return;
    }

    if (intent === 'log_expense') {
        const extractPrompt = `Extract expense information from: "${text}"\nReturn ONLY valid JSON:\n{"amount": number, "item": "string"}\nIf cannot extract amount use 0.`;
        let expense = { amount: 0, item: text };
        try { expense = parseJson(await genText(extractPrompt)); } catch { /* fallback */ }

        await userRef.update({
            expenses: FieldValue.arrayUnion({ amount: expense.amount, item: expense.item, date: today() }),
        });
        await sendMessage(phone, lang === 'bm'
            ? `✅ *Perbelanjaan direkod!*\n\n💸 Jumlah: ${cur}${expense.amount}\n📦 Item: ${expense.item}\n\nTaip *MENU* untuk pilihan lain.`
            : `✅ *Expense recorded!*\n\n💸 Amount: ${cur}${expense.amount}\n📦 Item: ${expense.item}\n\nType *MENU* for other options.`
        );
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
