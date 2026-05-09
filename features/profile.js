const { getCountry, getCurrency } = require('../config');
const { sendMessage } = require('../send');

async function showProfile(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const sales = userData.sales || [];
    const total = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const count = sales.length;
    const score = userData.credit_score || (lang === 'bm' ? 'Belum dijana' : 'Not yet generated');
    const scoreDate = userData.score_date || '-';

    await sendMessage(phone, lang === 'bm'
        ? `━━━━━━━━━━━━━━━━━━━━\n📋 *PROFIL PERNIAGAAN RASMI*\n━━━━━━━━━━━━━━━━━━━━\n👤 Nama: ${userData.owner_name || '-'}\n🏪 Perniagaan: ${userData.business_name || '-'}\n📦 Produk: ${userData.product || '-'}\n🌏 Negara: ${cc.flag} ${cc.name}\n📍 Negeri: ${userData.user_state || '-'}\n💵 Pendapatan Bulanan: ${userData.monthly_revenue || '-'}\n⏱️ Lama Beroperasi: ${userData.biz_age || '-'}\n🏦 Akaun Bank: ${userData.has_bank_account || '-'}\n📝 ${cc.registration}: ${userData.has_ssm || '-'}\n━━━━━━━━━━━━━━━━━━━━\n📊 Jumlah Jualan Direkod: ${cc.currency}${total}\n🔢 Bilangan Transaksi: ${count}\n⭐ Skor Kredit: ${score}\n📅 Tarikh Skor: ${scoreDate}\n━━━━━━━━━━━━━━━━━━━━\n🏷️ _Powered by BizBuddy_\n\nTaip *MENU* untuk kembali`
        : `━━━━━━━━━━━━━━━━━━━━\n📋 *OFFICIAL BUSINESS PROFILE*\n━━━━━━━━━━━━━━━━━━━━\n👤 Name: ${userData.owner_name || '-'}\n🏪 Business: ${userData.business_name || '-'}\n📦 Product: ${userData.product || '-'}\n🌏 Country: ${cc.flag} ${cc.name}\n📍 State: ${userData.user_state || '-'}\n💵 Monthly Income: ${userData.monthly_revenue || '-'}\n⏱️ Years Operating: ${userData.biz_age || '-'}\n🏦 Bank Account: ${userData.has_bank_account || '-'}\n📝 ${cc.registration}: ${userData.has_ssm || '-'}\n━━━━━━━━━━━━━━━━━━━━\n📊 Total Recorded Sales: ${cc.currency}${total}\n🔢 Number of Transactions: ${count}\n⭐ Credit Score: ${score}\n📅 Score Date: ${scoreDate}\n━━━━━━━━━━━━━━━━━━━━\n🏷️ _Powered by BizBuddy_\n\nType *MENU* to go back`
    );
}

async function showStoredData(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const sales = userData.sales || [];
    const expenses = userData.expenses || [];

    await sendMessage(phone, lang === 'bm'
        ? `🔒 *DATA YANG DISIMPAN TENTANG AWAK*\n\n━━━━━━━━━━━━━━━━━━━━\n👤 Nama: ${userData.owner_name || '-'}\n🏪 Perniagaan: ${userData.business_name || '-'}\n📦 Produk: ${userData.product || '-'}\n💵 Pendapatan: ${userData.monthly_revenue || '-'}\n⏱️ Lama Beroperasi: ${userData.biz_age || '-'}\n🏦 Akaun Bank: ${userData.has_bank_account || '-'}\n📝 SSM: ${userData.has_ssm || '-'}\n⭐ Skor Kredit: ${userData.credit_score || '-'}\n📊 Jumlah Rekod Jualan: ${sales.length}\n📊 Jumlah Rekod Perbelanjaan: ${expenses.length}\n✅ Persetujuan: ${userData.consent_date || '-'}\n━━━━━━━━━━━━━━━━━━━━\n\n🗑️ Taip *RESET* untuk padam semua data awak\nTaip *MENU* untuk kembali`
        : `🔒 *DATA STORED ABOUT YOU*\n\n━━━━━━━━━━━━━━━━━━━━\n👤 Name: ${userData.owner_name || '-'}\n🏪 Business: ${userData.business_name || '-'}\n📦 Product: ${userData.product || '-'}\n💵 Income: ${userData.monthly_revenue || '-'}\n⏱️ Years Operating: ${userData.biz_age || '-'}\n🏦 Bank Account: ${userData.has_bank_account || '-'}\n📝 SSM: ${userData.has_ssm || '-'}\n⭐ Credit Score: ${userData.credit_score || '-'}\n📊 Sales Records: ${sales.length}\n📊 Expense Records: ${expenses.length}\n✅ Consent Given: ${userData.consent_date || '-'}\n━━━━━━━━━━━━━━━━━━━━\n\n🗑️ Type *RESET* to delete all your data\nType *MENU* to go back`
    );
}

