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

async function showLoanReferral(phone, userRef) {
    const userData = (await userRef.get()).data();
    const lang = userData.language || 'bm';
    const cc = getCountry(userData);
    const cur = cc.currency;
    const score = userData.credit_score || 0;

    if (!score || score < 70) {
        const needed = 70 - (score || 0);
        await sendMessage(phone, lang === 'bm'
            ? `⚠️ *Skor kredit awak belum mencukupi untuk rujukan pinjaman.*\n\nSkor semasa: ${score}/100\nSkor minimum: 70/100\nPerlukan: +${needed} lagi mata\n\n💡 Cara tingkatkan skor:\n• Rekod lebih banyak jualan setiap hari\n• Rekod perbelanjaan awak\n• Daftar ${cc.registration} jika belum\n• Buka akaun bank perniagaan\n\nTaip *PECAHAN* untuk lihat pecahan skor\nTaip *MENU* untuk kembali`
            : `⚠️ *Your credit score is not yet sufficient for loan referral.*\n\nCurrent score: ${score}/100\nMinimum required: 70/100\nNeed: +${needed} more points\n\n💡 How to improve:\n• Record more sales daily\n• Track your expenses\n• Register with ${cc.registration} if not done\n• Open a business bank account\n\nType *BREAKDOWN* to see score details\nType *MENU* to go back`
        );
        return;
    }

    const sales = userData.sales || [];
    const totalSales = sales.reduce((s, x) => s + (x.amount || 0), 0);
    const txnCount = sales.length;
    const scoreDate = userData.score_date || '-';
    const certId = `NC-${phone.slice(-4)}-${scoreDate.replace(/-/g, '')}`;
    const loan = cc.loan_program;

    const referralMsg = lang === 'bm'
        ? `📋 PERMOHONAN PENILAIAN PINJAMAN\n${'='.repeat(35)}\n\nKepada: Pegawai ${loan}\n\nSaya ingin memohon penilaian pinjaman mikro.\n\nMAKLUMAT PEMOHON:\n• Nama: ${userData.owner_name || '-'}\n• Perniagaan: ${userData.business_name || '-'}\n• Produk/Perkhidmatan: ${userData.product || '-'}\n• Pendapatan Bulanan: ${userData.monthly_revenue || '-'}\n• Negara: ${cc.flag} ${cc.name}\n• Negeri: ${userData.user_state || '-'}\n\nREKOD KEWANGAN (BizBuddy):\n• Jumlah Jualan Direkod: ${cur}${totalSales}\n• Bilangan Transaksi: ${txnCount}\n• Skor Kredit BizBuddy: ${score}/100\n• ID Sijil: ${certId}\n• Tarikh Skor: ${scoreDate}\n\nSkor ini dijana oleh BizBuddy AI berdasarkan 6 kriteria yang telus.\n\nTerima kasih.\n${'='.repeat(35)}\nPowered by BizBuddy | bizbuddy.my`
        : `📋 LOAN ASSESSMENT REQUEST\n${'='.repeat(35)}\n\nTo: ${loan} Officer\n\nI would like to request a micro-loan assessment.\n\nAPPLICANT INFO:\n• Name: ${userData.owner_name || '-'}\n• Business: ${userData.business_name || '-'}\n• Product/Service: ${userData.product || '-'}\n• Monthly Income: ${userData.monthly_revenue || '-'}\n• Country: ${cc.flag} ${cc.name}\n• State: ${userData.user_state || '-'}\n\nFINANCIAL RECORDS (BizBuddy):\n• Total Recorded Sales: ${cur}${totalSales}\n• Number of Transactions: ${txnCount}\n• BizBuddy Credit Score: ${score}/100\n• Certificate ID: ${certId}\n• Score Date: ${scoreDate}\n\nThis score was generated by BizBuddy AI based on 6 transparent criteria.\n\nThank you.\n${'='.repeat(35)}\nPowered by BizBuddy | bizbuddy.my`;

    await sendMessage(phone, lang === 'bm'
        ? `🏦 *RUJUKAN PINJAMAN SEDIA!*\n\nMesej berikut telah dijana untuk awak.\n📋 *Copy dan hantar* kepada pegawai ${loan}:\n\n━━━━━━━━━━━━━━━━━━━━\n${referralMsg}\n━━━━━━━━━━━━━━━━━━━━\n\n📱 *Langkah seterusnya:*\n1. Screenshot mesej di atas\n2. Hantar ke pejabat ${loan} terdekat\n3. Atau email ke pegawai pinjaman\n\nTaip *SIJIL* untuk sijil kredit awak\nTaip *MENU* untuk kembali`
        : `🏦 *LOAN REFERRAL READY!*\n\nThe following message has been generated for you.\n📋 *Copy and send* to a ${loan} officer:\n\n━━━━━━━━━━━━━━━━━━━━\n${referralMsg}\n━━━━━━━━━━━━━━━━━━━━\n\n📱 *Next steps:*\n1. Screenshot the message above\n2. Send to your nearest ${loan} office\n3. Or email to a loan officer\n\nType *CERTIFICATE* for your credit certificate\nType *MENU* to go back`
    );
}

module.exports = { showLoanChecklist, showLoanReferral };
