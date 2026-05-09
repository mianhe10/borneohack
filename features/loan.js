const { getCountry, getCurrency } = require('../config');
const { sendMessage } = require('../send');

async function showLoanChecklist(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const sales = userData.sales || [];

    const hasProfile = !!userData.owner_name;
    const hasSales = sales.length > 0;
    const has10Txn = sales.length >= 10;
    const hasBank = (userData.has_bank_account || '').toLowerCase().startsWith('y');
    const hasSsm = (userData.has_ssm || '').toLowerCase().startsWith('y');
    const hasScore = (userData.credit_score || 0) >= 60;
    let has30Days = false;
    if (sales.length >= 2) {
        const dates = sales.map(s => s.date).filter(Boolean).sort();
        if (dates.length >= 2) {
            try {
                const diff = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000;
                has30Days = diff >= 30;
            } catch { /* ignore */ }
        }
    }

    const reg = cc.registration;
    const checks = [
        [hasProfile,  lang === 'bm' ? 'Profil perniagaan wujud' : 'Business profile created',                lang === 'bm' ? 'Daftar profil awak' : 'Register your profile'],
        [hasSales,    lang === 'bm' ? 'Rekod jualan pertama' : 'First sale recorded',                        lang === 'bm' ? 'Rekod jualan pertama awak' : 'Record your first sale'],
        [has10Txn,    lang === 'bm' ? `10+ transaksi (${sales.length}/10)` : `10+ transactions (${sales.length}/10)`,  lang === 'bm' ? 'Rekod lebih banyak jualan' : 'Record more sales'],
        [has30Days,   lang === 'bm' ? '30 hari rekod jualan' : '30 days of sales records',                  lang === 'bm' ? 'Terus rekod setiap hari' : 'Keep recording daily'],
        [hasBank,     lang === 'bm' ? 'Ada akaun bank perniagaan' : 'Has business bank account',             lang === 'bm' ? 'Buka akaun bank perniagaan' : 'Open a business bank account'],
        [hasSsm,      lang === 'bm' ? `Berdaftar ${reg}` : `${reg} registered`,                             lang === 'bm' ? `Daftar ${reg} di ${cc.reg_url}` : `Register at ${cc.reg_url}`],
        [hasScore,    lang === 'bm' ? `Skor kredit 60+ (kini: ${userData.credit_score || '?'})` : `Credit score 60+ (now: ${userData.credit_score || '?'})`, lang === 'bm' ? 'Jana skor kredit → pilih 2' : 'Generate credit score → choose 2'],
    ];

    const done = checks.filter(c => c[0]).length;
    const total = checks.length;
    const pct = Math.round((done / total) * 100);
    const filled = Math.round(pct / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    let lines = '';
    for (const [check, label, action] of checks) {
        lines += check ? `✅ ${label}\n` : `⬜ ${label}\n    ↳ ${action}\n`;
    }

    let status;
    if (pct === 100) status = lang === 'bm' ? `🎉 TAHNIAH! Awak layak mohon pinjaman ${cc.loan_program}!` : `🎉 CONGRATULATIONS! You qualify for a ${cc.loan_program} loan!`;
    else if (pct >= 70) status = lang === 'bm' ? `🔥 Hampir layak! Siapkan ${total - done} lagi syarat.` : `🔥 Almost there! Complete ${total - done} more requirements.`;
    else if (pct >= 40) status = lang === 'bm' ? `💪 Dalam proses. Perlukan ${total - done} lagi syarat.` : `💪 In progress. Need ${total - done} more requirements.`;
    else status = lang === 'bm' ? `📈 Baru bermula. Perlukan ${total - done} lagi syarat.` : `📈 Just starting. Need ${total - done} more requirements.`;

    await sendMessage(phone, lang === 'bm'
        ? `🏦 *SENARAI SEMAK PINJAMAN ${cc.loan_program.toUpperCase()}*\n\nKemajuan: [${bar}] ${pct}%\n(${done}/${total} syarat dipenuhi)\n\n${lines}\n${status}\n\n━━━━━━━━━━━━━━━━━━━━\n💡 ${cc.loan_program}: sehingga ${cc.loan_amount}\n💡 Faedah rendah: ${cc.loan_rate} setahun\n━━━━━━━━━━━━━━━━━━━━\nTaip *MENU* untuk kembali`
        : `🏦 *${cc.loan_program.toUpperCase()} LOAN READINESS CHECKLIST*\n\nProgress: [${bar}] ${pct}%\n(${done}/${total} requirements met)\n\n${lines}\n${status}\n\n━━━━━━━━━━━━━━━━━━━━\n💡 ${cc.loan_program}: up to ${cc.loan_amount}\n💡 Low interest: ${cc.loan_rate} per year\n━━━━━━━━━━━━━━━━━━━━\nType *MENU* to go back`
    );
}

module.exports = { showLoanChecklist };
