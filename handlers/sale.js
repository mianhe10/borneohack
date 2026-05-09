const { FieldValue } = require('../db');
const { getCurrency, today } = require('../config');
const { genText, parseJson } = require('../gemini');
const { sendMessage } = require('../send');

async function handleLogSale(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cur = getCurrency(userData);

    const prompt = `Analyze this business transaction: "${text}"
Return ONLY valid JSON:
{"amount": number, "item": "string", "quantity": number, "type": "sale" | "expense"}
sale = selling goods/services to customers (jual, sold, terima bayaran, dapat duit)
expense = buying stock/supplies/equipment (beli, purchase, bayar supplier, kos, modal, belanja)
item should be concise, max 5 words. If amount not found, use 0.`;

    let entry = { amount: 0, item: text.substring(0, 50), quantity: 1, type: 'sale' };
    try {
        const parsed = parseJson(await genText(prompt));
        if (parsed && typeof parsed === 'object') {
            entry = {
                amount: Math.max(0, Number(parsed.amount) || 0),
                item: String(parsed.item || text).replace(/^["']|["']$/g, '').substring(0, 50),
                quantity: Math.max(1, Number(parsed.quantity) || 1),
                type: parsed.type === 'expense' ? 'expense' : 'sale',
            };
        }
    } catch { /* use fallback */ }

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

    // Running totals for today
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
