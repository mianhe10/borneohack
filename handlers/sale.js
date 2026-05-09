const { FieldValue } = require('../db');
const { getCurrency, today } = require('../config');
const { genText, parseJson } = require('../gemini');
const { sendMessage } = require('../send');
const handleMenu = require('./menu');

async function handleLogSale(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cur = getCurrency(userData);

    if (text.toUpperCase() === 'MENU') {
        await userRef.update({ state: 'menu' });
        await handleMenu(phone, 'MENU', userRef);
        return;
    }

    const prompt = `Extract sale information from this text: "${text}"\nReturn ONLY valid JSON, nothing else:\n{"amount": number, "item": "string", "quantity": number}\nIf cannot extract amount, use 0.`;
    let sale = { amount: 0, item: text, quantity: 1 };
    try { sale = parseJson(await genText(prompt)); } catch { /* fallback */ }

    await userRef.update({
        state: 'menu',
        sales: FieldValue.arrayUnion({ amount: sale.amount, item: sale.item, date: today() }),
    });

    await sendMessage(phone, lang === 'bm'
        ? `✅ *Jualan direkod!*\n\n💵 Jumlah: ${cur}${sale.amount}\n📦 Item: ${sale.item}\n\nData ini disimpan untuk profil kredit awak 📊\nTaip *MENU* untuk kembali`
        : `✅ *Sale recorded!*\n\n💵 Amount: ${cur}${sale.amount}\n📦 Item: ${sale.item}\n\nThis data is saved for your credit profile 📊\nType *MENU* to go back`
    );
}

module.exports = { handleLogSale };
