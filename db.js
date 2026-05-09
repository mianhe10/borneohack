require('dotenv').config();
const admin = require('firebase-admin');

const firebaseCreds = JSON.parse(
    Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString()
);

admin.initializeApp({ credential: admin.credential.cert(firebaseCreds) });

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

module.exports = { db, FieldValue };
