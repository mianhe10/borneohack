const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function parseSale(text) {
    const prompt = `Extract sales data from this message. Return ONLY valid JSON, no markdown, no explanation.
Format: {"item": string, "quantity": number, "price": number}
If cannot parse sales info, return: {"error": "cannot parse"}

Message: "${text}"`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    try {
        return JSON.parse(raw);
    } catch {
        // Gemini sometimes wraps in ```json ... ```
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        return { error: 'cannot parse' };
    }
}

module.exports = { parseSale };
