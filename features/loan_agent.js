const { db } = require('../db');
const { getCountry } = require('../config');
const { genText, parseJson } = require('../gemini');
const { sendMessage } = require('../send');

// ── Label → numeric converters ────────────────────────────────────────────────

function revenueToNum(label) {
    if (!label) return 0;
    const l = label.toLowerCase();
    if (l.includes('50,000') && l.includes('+')) return 60000;
    if (l.includes('50k+')) return 60000;
    if (l.includes('20') && l.includes('50')) return 35000;
    if (l.includes('20k') && l.includes('50k')) return 35000;
    if (l.includes('5') && l.includes('20')) return 12500;
    if (l.includes('5k') && l.includes('20k')) return 12500;
    return 2500; // <5k or unknown
}

function ageToMonths(label) {
    if (!label) return 0;
    const l = label.toLowerCase();
    if (l.includes('2+') || (l.includes('2') && l.includes('year') && l.includes('+'))) return 30;
    if ((l.includes('1') && l.includes('2')) || (l.includes('1') && l.includes('year'))) return 18;
    if (l.includes('6') && (l.includes('12') || l.includes('month'))) return 9;
    return 3; // <6 months
}

// Parse free-text biz age like "1.5 tahun", "18 bulan", "2 years" → months
function parseBizAgeStr(str) {
    if (!str) return 0;
    const s = String(str).toLowerCase();
    const numMatch = s.match(/(\d+(?:\.\d+)?)/);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    if (!num) return 0;
    if (s.includes('year') || s.includes('tahun')) return Math.round(num * 12);
    if (s.includes('month') || s.includes('bulan')) return Math.round(num);
    return Math.round(num * 12); // bare number → treat as years
}

function loanAmountToNum(label) {
    if (!label) return 10000;
    const l = label.toLowerCase();
    if (l.includes('200,000') || l.includes('200k+')) return 250000;
    if (l.includes('50') && l.includes('200')) return 125000;
    if (l.includes('50k') && l.includes('200k')) return 125000;
    if (l.includes('10') && l.includes('50')) return 30000;
    if (l.includes('10k') && l.includes('50k')) return 30000;
    return 5000; // <10k
}

// ── Country-aware range tables (revenue + loan amount) ───────────────────────

const COUNTRY_RANGES = {
    MY: {
        currency: 'RM',
        revenue: {
            '1': { en: 'Below RM5,000',       bm: 'Bawah RM5,000',       num: 2500 },
            '2': { en: 'RM5,000 – 20,000',    bm: 'RM5,000 – 20,000',    num: 12500 },
            '3': { en: 'RM20,000 – 50,000',   bm: 'RM20,000 – 50,000',   num: 35000 },
            '4': { en: 'RM50,000+',            bm: 'RM50,000+',            num: 60000 },
        },
        loan: {
            '1': { en: 'Below RM10,000',        bm: 'Bawah RM10,000',        num: 5000 },
            '2': { en: 'RM10,000 – 50,000',     bm: 'RM10,000 – 50,000',     num: 30000 },
            '3': { en: 'RM50,000 – 200,000',    bm: 'RM50,000 – 200,000',    num: 125000 },
            '4': { en: 'RM200,000+',             bm: 'RM200,000+',             num: 250000 },
        },
    },
    ID: {
        currency: 'Rp',
        revenue: {
            '1': { en: 'Below Rp15jt',     bm: 'Bawah Rp15jt',     num: 7_500_000 },
            '2': { en: 'Rp15jt – 60jt',    bm: 'Rp15jt – 60jt',    num: 37_500_000 },
            '3': { en: 'Rp60jt – 150jt',   bm: 'Rp60jt – 150jt',   num: 105_000_000 },
            '4': { en: 'Rp150jt+',          bm: 'Rp150jt+',          num: 200_000_000 },
        },
        loan: {
            '1': { en: 'Below Rp30jt',       bm: 'Bawah Rp30jt',       num: 15_000_000 },
            '2': { en: 'Rp30jt – 150jt',     bm: 'Rp30jt – 150jt',     num: 90_000_000 },
            '3': { en: 'Rp150jt – 600jt',    bm: 'Rp150jt – 600jt',    num: 375_000_000 },
            '4': { en: 'Rp600jt+',            bm: 'Rp600jt+',            num: 800_000_000 },
        },
    },
    PH: {
        currency: '₱',
        revenue: {
            '1': { en: 'Below ₱60k',       bm: 'Bawah ₱60k',       num: 30_000 },
            '2': { en: '₱60k – 250k',      bm: '₱60k – 250k',      num: 155_000 },
            '3': { en: '₱250k – 600k',     bm: '₱250k – 600k',     num: 425_000 },
            '4': { en: '₱600k+',            bm: '₱600k+',            num: 800_000 },
        },
        loan: {
            '1': { en: 'Below ₱120k',      bm: 'Bawah ₱120k',      num: 60_000 },
            '2': { en: '₱120k – 600k',     bm: '₱120k – 600k',     num: 360_000 },
            '3': { en: '₱600k – 2.5M',     bm: '₱600k – 2.5M',     num: 1_500_000 },
            '4': { en: '₱2.5M+',            bm: '₱2.5M+',            num: 3_500_000 },
        },
    },
};

