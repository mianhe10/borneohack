const { FieldValue } = require('../db');
const { getCountry, getCurrency, today } = require('../config');
const { genText } = require('../gemini');
const { sendMessage } = require('../send');

// Parse monthly revenue string → number. Handles: "RM2000", "2000-5000", "RM5k", "5,000"
function parseMonthlyRevenue(str) {
    if (!str) return 0;
    const s = String(str).toLowerCase().replace(/,/g, '');
    // Range: take midpoint
    const rangeMatch = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) return (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
    // "k" suffix
    const kMatch = s.match(/(\d+(?:\.\d+)?)k/);
    if (kMatch) return parseFloat(kMatch[1]) * 1000;
    // Plain number
    const plain = s.match(/(\d+(?:\.\d+)?)/);
    return plain ? parseFloat(plain[1]) : 0;
}

// Parse business age string → months
function parseBizAgeMonths(str) {
    if (!str) return 0;
    const s = String(str).toLowerCase();
    const numMatch = s.match(/(\d+(?:\.\d+)?)/);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    if (!num) return 0;
    if (s.includes('year') || s.includes('tahun')) return Math.round(num * 12);
    if (s.includes('month') || s.includes('bulan')) return Math.round(num);
    // Default: treat bare number as years (most common user input)
    return Math.round(num * 12);
}

function calculateCreditScore(userData) {
    const sales = userData.sales || [];
    const expenses = userData.expenses || [];
    const totalSales = sales.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const count = sales.length;
    const breakdown = {};

    // 1. Transaction Consistency (25 pts)
    // Measures how spread-out sales recording is over time
    const uniqueDates = [...new Set(sales.map(s => s.date).filter(Boolean))].sort();
    let consistencyScore = 0;
    if (uniqueDates.length >= 20) consistencyScore = 25;
    else if (uniqueDates.length >= 10) consistencyScore = 20;
    else if (uniqueDates.length >= 5) consistencyScore = 14;
    else if (uniqueDates.length >= 2) {
        // Reward spread: ratio of unique days to day-span
        try {
            const spanDays = Math.max(
                (new Date(uniqueDates[uniqueDates.length - 1]) - new Date(uniqueDates[0])) / 86400000,
                1
            );
            const ratio = uniqueDates.length / spanDays;
            consistencyScore = Math.round(Math.min(ratio, 1) * 8) + 2; // 2-10 pts
        } catch { consistencyScore = 5; }
    } else if (uniqueDates.length === 1) consistencyScore = 3;
    breakdown.consistency = Math.min(consistencyScore, 25);

    // 2. Revenue Strength (20 pts)
    // Compares estimated monthly average vs stated monthly revenue
    let revenueScore = 0;
    const monthlyRev = parseMonthlyRevenue(userData.monthly_revenue);
    if (monthlyRev > 0 && totalSales > 0) {
        // Estimate months active from first sale date to today
        let monthsActive = 1;
        if (uniqueDates.length >= 2) {
            try {
                monthsActive = Math.max(
                    (Date.now() - new Date(uniqueDates[0]).getTime()) / (30 * 86400000),
                    1
                );
            } catch { monthsActive = 1; }
        }
        const avgMonthly = totalSales / monthsActive;
        const ratio = avgMonthly / monthlyRev;
        if (ratio >= 1.0) revenueScore = 20;
        else if (ratio >= 0.75) revenueScore = 16;
        else if (ratio >= 0.5) revenueScore = 12;
        else if (ratio >= 0.25) revenueScore = 8;
        else revenueScore = 4;
    } else if (totalSales > 0) {
        revenueScore = 6; // Has sales but no stated revenue
    }
    breakdown.revenue = Math.min(revenueScore, 20);

    // 3. Business Age (15 pts)
    // Declared age + months registered on platform
    let totalMonths = parseBizAgeMonths(userData.biz_age);
    if (userData.registered_date) {
        try {
            const monthsOnPlatform = Math.max(
                Math.floor((Date.now() - new Date(userData.registered_date).getTime()) / (30 * 86400000)),
                0
            );
            totalMonths += monthsOnPlatform;
        } catch { /* ignore bad date */ }
    }
    let ageScore;
    if (totalMonths >= 60) ageScore = 15;
    else if (totalMonths >= 36) ageScore = 12;
    else if (totalMonths >= 12) ageScore = 9;
    else if (totalMonths >= 6) ageScore = 6;
    else if (totalMonths >= 3) ageScore = 4;
    else if (totalMonths > 0) ageScore = 2;
    else ageScore = 1;
    breakdown.age = Math.min(ageScore, 15);

    // 4. Formalization (20 pts)
    // SSM/registration: verified=10, declared unverified=7, unknown=2, no=0
    // Bank account: same scale
    const hasSsm = String(userData.has_ssm || '').toLowerCase();
    const hasBank = String(userData.has_bank_account || '').toLowerCase();
    const ssmYes = hasSsm.startsWith('y') || hasSsm.startsWith('s') || hasSsm === 'ada';
    const ssmNo = hasSsm.startsWith('t') || hasSsm.startsWith('n') || hasSsm === 'belum';
    const bankYes = hasBank.startsWith('y') || hasBank.startsWith('a') || hasBank === 'ada';
    const bankNo = hasBank.startsWith('t') || hasBank.startsWith('n') || hasBank === 'belum';

    let formalScore = 0;
    if (ssmYes) formalScore += userData.ssm_verified ? 10 : 7;
    else if (!ssmNo) formalScore += 2; // unanswered
    if (bankYes) formalScore += userData.bank_verified ? 10 : 7;
    else if (!bankNo) formalScore += 2; // unanswered
    breakdown.formalization = Math.min(formalScore, 20);

    // 5. Record Volume (10 pts)
    let volScore;
    if (count >= 30) volScore = 10;
    else if (count >= 20) volScore = 8;
    else if (count >= 10) volScore = 6;
    else if (count >= 5) volScore = 4;
    else if (count >= 1) volScore = 2;
    else volScore = 0;
    breakdown.volume = volScore;

    // 6. Expense Discipline (10 pts)
    const expCount = expenses.length;
    let expScore;
    if (expCount >= 10) expScore = 10;
    else if (expCount >= 5) expScore = 7;
    else if (expCount >= 2) expScore = 4;
    else if (expCount >= 1) expScore = 2;
    else expScore = 0;
    breakdown.expenses = expScore;

    const totalScore = Math.max(0, Math.min(
        Object.values(breakdown).reduce((a, b) => a + b, 0),
        100
    ));

    let level, levelEn;
    if (totalScore >= 80)      { level = 'Cemerlang'; levelEn = 'Excellent'; }
    else if (totalScore >= 60) { level = 'Baik';      levelEn = 'Good'; }
    else if (totalScore >= 40) { level = 'Sederhana'; levelEn = 'Moderate'; }
    else                       { level = 'Rendah';    levelEn = 'Low'; }

    return { score: totalScore, level, levelEn, breakdown };
}

