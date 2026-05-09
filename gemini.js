require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), ms)),
    ]);
}

async function withRetry(fn, retries = MAX_RETRIES) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await withTimeout(fn(), TIMEOUT_MS);
        } catch (err) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function genText(prompt) {
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text().trim();
}

async function genTextWithImage(prompt, imageBuffer, mimeType = 'image/jpeg') {
    const imagePart = { inlineData: { data: imageBuffer.toString('base64'), mimeType } };
    const result = await withRetry(() => model.generateContent([prompt, imagePart]));
    return result.response.text().trim();
}

async function genTextWithAudio(prompt, audioBuffer, mimeType = 'audio/ogg') {
    const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType } };
    const result = await withRetry(() => model.generateContent([prompt, audioPart]));
    return result.response.text().trim();
}

function parseJson(raw) {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(cleaned);
}

module.exports = { genText, genTextWithImage, genTextWithAudio, parseJson };