// ── Express Q&A handlers ──────────────────────────────────────────────────────

async function handleExpressQ1(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const bizName = text.trim() || (userData.business_name || 'My Business');

    await userRef.update({ 'express_loan_data.business_name': bizName, state: 'express_loan_q2' });

    await sendMessage(phone, lang === 'bm'
        ? `*${bizName}* — nama yang menarik! 🌟\n\nSoalan 2️⃣: Apa *jenis perniagaan* awak?\n\n1️⃣ 🍜 Makanan & Minuman\n2️⃣ 🛍️ Runcit / Perniagaan\n3️⃣ 🚚 Perkhidmatan\n4️⃣ 🏭 Pembuatan\n5️⃣ 📦 Lain-lain\n\n_Balas dengan nombor_`
        : `*${bizName}* — great name! 🌟\n\nQuestion 2️⃣: What *type of business* is it?\n\n1️⃣ 🍜 Food & Beverage\n2️⃣ 🛍️ Retail / Trading\n3️⃣ 🚚 Services\n4️⃣ 🏭 Manufacturing\n5️⃣ 📦 Other\n\n_Reply with a number_`);
}

const INDUSTRY_MAP = {
    '1': { en: 'Food & Beverage', bm: 'Makanan & Minuman' },
    '2': { en: 'Retail / Trading', bm: 'Runcit / Perniagaan' },
    '3': { en: 'Services', bm: 'Perkhidmatan' },
    '4': { en: 'Manufacturing', bm: 'Pembuatan' },
    '5': { en: 'Other', bm: 'Lain-lain' },
};

async function handleExpressQ2(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const entry = INDUSTRY_MAP[text.trim()];

    if (!entry) {
        await sendMessage(phone, lang === 'bm'
            ? `Sila balas dengan nombor 1-5:\n1️⃣ Makanan & Minuman\n2️⃣ Runcit\n3️⃣ Perkhidmatan\n4️⃣ Pembuatan\n5️⃣ Lain-lain`
            : `Please reply 1-5:\n1️⃣ Food & Beverage\n2️⃣ Retail\n3️⃣ Services\n4️⃣ Manufacturing\n5️⃣ Other`);
        return;
    }

    const industry = entry[lang] || entry.en;
    await userRef.update({ 'express_loan_data.industry': industry, state: 'express_loan_q3' });

    await sendMessage(phone, lang === 'bm'
        ? `✅ *${industry}* — noted!\n\nSoalan 3️⃣: Berapa lama perniagaan awak *beroperasi*?\n\n1️⃣ Bawah 6 bulan\n2️⃣ 6–12 bulan\n3️⃣ 1–2 tahun\n4️⃣ 2+ tahun\n\n_Balas dengan nombor_`
        : `✅ *${industry}* — noted!\n\nQuestion 3️⃣: How long has your business been *operating*?\n\n1️⃣ Less than 6 months\n2️⃣ 6–12 months\n3️⃣ 1–2 years\n4️⃣ 2+ years\n\n_Reply with a number_`);
}

const AGE_MAP = {
    '1': { en: 'Less than 6 months', bm: 'Bawah 6 bulan', months: 3 },
    '2': { en: '6–12 months', bm: '6–12 bulan', months: 9 },
    '3': { en: '1–2 years', bm: '1–2 tahun', months: 18 },
    '4': { en: '2+ years', bm: '2+ tahun', months: 30 },
};

