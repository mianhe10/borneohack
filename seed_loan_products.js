require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const PRODUCTS = [
    {
        id: 'alliance_digital_sme',
        bank_name: 'Alliance Bank',
        product_name: 'Digital SME Loan',
        min_amount: 20000,
        max_amount: 500000,
        interest_rate: 5.9,
        tenure_months_min: 12,
        tenure_months_max: 84,
        min_business_age_months: 12,
        min_monthly_revenue: 4000,
        required_docs: ['6_month_bank_statement'],
        industries: ['all'],
        countries: ['MY'],
        collateral_required: false,
        description: 'Collateral-free SME term loan with fast digital approval',
        active: true,
    },
    {
        id: 'rhb_sme_online',
        bank_name: 'RHB Bank',
        product_name: 'SME Online Financing',
        min_amount: 50000,
        max_amount: 1000000,
        interest_rate: 7.0,
        tenure_months_min: 12,
        tenure_months_max: 60,
        min_business_age_months: 12,
        min_monthly_revenue: 8000,
        required_docs: ['6_month_bank_statement', 'audited_accounts'],
        industries: ['all'],
        countries: ['MY'],
        collateral_required: false,
        description: 'Online SME financing with flexible tenure and fast processing',
        active: true,
    },
    {
        id: 'sme_bank_micro',
        bank_name: 'SME Bank',
        product_name: 'Micro Financing',
        min_amount: 5000,
        max_amount: 50000,
        interest_rate: 7.5,
        tenure_months_min: 12,
        tenure_months_max: 60,
        min_business_age_months: 6,
        min_monthly_revenue: 2000,
        required_docs: ['3_month_bank_statement'],
        industries: ['all'],
        countries: ['MY'],
        collateral_required: false,
        description: 'Accessible micro financing for early-stage Malaysian businesses',
        active: true,
    },
    {
        id: 'midf_soft_loan',
        bank_name: 'MIDF',
        product_name: 'Soft Loan for SME',
        min_amount: 50000,
        max_amount: 3000000,
        interest_rate: 3.75,
        tenure_months_min: 24,
        tenure_months_max: 120,
        min_business_age_months: 24,
        min_monthly_revenue: 10000,
        required_docs: ['6_month_bank_statement', 'business_plan', 'audited_accounts'],
        industries: ['manufacturing', 'services'],
        countries: ['MY'],
        collateral_required: false,
        description: 'Government-backed soft loan at subsidized rates for SME growth',
        active: true,
    },
    {
        id: 'maybank_sme_quick_cash',
        bank_name: 'Maybank',
        product_name: 'SME Quick Cash',
        min_amount: 10000,
        max_amount: 250000,
        interest_rate: 6.5,
        tenure_months_min: 12,
        tenure_months_max: 60,
        min_business_age_months: 12,
        min_monthly_revenue: 5000,
        required_docs: ['6_month_bank_statement'],
        industries: ['all'],
        countries: ['MY'],
        collateral_required: false,
        description: 'Fast-approval revolving credit facility for working capital needs',
        active: true,
    },
];

async function seed() {
    console.log('Seeding loan_products collection...\n');
    const batch = db.batch();
    for (const p of PRODUCTS) {
        const ref = db.collection('loan_products').doc(p.id);
        batch.set(ref, p, { merge: true });
        console.log(`  ✓ ${p.bank_name} — ${p.product_name} (RM${p.min_amount.toLocaleString()}–${p.max_amount.toLocaleString()}, ${p.interest_rate}%)`);
    }
    await batch.commit();
    console.log(`\nDone! ${PRODUCTS.length} loan products seeded to Firestore.`);
    process.exit(0);
}

seed().catch(e => {
    console.error('Seed failed:', e.message);
    process.exit(1);
});
