const { getCurrency, today } = require('../config');
const { genText } = require('../gemini');
const { sendMessage } = require('../send');

function getWeekStart() {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
}

function getMonthStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

async function showSalesSummary(phone, userRef) {
    const snap = await userRef.get();
    if (!snap.exists) return;
    const userData = snap.data();
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

    const todayStr = today();
    const weekStr = getWeekStart();
    const monthStr = getMonthStart();

    const sumAmounts = arr => arr.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    const todaySales    = sumAmounts(sales.filter(s => s.date === todayStr));
    const weekSales     = sumAmounts(sales.filter(s => s.date >= weekStr));
    const monthSales    = sumAmounts(sales.filter(s => s.date >= monthStr));
    const totalSales    = sumAmounts(sales);
    const totalExpenses = sumAmounts(expenses);
    const profit        = totalSales - totalExpenses;
    const margin        = totalSales > 0 ? Math.round((profit / totalSales) * 100) : 0;
    const count         = sales.length;
    const average       = count > 0 ? Math.round(totalSales / count) : 0;

    // Top item by total revenue
    const itemMap = {};
    sales.forEach(s => {
        const key = (s.item || 'unknown').toLowerCase();
        itemMap[key] = (itemMap[key] || 0) + (Number(s.amount) || 0);
    });
    const topItem = Object.entries(itemMap).sort((a, b) => b[1] - a[1])[0];
    const topItemDisplay = topItem ? `${topItem[0]} (${cur}${topItem[1].toLocaleString()})` : '-';

    // Last 5 sales sorted by date descending
    const recent = [...sales]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 5);
    const recentText = recent.map(s =>
        `• ${cur}${(Number(s.amount) || 0).toLocaleString()} — ${s.item || '-'} (${s.date || '-'})`
    ).join('\n');

    let health;
    if (margin >= 50)     health = lang === 'bm' ? '🟢 Sihat'     : '🟢 Healthy';
    else if (margin >= 20) health = lang === 'bm' ? '🟡 Sederhana' : '🟡 Moderate';
    else if (margin > 0)   health = lang === 'bm' ? '🔴 Rendah'    : '🔴 Low';
    else                   health = lang === 'bm' ? '⚠️ Rugi'      : '⚠️ Loss';

    const statsMsg = lang === 'bm'
        ? `📊 *Ringkasan Kewangan Awak*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 Hari ini: *${cur}${todaySales.toLocaleString()}*\n` +
          `📅 Minggu ini: *${cur}${weekSales.toLocaleString()}*\n` +
          `📅 Bulan ini: *${cur}${monthSales.toLocaleString()}*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `💵 Jumlah Jualan: ${cur}${totalSales.toLocaleString()}\n` +
          `💸 Jumlah Perbelanjaan: ${cur}${totalExpenses.toLocaleString()}\n` +
          `📈 *Keuntungan: ${cur}${profit.toLocaleString()}*\n` +
          `📊 Margin: ${margin}% ${health}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔢 Bilangan Transaksi: ${count}\n` +
          `📈 Purata Per Transaksi: ${cur}${average.toLocaleString()}\n` +
          `🏆 Item Terlaris: ${topItemDisplay}\n` +
          `📦 Rekod Perbelanjaan: ${expenses.length}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📋 *5 Jualan Terkini:*\n${recentText}\n\n` +
          `💡 _Rekod perbelanjaan: taip "beli bahan rm50"_\nTaip *MENU* untuk kembali`
        : `📊 *Your Financial Summary*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 Today: *${cur}${todaySales.toLocaleString()}*\n` +
          `📅 This week: *${cur}${weekSales.toLocaleString()}*\n` +
          `📅 This month: *${cur}${monthSales.toLocaleString()}*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `💵 Total Sales: ${cur}${totalSales.toLocaleString()}\n` +
          `💸 Total Expenses: ${cur}${totalExpenses.toLocaleString()}\n` +
          `📈 *Profit: ${cur}${profit.toLocaleString()}*\n` +
          `📊 Margin: ${margin}% ${health}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔢 Transactions: ${count}\n` +
          `📈 Average Per Sale: ${cur}${average.toLocaleString()}\n` +
          `🏆 Top Item: ${topItemDisplay}\n` +
          `📦 Expense Records: ${expenses.length}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📋 *Last 5 Sales:*\n${recentText}\n\n` +
          `💡 _Track expenses: type "bought supplies rm50"_\nType *MENU* to go back`;

    await sendMessage(phone, statsMsg);

    // Gemini trend + tip (per FEATURES.txt)
    if (sales.length >= 3) {
        try {
            const langInstr = lang === 'bm' ? 'Bahasa Malaysia' : 'English';
            const prompt = `You are a business advisor for a small ${lang === 'bm' ? 'Malaysian' : 'ASEAN'} SME.
Business: ${userData.business_name || '-'}, Product: ${userData.product || '-'}
Total sales: ${cur}${totalSales.toLocaleString()} across ${count} transactions
Today: ${cur}${todaySales.toLocaleString()}, This month: ${cur}${monthSales.toLocaleString()}
Profit margin: ${margin}%
Top item: ${topItemDisplay}

In ${langInstr}, write EXACTLY 2 short lines:
TREND: [1 sentence honest observation about sales trend]
TIP: [1 specific actionable business tip based on their data]`;

            const aiInsight = await genText(prompt);
            if (aiInsight && aiInsight.trim()) {
                await sendMessage(phone, lang === 'bm'
                    ? `💡 *Analisis AI:*\n\n${aiInsight}`
                    : `💡 *AI Analysis:*\n\n${aiInsight}`
                );
            }
        } catch { /* silently skip if Gemini fails */ }
    }
}

module.exports = { showSalesSummary };