async function handleExpressQ3(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const entry = AGE_MAP[text.trim()];

    if (!entry) {
        await sendMessage(phone, lang === 'bm'
            ? `Sila balas 1-4:\n1️⃣ Bawah 6 bulan\n2️⃣ 6–12 bulan\n3️⃣ 1–2 tahun\n4️⃣ 2+ tahun`
            : `Please reply 1-4:\n1️⃣ Less than 6 months\n2️⃣ 6–12 months\n3️⃣ 1–2 years\n4️⃣ 2+ years`);
        return;
    }

    await userRef.update({
        'express_loan_data.biz_age_label': entry[lang] || entry.en,
        'express_loan_data.biz_age_months': entry.months,
        state: 'express_loan_q4',
    });

    const country = userData.country || 'MY';
    const revRanges = (COUNTRY_RANGES[country] || COUNTRY_RANGES.MY).revenue;
    const langKey = lang === 'bm' ? 'bm' : 'en';
    const revLines = ['1', '2', '3', '4'].map(k => `${k}️⃣ ${revRanges[k][langKey]}`).join('\n');

    await sendMessage(phone, lang === 'bm'
        ? `✅ Noted!\n\nSoalan 4️⃣: Lebih kurang berapa *pendapatan bulanan* awak?\n\n${revLines}\n\n_Balas dengan nombor_`
        : `✅ Noted!\n\nQuestion 4️⃣: What is your approximate *monthly revenue*?\n\n${revLines}\n\n_Reply with a number_`);
}

async function handleExpressQ4(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const country = userData.country || 'MY';
    const revRanges = (COUNTRY_RANGES[country] || COUNTRY_RANGES.MY).revenue;
    const loanRanges = (COUNTRY_RANGES[country] || COUNTRY_RANGES.MY).loan;
    const langKey = lang === 'bm' ? 'bm' : 'en';
    const entry = revRanges[text.trim()];

    if (!entry) {
        const lines = ['1', '2', '3', '4'].map(k => `${k}️⃣ ${revRanges[k][langKey]}`).join('\n');
        await sendMessage(phone, lang === 'bm' ? `Sila balas 1-4:\n${lines}` : `Please reply 1-4:\n${lines}`);
        return;
    }

    await userRef.update({
        'express_loan_data.monthly_revenue_label': entry[langKey],
        'express_loan_data.monthly_revenue_num': entry.num,
        state: 'express_loan_q5',
    });

    const loanLines = ['1', '2', '3', '4'].map(k => `${k}️⃣ ${loanRanges[k][langKey]}`).join('\n');
    await sendMessage(phone, lang === 'bm'
        ? `✅ Noted!\n\nSoalan 5️⃣: Berapa *jumlah pinjaman* yang awak perlukan?\n\n${loanLines}\n\n_Balas dengan nombor_`
        : `✅ Noted!\n\nQuestion 5️⃣: How much *loan amount* do you need?\n\n${loanLines}\n\n_Reply with a number_`);
}

async function handleExpressQ5(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const country = userData.country || 'MY';
    const loanRanges = (COUNTRY_RANGES[country] || COUNTRY_RANGES.MY).loan;
    const langKey = lang === 'bm' ? 'bm' : 'en';
    const entry = loanRanges[text.trim()];

    if (!entry) {
        const lines = ['1', '2', '3', '4'].map(k => `${k}️⃣ ${loanRanges[k][langKey]}`).join('\n');
        await sendMessage(phone, lang === 'bm' ? `Sila balas 1-4:\n${lines}` : `Please reply 1-4:\n${lines}`);
        return;
    }

    await userRef.update({
        'express_loan_data.loan_amount_label': entry[langKey],
        'express_loan_data.loan_amount_num': entry.num,
        state: 'express_loan_q6',
    });

    await sendMessage(phone, lang === 'bm'
        ? `✅ Noted!\n\nSoalan 6️⃣: Untuk apa *tujuan pinjaman* ini?\n\n1️⃣ 📦 Stok / Inventori\n2️⃣ 🛠️ Peralatan / Mesin\n3️⃣ 📈 Pengembangan perniagaan\n4️⃣ 💰 Modal kerja\n5️⃣ 🚀 Lain-lain\n\n_Balas dengan nombor_`
        : `✅ Noted!\n\nQuestion 6️⃣: What is the *purpose* of this loan?\n\n1️⃣ 📦 Inventory / Stock\n2️⃣ 🛠️ Equipment / Machinery\n3️⃣ 📈 Business expansion\n4️⃣ 💰 Working capital\n5️⃣ 🚀 Other\n\n_Reply with a number_`);
}

const PURPOSE_MAP = {
    '1': { en: 'Inventory / Stock', bm: 'Stok / Inventori' },
    '2': { en: 'Equipment / Machinery', bm: 'Peralatan / Mesin' },
    '3': { en: 'Business expansion', bm: 'Pengembangan perniagaan' },
    '4': { en: 'Working capital', bm: 'Modal kerja' },
    '5': { en: 'Other', bm: 'Lain-lain' },
};