async function generateCreditScore(phone, userRef) {
    const snap = await userRef.get();
    if (!snap.exists) {
        console.error('[generateCreditScore] user doc not found:', phone);
        return;
    }
    const userData = snap.data();
    const prevScore = userData.credit_score || 0;
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const cur = cc.currency;
    const reg = cc.registration;

    const sales = userData.sales || [];
    const totalSales = sales.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const count = sales.length;

    const { score, level, levelEn, breakdown } = calculateCreditScore(userData);

    await userRef.update({
        credit_score: score,
        score_date: today(),
        score_breakdown: breakdown,
        score_history: FieldValue.arrayUnion({ date: today(), score }),
    });

    // Language-correct labels for AI prompt
    const isBm = lang === 'bm';
    const labels = isBm ? {
        score:   'SKOR',
        level:   'TAHAP',
        section: '📊 PECAHAN SKOR',
        c1: 'Konsistensi Jualan',
        c2: 'Kekuatan Hasil',
        c3: 'Umur Perniagaan',
        c4: 'Formalisasi',
        c5: 'Jumlah Rekod',
        c6: 'Disiplin Perbelanjaan',
        reason: 'SEBAB',
        steps:  'LANGKAH PENAMBAHBAIKAN',
        step:   'LANGKAH',
    } : {
        score:   'SCORE',
        level:   'LEVEL',
        section: '📊 SCORE BREAKDOWN',
        c1: 'Transaction Consistency',
        c2: 'Revenue Strength',
        c3: 'Business Age',
        c4: 'Formalization',
        c5: 'Record Volume',
        c6: 'Expense Discipline',
        reason: 'REASON',
        steps:  'IMPROVEMENT STEPS',
        step:   'STEP',
    };
    const displayLevel = isBm ? level : levelEn;
    const langInstr = isBm ? 'Bahasa Malaysia' : 'English';

    const prompt = `You are a credit advisor for small businesses. The credit score is ALREADY calculated — do NOT change it.
Respond entirely in ${langInstr}.

${labels.score}: ${score}/100
${labels.level}: ${displayLevel}

Score breakdown:
- ${labels.c1}: ${breakdown.consistency}/25
- ${labels.c2}: ${breakdown.revenue}/20
- ${labels.c3}: ${breakdown.age}/15
- ${labels.c4} (${reg} + Bank): ${breakdown.formalization}/20
- ${labels.c5}: ${breakdown.volume}/10
- ${labels.c6}: ${breakdown.expenses}/10

Business: ${userData.business_name || '-'} | Product: ${userData.product || '-'}
Monthly revenue stated: ${userData.monthly_revenue || '-'} | Total recorded: ${cur}${totalSales.toLocaleString()} (${count} transactions)

Use EXACTLY this format (fill in [...] parts):
${labels.score}: ${score}/100
${labels.level}: ${displayLevel}

${labels.section}:
• ${labels.c1}: ${breakdown.consistency}/25
• ${labels.c2}: ${breakdown.revenue}/20
• ${labels.c3}: ${breakdown.age}/15
• ${labels.c4}: ${breakdown.formalization}/20
• ${labels.c5}: ${breakdown.volume}/10
• ${labels.c6}: ${breakdown.expenses}/10

${labels.reason}: [1 sentence explaining the overall score]

${labels.steps}:
${labels.step} 1: [specific actionable improvement]
${labels.step} 2: [second improvement]
${labels.step} 3: [third improvement]`;

    let aiText = '';
    try {
        aiText = await genText(prompt);
    } catch {
        aiText = `${labels.score}: ${score}/100\n${labels.level}: ${displayLevel}\n\n${labels.section}:\n• ${labels.c1}: ${breakdown.consistency}/25\n• ${labels.c2}: ${breakdown.revenue}/20\n• ${labels.c3}: ${breakdown.age}/15\n• ${labels.c4}: ${breakdown.formalization}/20\n• ${labels.c5}: ${breakdown.volume}/10\n• ${labels.c6}: ${breakdown.expenses}/10`;
    }

    const loanNudge = score >= 60
        ? (isBm
            ? `\n🏦 Skor awak dah cukup baik — taip *5* untuk lihat pinjaman yang awak layak!`
            : `\n🏦 Your score is strong enough — type *5* to see loans you qualify for!`)
        : (isBm
            ? `\n🏦 Skor rendah? Masih boleh cuba — taip *5* untuk lihat pilihan pinjaman awak`
            : `\n🏦 Low score? Still worth trying — type *5* to explore loan options anyway`);

    await sendMessage(phone, isBm
        ? `📊 *Laporan Skor Kredit Awak*\n\n${aiText}\n\n━━━━━━━━━━━━━━━━━━━━\n🔬 _Skor dikira menggunakan 6 kriteria yang telus._\n━━━━━━━━━━━━━━━━━━━━\n\n💡 Rekod lebih banyak jualan untuk tingkatkan skor!${loanNudge}\nTaip *SIJIL* untuk sijil kredit awak\nTaip *MENU* untuk kembali`
        : `📊 *Your Credit Score Report*\n\n${aiText}\n\n━━━━━━━━━━━━━━━━━━━━\n🔬 _Score calculated using 6 transparent criteria._\n━━━━━━━━━━━━━━━━━━━━\n\n💡 Record more sales to improve your score!${loanNudge}\nType *CERTIFICATE* for your credit certificate\nType *MENU* to go back`
    );

    try {
        const { checkProactiveTrigger } = require('./loan_agent');
        await checkProactiveTrigger(phone, userRef, score, prevScore);
    } catch (e) {
        console.error('[proactive trigger]', e.message);
    }
}

module.exports = { calculateCreditScore, generateCreditScore };
