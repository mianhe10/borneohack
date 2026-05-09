const { FieldValue } = require('../db');
const { getCountry, getCurrency, today } = require('../config');
const { genText } = require('../gemini');
const { sendMessage } = require('../send');

function calculateCreditScore(userData) {
    const sales = userData.sales || [];
    const expenses = userData.expenses || [];
    const totalSales = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const count = sales.length;
    const breakdown = {};

    // 1. Transaction Consistency (25 pts)
    let consistencyScore = 0;
    if (count > 0) {
        const dates = [...new Set(sales.map(s => s.date).filter(Boolean))].sort();
        if (dates.length >= 2) {
            try {
                const first = new Date(dates[0]);
                const last = new Date(dates[dates.length - 1]);
                const totalDays = Math.max((last - first) / 86400000, 1);
                consistencyScore = Math.round(Math.min(dates.length / totalDays, 1) * 25);
            } catch { consistencyScore = Math.min(count, 5) * 2; }
        } else {
            consistencyScore = 5;
        }
    }
    breakdown.consistency = Math.min(consistencyScore, 25);

    // 2. Revenue Strength (20 pts)
    let revenueScore = 0;
    const monthlyRevStr = userData.monthly_revenue || '0';
    const monthlyRev = parseInt(monthlyRevStr.replace(/\D/g, '') || '0');
    if (monthlyRev > 0 && totalSales > 0) {
        const ratio = totalSales / monthlyRev;
        if (ratio >= 3) revenueScore = 20;
        else if (ratio >= 2) revenueScore = 16;
        else if (ratio >= 1) revenueScore = 12;
        else if (ratio >= 0.5) revenueScore = 8;
        else revenueScore = 4;
    } else if (totalSales > 0) {
        revenueScore = 6;
    }
    breakdown.revenue = Math.min(revenueScore, 20);

    // 3. Business Age (15 pts)
    let totalMonths = 0;
    const bizAge = (userData.biz_age || '').toLowerCase();
    try {
        const ageNum = parseInt(bizAge.replace(/\D+/, '') || '0');
        if (bizAge.includes('year') || bizAge.includes('tahun')) totalMonths = ageNum * 12;
        else if (bizAge.includes('month') || bizAge.includes('bulan')) totalMonths = ageNum;
        else totalMonths = ageNum * 12;
    } catch { totalMonths = 0; }

    if (userData.registered_date) {
        try {
            const regDate = new Date(userData.registered_date);
            const monthsOnPlatform = Math.max(Math.floor((Date.now() - regDate) / (30 * 86400000)), 0);
            totalMonths += monthsOnPlatform;
        } catch { /* ignore */ }
    }

    let ageScore = 0;
    if (totalMonths >= 60) ageScore = 15;
    else if (totalMonths >= 36) ageScore = 12;
    else if (totalMonths >= 12) ageScore = 9;
    else if (totalMonths >= 6) ageScore = 6;
    else if (totalMonths >= 3) ageScore = 4;
    else if (totalMonths > 0) ageScore = 2;
    else ageScore = 1;
    breakdown.age = Math.min(ageScore, 15);

    // 4. Formalization (20 pts)
    const hasSsm = (userData.has_ssm || '').toLowerCase();
    const hasBank = (userData.has_bank_account || '').toLowerCase();
    const ssmVerified = userData.ssm_verified || false;
    const bankVerified = userData.bank_verified || false;
    let formalScore = 0;
    if (hasSsm.startsWith('y') || hasSsm.startsWith('s')) formalScore += ssmVerified ? 10 : 7;
    else if (!hasSsm.startsWith('t') && !hasSsm.startsWith('n')) formalScore += 2;
    if (hasBank.startsWith('y') || hasBank.startsWith('a')) formalScore += bankVerified ? 10 : 7;
    else if (!hasBank.startsWith('t') && !hasBank.startsWith('n')) formalScore += 2;
    breakdown.formalization = Math.min(formalScore, 20);

    // 5. Record Volume (10 pts)
    let volScore = 0;
    if (count >= 30) volScore = 10;
    else if (count >= 20) volScore = 8;
    else if (count >= 10) volScore = 6;
    else if (count >= 5) volScore = 4;
    else if (count >= 1) volScore = 2;
    breakdown.volume = volScore;

    // 6. Expense Discipline (10 pts)
    const expCount = expenses.length;
    let expScore = 0;
    if (expCount >= 10) expScore = 10;
    else if (expCount >= 5) expScore = 7;
    else if (expCount >= 2) expScore = 4;
    else if (expCount >= 1) expScore = 2;
    breakdown.expenses = expScore;

    const totalScore = Math.max(0, Math.min(Object.values(breakdown).reduce((a, b) => a + b, 0), 100));

    let level, levelEn;
    if (totalScore >= 80) { level = 'Cemerlang'; levelEn = 'Excellent'; }
    else if (totalScore >= 60) { level = 'Baik'; levelEn = 'Good'; }
    else if (totalScore >= 40) { level = 'Sederhana'; levelEn = 'Moderate'; }
    else { level = 'Rendah'; levelEn = 'Low'; }

    return { score: totalScore, level, levelEn, breakdown };
}

