require('dotenv').config();
const axios = require('axios');

const { WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID } = process.env;
const MAX_RETRIES = 3;

async function sendMessage(phone, text) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await axios.post(
                `https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: phone,
                    type: 'text',
                    text: { body: text },
                },
                {
                    headers: {
                        Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000,
                }
            );
            console.log(`[send] to=${phone} status=${res.status}`);
            return;
        } catch (err) {
            const status = err.response?.status;
            console.error(`[send ERROR] to=${phone} attempt=${attempt}/${MAX_RETRIES}`, err.response?.data || err.message);
            // Don't retry auth errors or bad requests — only network/5xx
            if (status && status < 500 && status !== 429) break;
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

module.exports = { sendMessage };