async function showCertificate(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const score = userData.credit_score || 0;
    const scoreDate = userData.score_date || new Date().toISOString().split('T')[0];

    if (!score) {
        await sendMessage(phone, lang === 'bm'
            ? '⚠️ Awak belum jana skor kredit lagi.\nTaip *MENU* → pilih *2* untuk jana skor kredit awak dahulu.'
            : '⚠️ You haven\'t generated a credit score yet.\nType *MENU* → choose *2* to generate your credit score first.'
        );
        return;
    }

    let statusBm, statusEn, stars;
    if (score >= 70) { statusBm = '✅ BERSEDIA UNTUK PINJAMAN'; statusEn = '✅ LOAN READY'; stars = score >= 85 ? '⭐⭐⭐⭐⭐' : '⭐⭐⭐⭐'; }
    else if (score >= 50) { statusBm = '🔄 DALAM PROSES'; statusEn = '🔄 IN PROGRESS'; stars = '⭐⭐⭐'; }
    else { statusBm = '📈 PERLU TINGKATKAN'; statusEn = '📈 NEEDS IMPROVEMENT'; stars = '⭐⭐'; }

    const certId = `NC-${phone.slice(-4)}-${scoreDate.replace(/-/g, '')}`;

    await sendMessage(phone, lang === 'bm'
        ? `🏆 ━━━━━━━━━━━━━━━━━━━━ 🏆\n*SIJIL KESEDIAAN KREDIT*\n🏆 ━━━━━━━━━━━━━━━━━━━━ 🏆\n\n👤 Nama: ${userData.owner_name || '-'}\n🏪 Perniagaan: ${userData.business_name || '-'}\n\n📊 SKOR KREDIT: *${score}/100*\n⭐ TAHAP: ${stars}\n🎯 STATUS: ${statusBm}\n\n📅 Tarikh Jana: ${scoreDate}\n🆔 ID: ${certId}\n\n━━━━━━━━━━━━━━━━━━━━\nSijil ini mengesahkan bahawa\nperniagaan ini telah merekod\naktiviti kewangan dan dinilai\noleh sistem BizBuddy AI.\n━━━━━━━━━━━━━━━━━━━━\n🏷️ _Powered by BizBuddy_\n_bizbuddy.my_\n\n💡 Screenshot dan tunjukkan kepada bank!\nTaip *MENU* untuk kembali`
        : `🏆 ━━━━━━━━━━━━━━━━━━━━ 🏆\n*CREDIT READINESS CERTIFICATE*\n🏆 ━━━━━━━━━━━━━━━━━━━━ 🏆\n\n👤 Name: ${userData.owner_name || '-'}\n🏪 Business: ${userData.business_name || '-'}\n\n📊 CREDIT SCORE: *${score}/100*\n⭐ LEVEL: ${stars}\n🎯 STATUS: ${statusEn}\n\n📅 Date Issued: ${scoreDate}\n🆔 ID: ${certId}\n\n━━━━━━━━━━━━━━━━━━━━\nThis certificate verifies that\nthis business has recorded\nfinancial activity and has been\nassessed by BizBuddy AI.\n━━━━━━━━━━━━━━━━━━━━\n🏷️ _Powered by BizBuddy_\n_bizbuddy.my_\n\n💡 Screenshot and show to your bank!\nType *MENU* to go back`
    );
}

async function showScoreBreakdown(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const score = userData.credit_score || 0;
    const breakdown = userData.score_breakdown || {};

    if (!score || !Object.keys(breakdown).length) {
        await sendMessage(phone, lang === 'bm'
            ? '⚠️ Awak belum jana skor kredit lagi.\nTaip *MENU* → pilih *2* untuk jana skor kredit dahulu.'
            : '⚠️ You haven\'t generated a credit score yet.\nType *MENU* → choose *2* to generate your score first.'
        );
        return;
    }

    const categories = {
        consistency:    { max: 25, bm: 'Konsistensi Jualan', en: 'Sales Consistency' },
        revenue:        { max: 20, bm: 'Kekuatan Hasil', en: 'Revenue Strength' },
        age:            { max: 15, bm: 'Umur Perniagaan', en: 'Business Age' },
        formalization:  { max: 20, bm: `Formalisasi (${cc.registration})`, en: `Formalization (${cc.registration})` },
        volume:         { max: 10, bm: 'Jumlah Rekod', en: 'Record Volume' },
        expenses:       { max: 10, bm: 'Disiplin Perbelanjaan', en: 'Expense Discipline' },
    };

    let lines = '';
    let weakestKey = null, weakestPct = 100;
    for (const [key, info] of Object.entries(categories)) {
        const val = breakdown[key] || 0;
        const pct = Math.round((val / info.max) * 100);
        const filled = Math.round(pct / 10);
        const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
        const label = lang === 'bm' ? info.bm : info.en;
        lines += `  ${label}\n  [${bar}] ${val}/${info.max}\n\n`;
        if (pct < weakestPct) { weakestPct = pct; weakestKey = key; }
    }

    const weakestLabel = weakestKey ? (lang === 'bm' ? categories[weakestKey].bm : categories[weakestKey].en) : '';

    await sendMessage(phone, lang === 'bm'
        ? `📊 *PECAHAN SKOR KREDIT*\n\nSkor Keseluruhan: *${score}/100*\n\n${lines}⚡ *Fokus tingkatkan:* ${weakestLabel}\n\nTaip *MENU* untuk kembali`
        : `📊 *CREDIT SCORE BREAKDOWN*\n\nOverall Score: *${score}/100*\n\n${lines}⚡ *Focus on improving:* ${weakestLabel}\n\nType *MENU* to go back`
    );
}

module.exports = { showProfile, showStoredData, showCertificate, showScoreBreakdown };
