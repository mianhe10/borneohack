require('dotenv').config();
const express = require('express');
const { handleText } = require('./handlers/text');
const { handleImage, transcribeAudio } = require('./handlers/image');

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

app.listen(PORT, () => console.log(`BizBuddy running on port ${PORT}`));