async function handleExpressQ6(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const entry = PURPOSE_MAP[text.trim()];

    if (!entry) {
        await sendMessage(phone, lang === 'bm'
            ? `Sila balas 1-5:\n1️⃣ Stok\n2️⃣ Peralatan\n3️⃣ Pengembangan\n4️⃣ Modal kerja\n5️⃣ Lain-lain`
            : `Please reply 1-5:\n1️⃣ Inventory\n2️⃣ Equipment\n3️⃣ Expansion\n4️⃣ Working capital\n5️⃣ Other`);
        return;
    }

    const purpose = entry[lang] || entry.en;
    // Merge purpose into express_loan_data locally — avoids an extra Firestore read
    const updatedExpressData = { ...(userData.express_loan_data || {}), purpose };
    await userRef.update({ 'express_loan_data.purpose': purpose });
    // state is set by sendMatches (loan_match_review) or the no-match fallback (menu)

    await sendMessage(phone, lang === 'bm'
        ? `⏳ Sedang mencari pinjaman terbaik untuk awak...`
        : `⏳ Finding the best loans for you...`);

    const { score, reasoning } = await generateProvisionalScore(updatedExpressData, lang);
    await userRef.update({ provisional_score: score, provisional_reasoning: reasoning });

    const matches = await matchLoans({ ...userData, provisional_score: score, express_loan_data: updatedExpressData }, lang);

    if (!matches || matches.length === 0) {
        await sendMessage(phone, lang === 'bm'
            ? `⚠️ Maaf, tiada pinjaman yang sesuai dijumpai buat masa ini.\n\nTerus rekod jualan untuk tingkatkan skor awak!\nTaip *MENU* untuk kembali.`
            : `⚠️ No matching loans found based on your profile right now.\n\nKeep recording sales to improve your score!\nType *MENU* to go back.`);
        await userRef.update({ state: 'menu' });
        return;
    }

    await sendMatches(phone, userRef, matches, score, lang);
}

// ── Provisional score via Gemini ──────────────────────────────────────────────

async function generateProvisionalScore(expressData, lang = 'en') {
    const langInstr = lang === 'bm' ? 'Bahasa Malaysia' : 'English';
    const prompt = `You are a credit analyst for ASEAN micro-loans. Score this SME applicant 0-100.

Business profile:
- Industry: ${expressData.industry || 'unknown'}
- Business age: ${expressData.biz_age_label || 'unknown'}
- Monthly revenue: ${expressData.monthly_revenue_label || 'unknown'}
- Loan amount requested: ${expressData.loan_amount_label || 'unknown'}
- Loan purpose: ${expressData.purpose || 'unknown'}

Factors: business age (older=higher), revenue vs loan ratio (lower=higher), industry risk, purpose strength.
Return ONLY valid JSON: {"score": <integer 0-100>, "reasoning": "<1 sentence in ${langInstr}>"}`;

    try {
        const result = await genText(prompt);
        const parsed = parseJson(result);
        return { score: Math.max(0, Math.min(100, parseInt(parsed.score) || 50)), reasoning: parsed.reasoning || '' };
    } catch {
        // Rule-based fallback
        let score = 35;
        const months = expressData.biz_age_months || ageToMonths(expressData.biz_age_label || '');
        if (months >= 24) score += 20;
        else if (months >= 12) score += 12;
        else if (months >= 6) score += 6;
        const rev = expressData.monthly_revenue_num || revenueToNum(expressData.monthly_revenue_label || '');
        const amt = expressData.loan_amount_num || loanAmountToNum(expressData.loan_amount_label || '');
        if (rev > 0 && amt > 0) {
            const ratio = amt / (rev * 12);
            if (ratio < 1) score += 20;
            else if (ratio < 2) score += 12;
            else if (ratio < 3) score += 6;
        }
        const reasoning = lang === 'bm'
            ? `Skor berdasarkan umur perniagaan dan nisbah pendapatan kepada pinjaman awak.`
            : `Score based on your business age and revenue-to-loan ratio.`;
        return { score: Math.min(score, 100), reasoning };
    }
}

// ── Loan matching ─────────────────────────────────────────────────────────────

