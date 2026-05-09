const { getCurrency } = require('../config');
const { sendMessage } = require('../send');

async function showSalesSummary(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cur = getCurrency(userData);
    const sales = userData.sales || [];
    const expenses = userData.expenses || [];

    if (!sales.length && !expenses.length) {
        await sendMessage(phone, lang === 'bm'
            ? '📊 *Ringkasan Jualan*\n\nAwak belum rekod sebarang jualan lagi.\nTaip *1* untuk rekod jualan pertama awak!\n\nTaip *MENU* untuk kembali'
            : '📊 *Sales Summary*\n\nYou haven\'t recorded any sales yet.\nType *1* to record your first sale!\n\nType *MENU* to go back'
        );
        return;
    }

    const totalSales = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, x) => s + (x.amount || 0), 0);
    const profit = totalSales - totalExpenses;
    const margin = totalSales > 0 ? Math.round((profit / totalSales) * 100) : 0;
    const count = sales.length;
    const average = count > 0 ? totalSales / count : 0;
    const best = sales.length ? Math.max(...sales.map(s => s.amount || 0)) : 0;

    let health;
    if (margin >= 50) health = lang === 'bm' ? '🟢 Sihat' : '🟢 Healthy';
    else if (margin >= 20) health = lang === 'bm' ? '🟡 Sederhana' : '🟡 Moderate';
    else if (margin > 0) health = lang === 'bm' ? '🔴 Rendah' : '🔴 Low';
    else health = lang === 'bm' ? '⚠️ Rugi' : '⚠️ Loss';

    const recent = sales.slice(-5).reverse();
    const recentText = recent.map(s => `• ${cur}${s.amount || 0} — ${s.item || '-'} (${s.date || '-'})`).join('\n');

    await sendMessage(phone, lang === 'bm'
        ? `📊 *Ringkasan Kewangan Awak*\n\n━━━━━━━━━━━━━━━━━━━━\n💵 Jumlah Jualan: ${cur}${totalSales}\n💸 Jumlah Perbelanjaan: ${cur}${totalExpenses}\n📈 *Keuntungan: ${cur}${profit}*\n📊 Margin Keuntungan: ${margin}% ${health}\n━━━━━━━━━━━━━━━━━━━━\n🔢 Jumlah Transaksi: ${count}\n📈 Purata Per Transaksi: ${cur}${Math.round(average)}\n🏆 Jualan Terbesar: ${cur}${best}\n📦 Rekod Perbelanjaan: ${expenses.length}\n━━━━━━━━━━━━━━━━━━━━\n\n📋 *5 Jualan Terkini:*\n${recentText}\n\n💡 _Rekod perbelanjaan dengan taip: beli bahan rm50_\nTaip *MENU* untuk kembali`
        : `📊 *Your Financial Summary*\n\n━━━━━━━━━━━━━━━━━━━━\n💵 Total Sales: ${cur}${totalSales}\n💸 Total Expenses: ${cur}${totalExpenses}\n📈 *Profit: ${cur}${profit}*\n📊 Profit Margin: ${margin}% ${health}\n━━━━━━━━━━━━━━━━━━━━\n🔢 Transactions: ${count}\n📈 Average Per Sale: ${cur}${Math.round(average)}\n🏆 Biggest Sale: ${cur}${best}\n📦 Expense Records: ${expenses.length}\n━━━━━━━━━━━━━━━━━━━━\n\n📋 *Last 5 Sales:*\n${recentText}\n\n💡 _Track expenses by typing: bought supplies rm50_\nType *MENU* to go back`
    );
}

module.exports = { showSalesSummary };
