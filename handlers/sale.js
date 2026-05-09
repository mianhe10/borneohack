const { FieldValue } = require('../db');
const { getCurrency, today } = require('../config');
const { genText, parseJson } = require('../gemini');
const { sendMessage } = require('../send');

function extractByRegex(text) {
    const lower = text.toLowerCase().replace(/,/g, '');
    
    const expenseWords = ['beli', 'bayar', 'bought', 'paid', 'pay', 'purchase',
                          'kos', 'belanja', 'spend', 'spent', 'modal', 'supplier'];
    const isExpense = expenseWords.some(w => lower.includes(w));
    
    const amountPatterns = [
        /(?:rm|rp|₱|myr)\s*(\d+(?:\.\d{1,2})?)/i,
        /(\d+(?:\.\d{1,2})?)\s*(?:rm|rp|₱|ringgit|rupiah)/i,
        /(\d+(?:\.\d{1,2})?)/,
    ];
    
    let amount = 0;
    for (const pattern of amountPatterns) {
        const match = text.match(pattern);
        if (match) {
            amount = parseFloat(match[1]);
            if (amount > 0) break;
        }
    }
    
    let item = text
        .replace(/(?:rm|rp|₱|ringgit|rupiah)\s*\d+(?:\.\d+)?/gi, '')
        .replace(/\d+(?:\.\d+)?\s*(?:rm|rp|₱|ringgit|rupiah)/gi, '')
        .replace(/\b\d+\b/g, '')
        .replace(/(?:jual|beli|bayar|sold|bought|paid|dapat|terima|rm|rp|jualan)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 50);
    
    if (!item || item.length < 2) item = 'item';
    
    return { amount, item, quantity: 1, type: isExpense ? 'expense' : 'sale' };
}

async function handleLogSale(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cur = getCurrency(userData);

    // Try regex first — fast, no API call, works offline
    let entry = extractByRegex(text);
    console.log('[SALE] regex result:', JSON.stringify(entry), 'for:', text);

    // If regex got amount, skip Gemini entirely
    if (entry.amount <= 0) {
        console.log('[SALE] regex failed, trying Gemini...');
        const prompt = `You are extracting a business transaction from a Malaysian/ASEAN small business.
Message: "${text}"

Bahasa Malaysia patterns:
- "jual X RM Y" or "jual X rm Y" = sold X for Y (sale)
- "dapat RM Y" = received Y (sale)
- "beli X RM Y" = bought X for Y (expense)
- "bayar RM Y" = paid Y (expense)

Extract and return ONLY valid JSON:
{"amount": number, "item": "string", "quantity": number, "type": "sale" | "expense"}
- amount: the numeric value after RM/rm/rp/₱ (e.g. RM18 → 18, rm 500 → 500)
- item: short product/service name, max 5 words
- type: "sale" if money received, "expense" if money spent
- If no amount found, use 0`;

        try {
            const raw = await genText(prompt);
            console.log('[SALE] Gemini raw:', raw);
            const parsed = parseJson(raw);
            if (parsed && typeof parsed === 'object') {
                entry = {
                    amount: Math.max(0, Number(parsed.amount) || 0),
                    item: String(parsed.item || text).replace(/^["']|["']$/g, '').substring(0, 50),
                    quantity: Math.max(1, Number(parsed.quantity) || 1),
                    type: parsed.type === 'expense' ? 'expense' : 'sale',
                };
            }
        } catch (err) {
            console.error('[SALE] Gemini failed:', err.message);
        }
    }

    if (entry.amount <= 0) {
        await sendMessage(phone, lang === 'bm'
            ? `⚠️ Saya tidak dapat kesan jumlah. Cuba format macam ni:\n\n✍️ _"Jual nasi lemak 3 bungkus RM15"_\n✍️ _"Beli stok tepung RM50"_\n\nTaip *MENU* untuk kembali`
            : `⚠️ I couldn't detect an amount. Try this format:\n\n✍️ _"Sold 3 nasi lemak RM15"_\n✍️ _"Bought flour stock RM50"_\n\nType *MENU* to go back`
        );
        return;
    }

    const todayStr = today();
    const isExpense = entry.type === 'expense';
    const record = { amount: entry.amount, item: entry.item, date: todayStr, source: 'text' };

    await userRef.update({
        [isExpense ? 'expenses' : 'sales']: FieldValue.arrayUnion(record),
    });

    const fresh = (await userRef.get()).data();
    const todaySales = (fresh.sales || [])
        .filter(s => s.date === todayStr)
        .reduce((sum, x) => sum + (x.amount || 0), 0);
    const todayExpenses = (fresh.expenses || [])
        .filter(e => e.date === todayStr)
        .reduce((sum, x) => sum + (x.amount || 0), 0);

    const runningLine = todayExpenses > 0
        ? (lang === 'bm'
            ? `\n\n📈 Jualan hari ini: *${cur}${todaySales.toLocaleString()}* | 💸 Belanja: *${cur}${todayExpenses.toLocaleString()}* | 💰 Bersih: *${cur}${(todaySales - todayExpenses).toLocaleString()}*`
            : `\n\n📈 Today sales: *${cur}${todaySales.toLocaleString()}* | 💸 Expenses: *${cur}${todayExpenses.toLocaleString()}* | 💰 Net: *${cur}${(todaySales - todayExpenses).toLocaleString()}*`)
        : (lang === 'bm'
            ? `\n\n📈 Jualan hari ini: *${cur}${todaySales.toLocaleString()}*`
            : `\n\n📈 Today's sales: *${cur}${todaySales.toLocaleString()}*`);

    await sendMessage(phone, isExpense
        ? (lang === 'bm'
            ? `✅ *Perbelanjaan direkod!*\n\n💸 Jumlah: ${cur}${entry.amount.toLocaleString()}\n📦 Item: ${entry.item}${runningLine}\n\nTerus rekod atau taip *MENU* untuk kembali`
            : `✅ *Expense recorded!*\n\n💸 Amount: ${cur}${entry.amount.toLocaleString()}\n📦 Item: ${entry.item}${runningLine}\n\nKeep recording or type *MENU* to go back`)
        : (lang === 'bm'
            ? `✅ *Jualan direkod!*\n\n💵 Jumlah: ${cur}${entry.amount.toLocaleString()}\n📦 Item: ${entry.item}${runningLine}\n\nTerus rekod atau taip *MENU* untuk kembali`
            : `✅ *Sale recorded!*\n\n💵 Amount: ${cur}${entry.amount.toLocaleString()}\n📦 Item: ${entry.item}${runningLine}\n\nKeep recording or type *MENU* to go back`)
    );
}

module.exports = { handleLogSale };