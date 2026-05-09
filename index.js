require('dotenv').config();
// Set PWA_URL env var to your deployed PWA (e.g., https://bizbuddy.onrender.com)
const express = require('express');
const { handleText } = require('./handlers/text');
const { handleImage, transcribeAudio } = require('./handlers/image');
const { db } = require('./db');
const { sendMessage } = require('./send');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// ── Deduplication: remember last 500 msg IDs (in-memory, resets on restart) ──
const seenMsgIds = new Set();
const SEEN_MAX = 500;
function isDuplicate(id) {
    if (!id) return false;
    if (seenMsgIds.has(id)) return true;
    seenMsgIds.add(id);
    if (seenMsgIds.size > SEEN_MAX) seenMsgIds.delete(seenMsgIds.values().next().value);
    return false;
}

// ── Per-phone queue: prevents race conditions from concurrent messages ──
const phoneQueues = new Map();
function enqueue(phone, fn) {
    const prev = phoneQueues.get(phone) || Promise.resolve();
    const next = prev.then(fn).catch(err => console.error(`[queue error] ${phone}:`, err));
    phoneQueues.set(phone, next);
    next.finally(() => { if (phoneQueues.get(phone) === next) phoneQueues.delete(phone); });
}

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
    res.sendStatus(200);

    try {
        const body = req.body;
        if (body.object !== 'whatsapp_business_account') return;

        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const messages = value?.messages;
        if (!messages?.length) return;

        const msg = messages[0];
        const phone = msg.from;
        const type = msg.type;
        const msgId = msg.id;

        if (isDuplicate(msgId)) {
            console.log(`[DEDUP] skipped ${msgId}`);
            return;
        }

        enqueue(phone, async () => {
            if (type === 'text') {
                const text = msg.text?.body || '';
                console.log(`[TEXT] ${phone}: ${text}`);
                await handleText(phone, text);
            } else if (type === 'image') {
                const imageId = msg.image?.id;
                const caption = msg.image?.caption || '';
                console.log(`[IMAGE] ${phone}: id=${imageId}`);
                if (imageId) await handleImage(phone, imageId, caption);
            } else if (type === 'document') {
                const docId = msg.document?.id;
                const caption = msg.document?.caption || '';
                console.log(`[DOC] ${phone}: id=${docId}`);
                if (docId) await handleImage(phone, docId, caption);
            } else if (type === 'audio') {
                const audioId = msg.audio?.id;
                console.log(`[AUDIO] ${phone}: id=${audioId}`);
                if (audioId) await transcribeAudio(phone, audioId);
            }
        });
    } catch (err) {
        console.error('Webhook handler error:', err);
    }
});