async function getLoanProducts() {
    const snap = await db.collection('loan_products').where('active', '==', true).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function matchLoans(userData, lang = 'en') {
    const products = await getLoanProducts();
    const expressData = userData.express_loan_data || {};

    // Resolve monthly revenue
    let monthlyRevNum = expressData.monthly_revenue_num || 0;
    if (!monthlyRevNum) {
        const sales = userData.sales || [];
        if (sales.length >= 3) {
            const total = sales.reduce((s, x) => s + (x.amount || 0), 0);
            monthlyRevNum = Math.round((total / sales.length) * 30);
        }
    }
    if (!monthlyRevNum) monthlyRevNum = revenueToNum(expressData.monthly_revenue_label || userData.monthly_revenue || '');

    // Resolve business age
    let bizAgeMonths = expressData.biz_age_months || 0;
    if (!bizAgeMonths) {
        bizAgeMonths = parseBizAgeStr(userData.biz_age) || 6;
    }

    const loanAmtRequested = expressData.loan_amount_num || loanAmountToNum(expressData.loan_amount_label || '');
    const creditScore = userData.provisional_score || userData.credit_score || 0;
    const country = userData.country || 'MY';

    // Hard filter — track which products genuinely pass
    const qualifiedIds = new Set();
    const hardFiltered = products.filter(p => {
        if (!p.countries || !p.countries.includes(country)) return false;
        if (monthlyRevNum > 0 && monthlyRevNum < (p.min_monthly_revenue || 0)) return false;
        if (bizAgeMonths > 0 && bizAgeMonths < (p.min_business_age_months || 0)) return false;
        if (loanAmtRequested > 0 && loanAmtRequested > (p.max_amount || Infinity)) return false;
        return true;
    });
    hardFiltered.forEach(p => qualifiedIds.add(p.id));

    let eligible = hardFiltered;

    // Relax if empty — show aspirational loans so user has a goal
    if (eligible.length === 0) {
        eligible = products.filter(p => p.countries && p.countries.includes(country)).slice(0, 3);
    }

    // Score matches
    if (eligible.length === 0) return [];

    const maxRate = Math.max(...eligible.map(p => p.interest_rate || 10));
    const minRate = Math.min(...eligible.map(p => p.interest_rate || 0));
    const rateRange = Math.max(maxRate - minRate, 0.1);

    const scored = eligible.map(p => {
        const ratePct = ((maxRate - (p.interest_rate || 0)) / rateRange) * 40;
        const midAmt = ((p.min_amount || 0) + (p.max_amount || 0)) / 2;
        const amtDiff = loanAmtRequested > 0 && midAmt > 0 ? Math.abs(loanAmtRequested - midAmt) / midAmt : 0;
        const amtPct = Math.max(0, 30 - amtDiff * 30);
        const threshold = 60;
        const scorePct = creditScore >= threshold ? 20 : (creditScore / threshold) * 20;
        const docPct = Math.max(0, 10 - ((p.required_docs || []).length * 3));
        const matchPct = Math.round(ratePct + amtPct + scorePct + docPct);
        return { ...p, matchPct: Math.min(99, Math.max(40, matchPct)), qualified: qualifiedIds.has(p.id) };
    });

    scored.sort((a, b) => b.matchPct - a.matchPct);
    const top3 = scored.slice(0, 3);

    // Generate honest reasoning per match
    const langInstr = lang === 'bm' ? 'Bahasa Malaysia' : 'English';
    const revStr = monthlyRevNum > 0 ? `RM${monthlyRevNum.toLocaleString()}` : 'unknown revenue';
    const ageStr = bizAgeMonths > 0 ? `${bizAgeMonths} months` : 'unknown age';

    for (const loan of top3) {
        // Compute specific gaps for this loan
        const gaps = [];
        if (loan.min_monthly_revenue && monthlyRevNum < loan.min_monthly_revenue) {
            gaps.push(`revenue RM${monthlyRevNum.toLocaleString()}/mo vs min RM${loan.min_monthly_revenue.toLocaleString()}/mo`);
        }
        if (loan.min_credit_score && creditScore < loan.min_credit_score) {
            gaps.push(`credit score ${creditScore} vs min ${loan.min_credit_score}`);
        }
        if (loan.min_business_age_months && bizAgeMonths < loan.min_business_age_months) {
            gaps.push(`business age ${bizAgeMonths} months vs min ${loan.min_business_age_months} months`);
        }

        try {
            let prompt;
            if (loan.qualified) {
                prompt = `Write exactly 1 sentence in ${langInstr} explaining why this SME meets eligibility for this loan.
Revenue: ${revStr}/month, Business age: ${ageStr}, Loan: ${loan.product_name} (${loan.bank_name}).
Be factual. Start with "You qualify because..."`;
            } else {
                prompt = `Write exactly 1 sentence in ${langInstr} telling this SME what specific gap to close to reach this loan.
Gaps: ${gaps.length > 0 ? gaps.join('; ') : 'profile needs strengthening'}.
Loan: ${loan.product_name} (${loan.bank_name}).
Be honest and specific. Start with "To qualify, you need to..."`;
            }
            loan.reasoning = await genText(prompt);
        } catch {
            loan.reasoning = loan.qualified
                ? (lang === 'bm'
                    ? `Awak layak kerana profil perniagaan awak memenuhi syarat minimum ${loan.bank_name}.`
                    : `You qualify because your business profile meets ${loan.bank_name}'s minimum requirements.`)
                : (lang === 'bm'
                    ? `Terus rekod jualan dan tingkatkan skor untuk capai syarat ${loan.bank_name}.`
                    : `Keep recording sales and improve your score to reach ${loan.bank_name}'s requirements.`);
        }
    }

    return top3;
}

// ── Display matches & handle selection ────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];
const RANKS_EN = ['*Best Match*', '*2nd Choice*', '*3rd Choice*'];
const RANKS_BM = ['*Padanan Terbaik*', '*Pilihan Ke-2*', '*Pilihan Ke-3*'];

async function sendMatches(phone, userRef, matches, score, lang = 'en') {
    const userData = (await userRef.get()).data();
    const cc = getCountry(userData);
    const cur = cc.currency;

    await userRef.update({
        loan_matches: matches.map(m => ({
            id: m.id,
            bank_name: m.bank_name,
            product_name: m.product_name,
            max_amount: m.max_amount,
            interest_rate: m.interest_rate,
            required_docs: m.required_docs || [],
            qualified: m.qualified || false,
            matchPct: m.matchPct || 0,
            reasoning: m.reasoning || '',
        })),
        state: 'loan_match_review',
    });

    const scoreNote = score > 0
        ? ` (${lang === 'bm' ? 'skor provisional' : 'provisional score'}: *${score}*)`
        : '';

    const anyQualified = matches.some(m => m.qualified);
    const allAspirational = !anyQualified;

    let msg = lang === 'bm'
        ? `🎯 *Saya jumpa ${matches.length} pinjaman untuk awak${scoreNote}*\n\n`
        : `🎯 *I found ${matches.length} loans for you${scoreNote}*\n\n`;

    if (allAspirational) {
        msg += lang === 'bm'
            ? `⚠️ _Awak belum memenuhi syarat minimum buat masa ini. Pinjaman di bawah adalah matlamat yang boleh dicapai — terus rekod jualan untuk meningkatkan profil awak!_\n\n`
            : `⚠️ _You don't fully meet eligibility yet. The loans below are goals to work toward — keep recording sales to strengthen your profile!_\n\n`;
    }

    const ranks = lang === 'bm' ? RANKS_BM : RANKS_EN;
    matches.forEach((m, i) => {
        const amtDisplay = `${cur}${(m.max_amount || 0).toLocaleString()}`;
        const docs = (m.required_docs || []).map(d => d.replace(/_/g, ' ')).join(', ') || 'minimal docs';
        const aspTag = !m.qualified ? (lang === 'bm' ? ' _(Aspirasi)_' : ' _(Aspirational)_') : '';
        msg += `${MEDALS[i]} ${ranks[i]}: *${m.bank_name} ${m.product_name}*${aspTag}\n`;
        msg += `💰 ${lang === 'bm' ? 'Sehingga' : 'Up to'} ${amtDisplay} @ ${m.interest_rate}% p.a.\n`;
        if (m.matchPct !== undefined) msg += `📊 ${m.matchPct}% ${lang === 'bm' ? 'padanan' : 'match'}\n`;
        if (m.reasoning) {
            const icon = m.qualified ? '✅' : '⚠️';
            msg += `${icon} ${m.reasoning}\n`;
        }
        msg += `📄 ${lang === 'bm' ? 'Dokumen' : 'Need'}: ${docs}\n\n`;
    });

    const n = matches.length;
    const opts = n === 1 ? '*1*' : n === 2 ? '*1* atau *2*' : '*1*, *2*, atau *3*';
    const optsEn = n === 1 ? '*1*' : n === 2 ? '*1* or *2*' : '*1*, *2*, or *3*';
    msg += lang === 'bm'
        ? `Balas ${opts} untuk mohon.\nBalas *MENU* untuk kembali.`
        : `Reply ${optsEn} to apply.\nReply *MENU* to go back.`;

    await sendMessage(phone, msg);
}

async function handleLoanSelection(phone, text, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const tUpper = text.trim().toUpperCase();

    const idx = parseInt(tUpper) - 1;
    const matches = userData.loan_matches || [];

    if (isNaN(idx) || idx < 0 || idx >= matches.length) {
        const n = matches.length;
        const optsMsg = n === 1 ? '*1*' : n === 2 ? (lang === 'bm' ? '*1* atau *2*' : '*1* or *2*') : (lang === 'bm' ? '*1*, *2*, atau *3*' : '*1*, *2*, or *3*');
        await sendMessage(phone, lang === 'bm'
            ? `Sila balas ${optsMsg} untuk pilih pinjaman.\nBalas *MENU* untuk kembali.`
            : `Please reply ${optsMsg} to select a loan.\nReply *MENU* to go back.`);
        return;
    }

    const selected = matches[idx];
    await userRef.update({ selected_loan: selected, state: 'loan_doc_upload' });

    const docsNeeded = (selected.required_docs || ['bank_statement']).map(d => d.replace(/_/g, ' ')).join(', ');

    const disclaimer = !selected.qualified
        ? (lang === 'bm'
            ? `\n\n💪 _Pinjaman ini adalah matlamat awak — bank akan menilai permohonan awak secara menyeluruh. Pemohon yang menunjukkan inisiatif kadang-kadang diluluskan walaupun ada jurang. Hantar permohonan dan biar bank tentukan!_`
            : `\n\n💪 _This is your stretch goal — the bank's team reviews every application holistically. Applicants who show initiative sometimes get approved despite gaps. Submit and let the bank decide!_`)
        : '';

    await sendMessage(phone, lang === 'bm'
        ? `Pilihan dibuat! 🎉${disclaimer}\n\nUntuk hantar permohonan ke *${selected.bank_name}*, saya perlukan:\n📎 ${docsNeeded}\n\nHantar gambar atau dokumen dalam chat ini sekarang.\n\n_Taip *LANGKAU* jika tiada dokumen buat masa ni._`
        : `Selection made! 🎉${disclaimer}\n\nTo submit your application to *${selected.bank_name}*, I need:\n📎 ${docsNeeded}\n\nJust send the image or document here in this chat.\n\n_Type *SKIP* if you don't have documents right now._`);
}

// ── Document upload ───────────────────────────────────────────────────────────

async function handleDocUpload(phone, mediaId, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const selected = userData.selected_loan || {};

    const refId = 'BB-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const appDoc = {
        id: refId,
        user_id: phone,
        user_name: userData.owner_name || '-',
        user_phone: phone,
        loan_product_id: selected.id || 'unknown',
        bank_name: selected.bank_name || '-',
        product_name: selected.product_name || '-',
        amount: selected.max_amount || 0,
        interest_rate: selected.interest_rate || 0,
        purpose: (userData.express_loan_data || {}).purpose || '-',
        provisional_score: userData.provisional_score || userData.credit_score || 0,
        score_reasoning: userData.provisional_reasoning || '',
        score_breakdown: userData.score_breakdown || null,
        credit_score: userData.credit_score || 0,
        score_history: userData.score_history || [],
        verification: {
            ssm_verified: userData.ssm_verified || false,
            ssm_reg_number: userData.ssm_reg_number || null,
            has_ssm: userData.has_ssm || 'unknown',
            bank_verified: userData.bank_verified || false,
            bank_acc_last4: userData.bank_acc_last4 || null,
            bank_holder_name: userData.bank_holder_name || null,
            has_bank_account: userData.has_bank_account || 'unknown',
        },
        documents: mediaId ? [mediaId] : [],
        status: 'pending_review',
        submitted_at: new Date(),
        reviewed_at: null,
        reviewer_notes: null,
        express_loan_data: userData.express_loan_data || {},
        required_docs: selected.required_docs || [],
    };

    await db.collection('loan_applications').doc(refId).set(appDoc);
    await userRef.update({ state: 'menu', last_application_id: refId, loan_application_status: 'pending_review' });

    const dashUrl = process.env.PWA_URL || 'https://bizbuddy.onrender.com/dashboard.html';
    await sendMessage(phone, lang === 'bm'
        ? `✅ *Permohonan dihantar!*\n\n📋 Rujukan: *${refId}*\n🏦 Bank: ${selected.bank_name || '-'}\n💰 Jumlah: RM${(selected.max_amount || 0).toLocaleString()}\n⏱️ Maklum balas: 3 hari bekerja\n\nSaya akan beritahu awak apabila ada kemas kini.\n👉 ${dashUrl}\n\nTaip *MENU* untuk kembali`
        : `✅ *Application submitted!*\n\n📋 Reference: *${refId}*\n🏦 Bank: ${selected.bank_name || '-'}\n💰 Amount: RM${(selected.max_amount || 0).toLocaleString()}\n⏱️ Expected response: 3 working days\n\nI'll notify you here when there's an update.\n👉 ${dashUrl}\n\nType *MENU* to go back`);
}