async function generateCreditScore(phone, userRef) {
    const userData = (await userRef.get()).data();
    const sales = userData.sales || [];
    const total = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const count = sales.length;
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const cur = cc.currency;
    const reg = cc.registration;

    const { score, level, levelEn, breakdown } = calculateCreditScore(userData);

    await userRef.update({
        credit_score: score,
        score_date: today(),
        score_breakdown: breakdown,
        score_history: FieldValue.arrayUnion({ date: today(), score }),
    });

    const langInstr = lang === 'bm' ? 'Bahasa Malaysia' : 'English';
    const prompt = `You are a credit advisor for small businesses. The credit score has ALREADY been calculated.
DO NOT change the score. Just explain it and give improvement tips.
Respond in ${langInstr}.

SCORE: ${score}/100
LEVEL: ${lang === 'bm' ? level : levelEn}

Score breakdown:
- Transaction Consistency: ${breakdown.consistency}/25
- Revenue Strength: ${breakdown.revenue}/20
- Business Age: ${breakdown.age}/15
- Formalization (${reg} + Bank): ${breakdown.formalization}/20
- Record Volume: ${breakdown.volume}/10
- Expense Discipline: ${breakdown.expenses}/10

Business info:
- Name: ${userData.owner_name}
- Business: ${userData.business_name}
- Product: ${userData.product}
- Reported income: ${userData.monthly_revenue}
- Total sales recorded: ${cur}${total}
- Transactions: ${count}

Use EXACTLY this format:
SKOR: ${score}/100
TAHAP: ${lang === 'bm' ? level : levelEn}

📊 PECAHAN SKOR:
• Konsistensi Jualan: ${breakdown.consistency}/25
• Kekuatan Hasil: ${breakdown.revenue}/20
• Umur Perniagaan: ${breakdown.age}/15
• Formalisasi: ${breakdown.formalization}/20
• Jumlah Rekod: ${breakdown.volume}/10
• Disiplin Perbelanjaan: ${breakdown.expenses}/10

SEBAB: [1 sentence explaining overall score]

LANGKAH PENAMBAHBAIKAN:
LANGKAH 1: [specific improvement]
LANGKAH 2: [second improvement]
LANGKAH 3: [third improvement]`;

    let aiText = '';
    try { aiText = await genText(prompt); } catch { aiText = `SKOR: ${score}/100\nTAHAP: ${lang === 'bm' ? level : levelEn}`; }

    await sendMessage(phone, lang === 'bm'
        ? `📊 *Laporan Skor Kredit Awak*\n\n${aiText}\n\n━━━━━━━━━━━━━━━━━━━━\n🔬 _Skor dikira menggunakan formula hibrid AI_\n_berdasarkan 6 kriteria yang telus dan boleh diaudit._\n━━━━━━━━━━━━━━━━━━━━\n\n💡 Rekod lebih banyak jualan untuk tingkatkan skor!\nTaip *SIJIL* untuk jana sijil kredit awak\nTaip *MENU* untuk kembali`
        : `📊 *Your Credit Score Report*\n\n${aiText}\n\n━━━━━━━━━━━━━━━━━━━━\n🔬 _Score calculated using hybrid AI formula_\n_based on 6 transparent, auditable criteria._\n━━━━━━━━━━━━━━━━━━━━\n\n💡 Record more sales to improve your score!\nType *CERTIFICATE* to generate your credit certificate\nType *MENU* to go back`
    );
}

module.exports = { calculateCreditScore, generateCreditScore };