// Bank portal session — validates access code, returns API key for x-bank-key header
app.post('/api/bank-session', (req, res) => {
    const { access_code } = req.body;
    if (access_code !== 'bank2026') {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    if (!process.env.BANK_API_KEY) {
        console.error('[bank-session] BANK_API_KEY env var not set');
        return res.status(500).json({ error: 'Server misconfigured' });
    }
    res.json({ ok: true, bank_key: process.env.BANK_API_KEY });
});

// Bank portal → notify user of application status change
app.post('/notify_user', async (req, res) => {
    const providedKey = req.headers['x-bank-key'];
    const expectedKey = process.env.BANK_API_KEY;
    if (!expectedKey) {
        console.error('[notify_user] BANK_API_KEY env var not set');
        return res.status(500).json({ error: 'Server misconfigured' });
    }
    if (providedKey !== expectedKey) {
        console.warn('[notify_user] unauthorized attempt from', req.ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { application_id, status, reviewer_notes } = req.body;
        if (!application_id || !status) return res.status(400).json({ error: 'Missing application_id or status' });
        const validStatuses = ['approved', 'rejected', 'needs_info'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: `status must be: ${validStatuses.join(' | ')}` });

        const appRef = db.collection('loan_applications').doc(application_id);
        const appSnap = await appRef.get();
        if (!appSnap.exists) return res.status(404).json({ error: 'Application not found' });

        const app2 = appSnap.data();
        const phone = app2.user_phone;
        const name = app2.user_name || 'there';
        const bankName = app2.bank_name || 'the bank';
        const amount = (app2.amount || 0).toLocaleString();

        await appRef.update({ status, reviewer_notes: reviewer_notes || null, reviewed_at: new Date() });

        const userSnap = await db.collection('users').doc(phone).get();
        const lang = userSnap.exists ? (userSnap.data().language || 'en') : 'en';

        let msg;
        if (status === 'approved') {
            msg = lang === 'bm'
                ? `🎉 *Tahniah ${name}!*\n\nPermohonan pinjaman awak telah *DILULUSKAN*:\n🏦 ${bankName}\n💰 RM${amount}\n📅 Pengeluaran: 3 hari bekerja\n\nPihak bank akan menghubungi awak tidak lama lagi untuk proses akhir. Tahniah sekali lagi! 🚀`
                : `🎉 *Congratulations ${name}!*\n\nYour loan application has been *APPROVED*:\n🏦 ${bankName}\n💰 RM${amount}\n📅 Disbursement: 3 working days\n\nThe bank will contact you shortly to finalize. Congratulations! 🚀`;
        } else if (status === 'rejected') {
            const reason = reviewer_notes || (lang === 'bm' ? 'tidak dinyatakan' : 'not specified');
            msg = lang === 'bm'
                ? `Permohonan awak tidak berjaya kali ini. 😔\n\n📝 Sebab: ${reason}\n\nJangan risau — terus rekod jualan untuk tingkatkan skor awak, dan saya akan cari peluang baru untuk awak! 💪\n\nTaip *5* untuk cuba pinjaman lain atau *MENU* untuk kembali.`
                : `Your application was not approved this time. 😔\n\n📝 Reason: ${reason}\n\nDon't worry — keep recording your sales to improve your score, and I'll find new matches for you! 💪\n\nType *5* to try another loan or *MENU* to go back.`;
        } else {
            const note = reviewer_notes || (lang === 'bm' ? 'Sila hubungi bank untuk butiran lanjut.' : 'Please contact the bank for details.');
            msg = lang === 'bm'
                ? `📝 *Maklumat Tambahan Diperlukan*\n\nBank memerlukan maklumat tambahan untuk permohonan awak:\n\n${note}\n\nTaip *MENU* untuk kembali.`
                : `📝 *Additional Information Required*\n\nThe bank needs more information for your application:\n\n${note}\n\nType *MENU* to go back.`;
        }

        await sendMessage(phone, msg);
        console.log(`[notify_user] ${application_id} → ${status} → ${phone}`);
        res.json({ ok: true, phone, status });
    } catch (err) {
        console.error('[notify_user error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Rate limiter: max 5 requests per phone per hour (in-memory) ──
const rateMap = new Map(); // phone -> [timestamps]
function rateLimit(phone) {
    const now = Date.now();
    const hits = (rateMap.get(phone) || []).filter(t => now - t < 3600000);
    if (hits.length >= 5) return false;
    hits.push(now);
    rateMap.set(phone, hits);
    return true;
}

// Range → midpoint converters
function parseRevenue(range, country) {
    // range is one of the button values: '<2000','2000-5000','5000-10000','>10000'
    // For ID multiply by ~1000 (Rp), for PH use peso equivalents
    const multiplier = country === 'ID' ? 1000 : 1;
    if (!range) return 5000 * multiplier;
    if (range.startsWith('>')) return parseInt(range.slice(1)) * 1.5 * multiplier;
    if (range.startsWith('<')) return parseInt(range.slice(1)) * 0.5 * multiplier;
    const parts = range.split('-').map(Number);
    return ((parts[0] + parts[1]) / 2) * multiplier;
}
function parseAge(range) {
    // range: '<6','6-12','12-36','36+'  (months)
    if (!range) return 12;
    if (range.startsWith('>') || range.endsWith('+')) return parseInt(range) * 1.5;
    if (range.startsWith('<')) return parseInt(range.slice(1)) * 0.5;
    const parts = range.split('-').map(Number);
    return (parts[0] + parts[1]) / 2;
}
function parseLoanAmount(range, country) {
    const multiplier = country === 'ID' ? 1000 : 1;
    if (!range) return 30000 * multiplier;
    if (range.startsWith('>')) return parseInt(range.replace(/[^0-9]/g,'')) * 1.5 * multiplier;
    if (range.startsWith('<')) return parseInt(range.replace(/[^0-9]/g,'')) * 0.5 * multiplier;
    const parts = range.split('-').map(s => parseInt(s.replace(/[^0-9]/g,'')));
    return ((parts[0] + parts[1]) / 2) * multiplier;
}

app.post('/api/match-loans', async (req, res) => {
    try {
        const { name, phone, country = 'MY', loan_amount_range, purpose, monthly_revenue_range, business_age_range, industry } = req.body;

        // Validate
        if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
        const cleanPhone = phone.replace(/\s/g, '').replace(/^\+/, '');
        if (!/^\d{7,15}$/.test(cleanPhone)) return res.status(400).json({ error: 'Invalid phone number' });

        // Rate limit
        if (!rateLimit(cleanPhone)) return res.status(429).json({ error: 'Too many requests. Try again in an hour.' });

        // Generate token
        const token = 'BB-' + Math.random().toString(36).substring(2, 10).toUpperCase();

        // Parse ranges to numbers
        const monthlyRevNum = parseRevenue(monthly_revenue_range, country);
        const bizAgeMonths = parseAge(business_age_range);
        const loanAmountNum = parseLoanAmount(loan_amount_range, country);

        // Build userData shell for matchLoans
        const userData = {
            country,
            provisional_score: 0,
            credit_score: 0,
            sales: [],
            monthly_revenue: String(monthlyRevNum),
            express_loan_data: {
                monthly_revenue_num: monthlyRevNum,
                monthly_revenue_label: monthly_revenue_range || '',
                biz_age_months: bizAgeMonths,
                biz_age_label: business_age_range || '',
                loan_amount_num: loanAmountNum,
                loan_amount_label: loan_amount_range || '',
                industry: industry || 'Others',
                purpose: purpose || 'Working capital',
            },
        };

        // Call existing matchLoans
        const { matchLoans } = require('./features/loan_agent');
        const matches = await matchLoans(userData, 'en');

        // Compute estimated monthly repayment for each match (simple flat rate)
        const enrichedMatches = matches.map(m => {
            const amt = Math.min(loanAmountNum, m.max_amount || loanAmountNum);
            const tenureMonths = m.tenure_months_max || 60;
            const monthlyRate = (m.interest_rate || 7) / 100 / 12;
            const repayment = monthlyRate > 0
                ? amt * monthlyRate / (1 - Math.pow(1 + monthlyRate, -tenureMonths))
                : amt / tenureMonths;
            return {
                loan_product_id: m.id,
                bank_name: m.bank_name,
                product_name: m.product_name,
                amount: amt,
                interest_rate: m.interest_rate,
                match_percentage: m.matchPct,
                tenure_months_max: tenureMonths,
                estimated_monthly_repayment: Math.round(repayment * 100) / 100,
                reasoning: m.reasoning || '',
                required_docs: m.required_docs || [],
            };
        });

        // Save to Firestore landing_signups/{token}
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
        await db.collection('landing_signups').doc(token).set({
            token,
            name,
            phone: cleanPhone,
            country,
            loan_amount_range,
            loan_amount_num: loanAmountNum,
            purpose: purpose || '',
            monthly_revenue_estimate: monthlyRevNum,
            business_age_months: bizAgeMonths,
            industry: industry || 'Others',
            express_loan_data: userData.express_loan_data,
            matches: enrichedMatches,
            selected_loan_id: null,
            status: 'pending_selection',
            created_at: new Date(),
            expires_at: expiresAt,
        });

        const responseMatches = enrichedMatches.length > 0
            ? { ok: true, token, matches: enrichedMatches }
            : { ok: true, token, matches: [], message: "No matches found right now. Try tracking your business to build a stronger profile." };

        res.json(responseMatches);
    } catch (err) {
        console.error('[/api/match-loans error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/match-loans/:token/select', async (req, res) => {
    try {
        const { token } = req.params;
        const { loan_product_id } = req.body;
        if (!loan_product_id) return res.status(400).json({ error: 'loan_product_id required' });

        const docRef = db.collection('landing_signups').doc(token);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Token not found' });

        const data = snap.data();
        if (data.expires_at && data.expires_at.toDate() < new Date()) {
            return res.status(410).json({ error: 'Token expired' });
        }

        await docRef.update({
            selected_loan_id: loan_product_id,
            status: 'awaiting_whatsapp',
            selected_at: new Date(),
        });

        const waText = encodeURIComponent(`Apply ${token}`);
        const waUrl = `https://wa.me/15551483471?text=${waText}`;
        res.json({ ok: true, wa_url: waUrl });
    } catch (err) {
        console.error('[/api/match-loans/:token/select error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`BizBuddy running on port ${PORT}`));
