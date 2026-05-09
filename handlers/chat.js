const { getCountry, getCurrency } = require('../config');
const { genText } = require('../gemini');
const { sendMessage } = require('../send');

async function handleAiChat(phone, text, userRef) {
    const snap = await userRef.get();
    if (!snap.exists) return;
    const userData = snap.data();
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const cur = cc.currency;

    const sales = userData.sales || [];
    const expenses = userData.expenses || [];
    const totalSales    = sales.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const totalExpenses = expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const profit = totalSales - totalExpenses;

    const recentSales = sales
        .slice(-10)
        .map(s => `${s.date || '?'}: ${cur}${Number(s.amount) || 0} (${s.item || '?'})`)
        .join('\n') || (lang === 'bm' ? 'Tiada jualan direkod' : 'No sales recorded');

    const recentExpenses = expenses
        .slice(-5)
        .map(e => `${e.date || '?'}: ${cur}${Number(e.amount) || 0} (${e.item || '?'})`)
        .join('\n') || (lang === 'bm' ? 'Tiada perbelanjaan direkod' : 'No expenses recorded');

    const langInstr = lang === 'bm' ? 'Bahasa Malaysia yang mudah dan praktikal' : 'simple and practical English';
    const scoreInfo = userData.credit_score
        ? `${userData.credit_score}/100 (${userData.score_breakdown ? JSON.stringify(userData.score_breakdown) : 'breakdown unavailable'})`
        : (lang === 'bm' ? 'Belum dijana' : 'Not yet generated');

    const prompt = `You are BizBuddy AI — a smart business advisor for small ASEAN entrepreneurs.
Respond in ${langInstr}. Keep answers concise (max 5 sentences unless user explicitly asks for detailed analysis).
Do NOT offer generic advice — use the actual business data below.

BUSINESS PROFILE:
- Business: ${userData.business_name || '?'}
- Owner: ${userData.owner_name || '?'}
- Product/Service: ${userData.product || '?'}
- Country: ${cc.name} ${cc.flag}
- State/Region: ${userData.user_state || '?'}
- Monthly Revenue (stated): ${userData.monthly_revenue || '?'}
- Business Age: ${userData.biz_age || '?'}
- Bank Account: ${userData.has_bank_account || '?'}
- ${cc.registration} Registration: ${userData.has_ssm || '?'}
- Credit Score: ${scoreInfo}

FINANCIAL DATA:
- Total Recorded Sales: ${cur}${totalSales.toLocaleString()} (${sales.length} transactions)
- Total Expenses: ${cur}${totalExpenses.toLocaleString()} (${expenses.length} records)
- Profit: ${cur}${profit.toLocaleString()}
- Relevant Loan Program: ${cc.loan_program} (up to ${cc.loan_amount} at ${cc.loan_rate})

RECENT SALES (last 10):
${recentSales}

RECENT EXPENSES (last 5):
${recentExpenses}

YOU CAN HELP WITH:
- Sales forecast & trend analysis using actual data above
- Cost reduction & supply chain advice
- Social media content (Instagram, WhatsApp, TikTok captions/scripts)
- ASEAN export opportunities
- Loan eligibility & tips for ${cc.loan_program}
- Pricing strategy
- Any other business question

USER QUESTION: ${text}`;

    let reply = '';
    try {
        reply = await genText(prompt);
    } catch {
        reply = lang === 'bm' ? '❌ Maaf, ada masalah. Cuba lagi.' : '❌ Sorry, something went wrong. Try again.';
    }

    await sendMessage(phone, lang === 'bm'
        ? `🤖 *BizBuddy AI:*\n\n${reply}\n\n_(Tanya lagi atau taip *MENU*)_`
        : `🤖 *BizBuddy AI:*\n\n${reply}\n\n_(Ask more or type *MENU*)_`
    );
}

module.exports = { handleAiChat };
