const { getCountry, getCurrency } = require('../config');
const { genText } = require('../gemini');
const { sendMessage } = require('../send');
const handleMenu = require('./menu');

async function handleAiChat(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const cur = cc.currency;
    const sales = userData.sales || [];
    const expenses = userData.expenses || [];
    const totalSales = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, x) => s + (x.amount || 0), 0);
    const profit = totalSales - totalExpenses;
    const recentSales = sales.slice(-10).map(s => `${s.date || '?'}: ${cur}${s.amount || 0} (${s.item || '?'})`).join('\n') || 'No sales recorded yet';
    const recentExpenses = expenses.slice(-5).map(e => `${e.date || '?'}: ${cur}${e.amount || 0} (${e.item || '?'})`).join('\n') || 'No expenses recorded yet';

    if (text.toUpperCase() === 'MENU') {
        await userRef.update({ state: 'menu' });
        await handleMenu(phone, 'MENU', userRef);
        return;
    }

    const langInstr = lang === 'bm' ? 'Bahasa Malaysia yang mudah dan praktikal' : 'simple and practical English';

    const prompt = `You are BizBuddy AI — a smart business advisor for small ASEAN entrepreneurs.
Respond in ${langInstr}. Keep answers concise (max 5 sentences unless user asks for detailed analysis).

BUSINESS PROFILE:
- Business: ${userData.business_name || '?'}
- Owner: ${userData.owner_name || '?'}
- Product/Service: ${userData.product || '?'}
- Country: ${cc.name} ${cc.flag}
- State: ${userData.user_state || '?'}
- Monthly Revenue (stated): ${userData.monthly_revenue || '?'}
- Business Age: ${userData.biz_age || '?'}
- Bank Account: ${userData.has_bank_account || '?'}
- ${cc.registration} Registration: ${userData.has_ssm || '?'}
- Credit Score: ${userData.credit_score || 'Not yet generated'}/100

FINANCIAL DATA:
- Total Recorded Sales: ${cur}${totalSales} (${sales.length} transactions)
- Total Expenses: ${cur}${totalExpenses}
- Profit: ${cur}${profit}
- Loan Program: ${cc.loan_program} (up to ${cc.loan_amount} at ${cc.loan_rate})

RECENT SALES:
${recentSales}

RECENT EXPENSES:
${recentExpenses}

YOU CAN HELP WITH (use data above when relevant):
- Sales forecast & trend analysis
- Supply chain & cost reduction advice
- Social media content (Instagram, WhatsApp, TikTok, Facebook captions/scripts)
- ASEAN export opportunities
- Loan eligibility & application tips for ${cc.loan_program}
- Pricing strategy
- Business growth advice
- Any other business question

USER QUESTION: ${text}`;

    let reply = '';
    try { reply = await genText(prompt); } catch { reply = lang === 'bm' ? 'Maaf, cuba lagi.' : 'Sorry, try again.'; }

    await sendMessage(phone, lang === 'bm'
        ? `🤖 *BizBuddy AI:*\n\n${reply}\n\n_(Tanya lagi atau taip MENU)_`
        : `🤖 *BizBuddy AI:*\n\n${reply}\n\n_(Ask more or type MENU)_`
    );
}

module.exports = { handleAiChat };