// ── Loan status check ─────────────────────────────────────────────────────────

async function showLoanStatus(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';

    // NOTE: For optimal performance create a composite index in Firebase Console:
    //   Collection: loan_applications  |  Fields: user_id ASC + submitted_at DESC
    //   See FIRESTORE_INDEXES.md for details.
    let snap;
    try {
        snap = await db.collection('loan_applications')
            .where('user_id', '==', phone)
            .orderBy('submitted_at', 'desc')
            .limit(5)
            .get();
    } catch {
        // Fallback: no index → fetch unsorted, sort in-memory
        const raw = await db.collection('loan_applications').where('user_id', '==', phone).limit(20).get();
        const sorted = [...raw.docs].sort((a, b) => {
            const aTime = a.data().submitted_at?.toMillis?.() || 0;
            const bTime = b.data().submitted_at?.toMillis?.() || 0;
            return bTime - aTime;
        }).slice(0, 5);
        snap = { docs: sorted, empty: sorted.length === 0 };
    }

    if (!snap || snap.empty) {
        await sendMessage(phone, lang === 'bm'
            ? `📋 *Permohonan Pinjaman Awak*\n\nTiada permohonan lagi.\n\nTaip *5* untuk mulakan permohonan express!\nTaip *MENU* untuk kembali`
            : `📋 *Your Loan Applications*\n\nNo applications yet.\n\nType *5* to start an express loan application!\nType *MENU* to go back`);
        return;
    }

    const statusEmoji = { pending_review: '⏳', approved: '✅', rejected: '❌', needs_info: '📝' };
    const statusLabel = {
        pending_review: lang === 'bm' ? 'Dalam Semakan' : 'Under Review',
        approved: lang === 'bm' ? 'Diluluskan' : 'Approved',
        rejected: lang === 'bm' ? 'Tidak Diluluskan' : 'Not Approved',
        needs_info: lang === 'bm' ? 'Maklumat Lanjut Diperlukan' : 'More Info Needed',
    };

    let msg = lang === 'bm' ? `📋 *Permohonan Pinjaman Awak*\n\n` : `📋 *Your Loan Applications*\n\n`;

    snap.docs.forEach((doc, i) => {
        const d = doc.data();
        const submittedAt = d.submitted_at?.toDate?.() || new Date(d.submitted_at || Date.now());
        const hoursAgo = Math.round((Date.now() - submittedAt.getTime()) / 3600000);
        const timeStr = hoursAgo < 1 ? (lang === 'bm' ? 'Baru sahaja' : 'Just now')
            : hoursAgo < 24 ? `${hoursAgo}h ${lang === 'bm' ? 'lalu' : 'ago'}`
            : `${Math.round(hoursAgo / 24)}d ${lang === 'bm' ? 'lalu' : 'ago'}`;
        const emoji = statusEmoji[d.status] || '⏳';
        const label = statusLabel[d.status] || d.status;
        msg += `${i + 1}. *${d.bank_name} — RM${(d.amount || 0).toLocaleString()}*\n`;
        msg += `   Ref: ${d.id} | ${emoji} ${label}\n`;
        msg += `   ${lang === 'bm' ? 'Dihantar' : 'Submitted'}: ${timeStr}\n\n`;
    });

    msg += lang === 'bm' ? `Taip *MENU* untuk kembali` : `Type *MENU* to go back`;
    await sendMessage(phone, msg);
}

