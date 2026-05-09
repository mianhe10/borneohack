const COUNTRY_CONFIG = {
    MY: {
        name: 'Malaysia', flag: '🇲🇾', currency: 'RM',
        loan_program: 'TEKUN', loan_amount: 'RM50,000', loan_rate: '4%',
        registration: 'SSM', reg_url: 'ssm.com.my',
        reg_question_bm: 'Adakah perniagaan awak dah *daftar SSM*?',
        reg_question_en: 'Is your business *registered with SSM*?',
        income_examples: 'RM500, RM2000, RM5000',
        sale_example_bm: 'Jual 10 bekas kuih dapat RM150',
        sale_example_en: 'Sold 10 boxes of cookies for RM150',
        states: {
            '1': 'Johor', '2': 'Kedah', '3': 'Kelantan', '4': 'Melaka',
            '5': 'Negeri Sembilan', '6': 'Pahang', '7': 'Perak', '8': 'Perlis',
            '9': 'Pulau Pinang', '10': 'Sabah', '11': 'Sarawak', '12': 'Selangor',
            '13': 'Terengganu', '14': 'KL', '15': 'Putrajaya', '16': 'Labuan',
        },
    },
    ID: {
        name: 'Indonesia', flag: '🇮🇩', currency: 'Rp',
        loan_program: 'KUR (Kredit Usaha Rakyat)', loan_amount: 'Rp500 juta', loan_rate: '6%',
        registration: 'NIB', reg_url: 'oss.go.id',
        reg_question_bm: 'Adakah perniagaan awak dah *daftar NIB*?',
        reg_question_en: 'Is your business *registered with NIB (OSS)*?',
        income_examples: 'Rp2jt, Rp5jt, Rp10jt',
        sale_example_bm: 'Jual 10 bungkus nasi dapat Rp500rb',
        sale_example_en: 'Sold 10 packs of food for Rp500k',
        states: {
            '1': 'Jakarta', '2': 'Jawa Barat', '3': 'Jawa Tengah', '4': 'Jawa Timur',
            '5': 'Bali', '6': 'Sumatera Utara', '7': 'Sumatera Barat', '8': 'Sumatera Selatan',
            '9': 'Kalimantan', '10': 'Sulawesi', '11': 'Papua', '12': 'Yogyakarta',
        },
    },
    PH: {
        name: 'Philippines', flag: '🇵🇭', currency: '₱',
        loan_program: 'SB Corp (Small Business Corp)', loan_amount: '₱500,000', loan_rate: '8%',
        registration: 'DTI', reg_url: 'bnrs.dti.gov.ph',
        reg_question_bm: 'Adakah perniagaan awak dah *daftar DTI*?',
        reg_question_en: 'Is your business *registered with DTI*?',
        income_examples: '₱10k, ₱30k, ₱50k',
        sale_example_bm: 'Jual 10 item dapat ₱5000',
        sale_example_en: 'Sold 10 items for ₱5000',
        states: {
            '1': 'Metro Manila', '2': 'Cebu', '3': 'Davao', '4': 'Calabarzon',
            '5': 'Central Luzon', '6': 'Western Visayas', '7': 'Central Visayas',
            '8': 'Northern Mindanao', '9': 'Ilocos', '10': 'Bicol',
        },
    },
};

function getCountry(userData) {
    const code = (userData && userData.country) || 'MY';
    return COUNTRY_CONFIG[code] || COUNTRY_CONFIG.MY;
}

function getCurrency(userData) {
    return getCountry(userData).currency;
}

function isEnglish(userData) {
    return (userData && userData.language) === 'en';
}

function today() {
    return new Date().toISOString().split('T')[0];
}

module.exports = { COUNTRY_CONFIG, getCountry, getCurrency, isEnglish, today };