// ── Proactive trigger when score crosses 70 ───────────────────────────────────

async function checkProactiveTrigger(phone, userRef, newScore, prevScore) {
    if (prevScore >= 70 || newScore < 70) return;
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const sales = userData.sales || [];
    const total = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const avgMonthly = sales.length > 0 ? Math.round(total / sales.length * 30) : 0;
    const cc = getCountry(userData);
    const cur = cc.currency;
    const name = userData.owner_name || userData.business_name || (lang === 'bm' ? 'Peniaga' : 'there');

    await sendMessage(phone, lang === 'bm'
        ? `🎉 *Berita gembira, ${name}!*\n\nSkor kredit awak baru capai *${newScore}*!\n\nBerdasarkan hasil bulanan anggaran ${cur}${avgMonthly.toLocaleString()} awak, saya jumpa *3 pinjaman* yang awak mungkin layak!\n\n_Balas *YA* untuk tengok pinjaman atau *MENU* untuk kembali_`
        : `🎉 *Big news, ${name}!*\n\nYour credit score just hit *${newScore}*!\n\nBased on your estimated ${cur}${avgMonthly.toLocaleString()} monthly revenue, I found *3 loans* you likely qualify for!\n\n_Reply *YES* to see loans or *MENU* to go back_`);

    await userRef.update({ state: 'loan_proactive_review' });
}

module.exports = {
    matchLoans,
    sendMatches,
    handleLoanSelection,
    handleDocUpload,
    showLoanStatus,
    checkProactiveTrigger,
    generateProvisionalScore,
    handleExpressQ1,
    handleExpressQ2,
    handleExpressQ3,
    handleExpressQ4,
    handleExpressQ5,
    handleExpressQ6,
    revenueToNum,
    ageToMonths,
    loanAmountToNum,
};
