# BizBuddy — AI-Powered Financial Identity for ASEAN's Invisible Entrepreneurs

> Building behavioral credit identity for 70 million unbanked ASEAN MSMEs through WhatsApp.

[![Live Demo](https://img.shields.io/badge/Live-Demo-00d4aa?style=for-the-badge)](https://YOUR_DEPLOYMENT_URL_HERE)
[![Try the Bot](https://img.shields.io/badge/WhatsApp-Try_Bot-25d366?style=for-the-badge&logo=whatsapp)](https://wa.me/15551483471?text=Hi%20BizBuddy)

---

## The Problem

97% of ASEAN businesses are MSMEs, yet 65% are denied formal financing because they're invisible to credit bureaus. They have:

- No SSM / NIB / DTI registration
- No business bank account
- No credit history
- No paper trail

Banks have actively retreated from MSME lending because evaluating thousands of micro-applicants is unprofitable. Existing fintech tools assume smartphone literacy and bank accounts. Our users have neither.

## The Solution

BizBuddy is the AI agent that turns invisible MSMEs into bankable businesses through three layers:

1. **WhatsApp-native onboarding** — no app install, voice/photo/text input, English + Bahasa Malaysia
2. **Behavioral credit scoring** — 6-factor alternative score from real business activity, no credit bureau required
3. **Loan matching with closed-loop approval** — match to partner banks, banks approve via portal, user notified on WhatsApp

## Live Demo

- **Landing page:** [your-deployment.com](#)
- **MSME Dashboard:** [your-deployment.com/dashboard.html](#)
- **Bank Portal:** [your-deployment.com/bank.html](#) (access code: `bank2026`)
- **WhatsApp Bot:** [+1 (555) 148-3471](https://wa.me/15551483471)

---

## Architecture

```
┌─────────────────┐                    ┌──────────────────┐
│   MSME User     │                    │  Bank Officer    │
│   (WhatsApp)    │                    │  (Web Browser)   │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │ messages                             │ HTTP
         v                                      v
┌─────────────────┐                    ┌──────────────────┐
│  Meta WhatsApp  │                    │   PWA            │
│  Business API   │                    │   (3 surfaces)   │
└────────┬────────┘                    │   - Landing      │
         │                             │   - Dashboard    │
         │ webhook                     │   - Bank Portal  │
         v                             └────────┬─────────┘
┌────────────────────────────────────────────────┴──────────┐
│                                                            │
│              BizBuddy Express Server (index.js)            │
│                                                            │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────┐ │
│  │  /webhook    │    │ /notify_user │    │ /api/match- │ │
│  │  Handler     │    │  Endpoint    │    │   loans     │ │
│  └──────┬───────┘    └──────┬───────┘    └──────┬──────┘ │
│         │                   │                    │         │
│         v                   v                    v         │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Per-phone Queue + Deduplication                 │    │
│  └─────────────────┬────────────────────────────────┘    │
│                    │                                       │
│         ┌──────────┴──────────┐                           │
│         v                     v                            │
│  ┌────────────┐         ┌──────────────┐                  │
│  │  State     │         │  Loan Agent  │                  │
│  │  Machine   │         │  + Matcher   │                  │
│  │  (text.js) │         │  + Scorer    │                  │
│  └─────┬──────┘         └──────┬───────┘                  │
│        │                       │                           │
└────────┼───────────────────────┼───────────────────────────┘
         │                       │
    ┌────v─────┐          ┌──────v────────┐
    │  Gemini  │          │   Firestore   │
    │  2.5     │          │   4 collections│
    │  Flash   │          │   - users     │
    │          │          │   - loan_     │
    │  • Text  │          │     products  │
    │  • Vision│          │   - loan_     │
    │  • Audio │          │     applications│
    │          │          │   - landing_  │
    │          │          │     signups   │
    └──────────┘          └───────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js 18+, Express |
| AI | Google Gemini 2.5 Flash (text, vision, audio) |
| Database | Firebase Firestore |
| Messaging | Meta WhatsApp Business API v18.0 |
| Frontend | Vanilla JS (ES modules), Chart.js 4.4 |
| PWA | Service Worker, manifest.json, installable |
| Deployment | Render / Railway / Vercel |

### Key Engineering Patterns

- **Per-phone async queue** — prevents race conditions from concurrent webhooks
- **Message deduplication** — handles Meta webhook retry storms (in-memory LRU, 500 IDs)
- **Exponential backoff retries** — 3 attempts on Gemini and Meta API calls
- **Multi-modal input routing** — text, image, document, audio handled through one webhook
- **State machine + intent detection** — Gemini classifies natural language into bot actions
- **Aspirational matching** — when user doesn't qualify, system shows what to work toward with specific gap reasoning
- **Shared-secret API auth** — `/notify_user` requires `x-bank-key` header; key delivered via `/api/bank-session` after access code validation

---

## Quick Start

### Prerequisites

- Node.js 18 or higher
- A Firebase project with Firestore enabled
- A Meta WhatsApp Business Account ([setup guide](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started))
- A Google Gemini API key ([get one here](https://aistudio.google.com/apikey))
- Optional: ngrok for local webhook testing

### Installation

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/bizbuddy.git
cd bizbuddy

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials (see below)
nano .env

# Seed the loan products collection (run once)
node seed_loan_products.js

# Start the server
npm start
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```
# Meta WhatsApp Business API
WEBHOOK_VERIFY_TOKEN=any-random-string-you-choose
WHATSAPP_TOKEN=your-meta-graph-api-bearer-token
PHONE_NUMBER_ID=your-meta-business-phone-number-id

# Google Gemini
GEMINI_API_KEY=your-gemini-api-key

# Firebase Admin SDK
FIREBASE_CREDENTIALS_BASE64=base64-encoded-firebase-service-account-json

# Server
PORT=3000
PWA_URL=https://your-deployed-pwa-url.com

# Bank portal API protection
BANK_API_KEY=any-random-string-for-bank-portal-auth
```

To base64-encode your Firebase service account JSON:

```bash
# macOS / Linux
base64 -i path/to/service-account.json -o firebase-base64.txt

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("path/to/service-account.json")) | Set-Content firebase-base64.txt
```

### Firestore Setup

Collections auto-create on first write. Recommended composite index:

| Collection | Fields |
|---|---|
| `loan_applications` | `user_id` (Asc) + `submitted_at` (Desc) |

Create in Firestore Console → Indexes → Composite.

| Collection | Document ID |
|---|---|
| `users` | WhatsApp phone number (no `+`) |
| `loan_products` | Auto-generated |
| `loan_applications` | `BB-XXXXXXXX` (bot-generated) |
| `landing_signups` | `BB-XXXXXXXX` token |

### Meta WhatsApp Webhook Setup

1. In Meta Developer Console → WhatsApp → Configuration:
   - Webhook URL: `https://your-deployment.com/webhook`
   - Verify Token: same as `WEBHOOK_VERIFY_TOKEN` in `.env`
   - Subscribe to: `messages`
2. Local testing: `ngrok http 3000`, use the HTTPS URL.
3. Add test phone numbers in API Setup (max 5 on free tier).

### Run Locally

```bash
npm start
# http://localhost:3000           — landing page
# http://localhost:3000/dashboard.html  — MSME dashboard
# http://localhost:3000/bank.html       — bank portal (code: bank2026)
```

### Deploy to Render

1. Push repo to GitHub
2. Create Web Service on Render → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all `.env` variables in Render's Environment tab
6. Deploy, then update Meta webhook URL to Render HTTPS URL

---

## What's New (Post-Preliminary Round)

### Major Features Added

- **Express Loan Path** — 60-second loan match via 6 questions (vs 11 for full onboarding)
- **Web Pre-Match → WhatsApp Handoff** — fill form on landing page, get matches instantly, one-time token skips WhatsApp Q&A
- **Document Verification** — Gemini Vision OCRs SSM certificates and bank statements with fuzzy name matching
- **Closed B2B2C Loop** — bank portal Approve / Reject / Request Info hits `/notify_user`, updates Firestore and sends WhatsApp notification in one call
- **Aspirational Matching** — when user doesn't qualify, shows top 3 with specific gap reasoning ("To qualify, you need RM3,500 more monthly revenue")
- **Verification Badges + Score Sparkline** — bank portal MSME modal shows SSM/bank verification status and `score_history` mini line chart
- **Recent Activity Tabs** — dashboard shows sales and expenses in tabbed view with pagination
- **Bank API Authentication** — `/notify_user` requires `x-bank-key` shared secret; delivered via `/api/bank-session` after login

### UX Improvements

- Score Breakdown card includes "Next Best Action" CTA highlighting weakest factor
- Stats grid shows Total Expenses / Net Profit (replacing redundant Best Sale / Avg per Sale)
- Sales Activity chart overlays expenses dataset for visual cash flow
- Recent Activity card uses pagination with fixed height
- Loan Programs card uses 3-column grid on wide desktop with visual lock states
- Multi-currency support: MY (RM), ID (Rp), PH (₱) with country-specific ranges in Express Q&A
- Toast notification system for bank portal actions

### Code Quality

- `loan_applications` documents now include `score_breakdown`, `credit_score`, `score_history`, and `verification` snapshot at time of submission
- Per-phone async queue prevents Firestore race conditions
- Message deduplication handles Meta webhook retry storms
- Bilingual i18n dictionary: 80+ keys across BM and EN
- All user-input strings sanitized with `esc()` before DOM insertion (XSS protection)

### Removed / Deprecated

- "3 ASEAN languages" corrected to "English + Bahasa Malaysia"
- RUJUK command deprecated in favor of integrated loan agent flow
- Hardcoded `LOAN_CATALOG` replaced by Firestore `loan_products` collection

---

## Project Structure

```
bizbuddy/
├── index.js                      # Express server, webhook, /notify_user, /api/match-loans
├── seed_loan_products.js         # One-time Firestore seeder
├── handlers/
│   ├── text.js                   # Main bot state machine
│   ├── menu.js                   # Menu options 1-5 routing
│   ├── image.js                  # Image OCR + audio transcription
│   ├── sale.js                   # Sale logging from text
│   ├── chat.js                   # AI Chat (menu option 4)
│   └── smart.js                  # Intent classifier for unrecognized text
├── features/
│   ├── credit.js                 # 6-factor credit scoring algorithm
│   ├── loan_agent.js             # Loan matching, express Q&A, doc upload
│   ├── profile.js                # Profile / certificate / score breakdown
│   ├── summary.js                # Sales summary
│   └── loan.js                   # Loan eligibility checklist
├── public/
│   ├── index.html                # Landing page
│   ├── dashboard.html            # MSME dashboard
│   ├── bank.html                 # Bank portal
│   ├── app.js                    # PWA logic
│   ├── style.css                 # Styles
│   ├── manifest.json             # PWA manifest
│   ├── sw.js                     # Service worker
│   └── icons/                    # Logos
├── config.js                     # Country config (MY/ID/PH)
├── db.js                         # Firebase Admin init
├── gemini.js                     # Gemini API wrapper with retry
├── send.js                       # Meta WhatsApp send with retry
├── .env.example                  # Environment template
└── README.md                     # This file
```

---

## Try It Yourself

### As an MSME

1. Send any message to [+1 (555) 148-3471](https://wa.me/15551483471) on WhatsApp
2. Choose "Find a loan now" for the express path
3. Answer 6 questions (~2 minutes)
4. See top 3 loan matches with reasoning
5. Pick one, send your IC photo or bank statement
6. Watch the dashboard at `/dashboard.html` update in real time

### As a Bank Officer

1. Open `/bank.html`
2. Enter access code `bank2026`
3. View MSME portfolio with credit scores and verification status
4. Click any pending loan application to review
5. See full credit breakdown, score history sparkline, and documents
6. Click Approve / Reject / Request Info — user gets WhatsApp notification instantly

---

## Case Study Alignment

Addresses **ASEAN MSME Inclusive Growth** (Case Study 8), focusing on the foundational pillar: **alternative credit scoring**.

| Case Study Pillar | BizBuddy |
|---|---|
| Alternative credit scoring | ✅ Core feature — 6-factor behavioral algorithm |
| Limited access to financing | ✅ Loan agent + multi-bank matching + closed B2B2C loop |
| Lack of digital capabilities | ✅ WhatsApp-native, voice + photo input, bilingual |
| Predictive market analytics | Roadmap — foundation in AI Chat advisor |
| Supply chain management | Roadmap — requires industry vertical extensions |
| Cross-border trade | Roadmap — multi-country foundation deployed |

Alternative credit scoring is the unlock: without credit identity, MSMEs can't access financing, can't scale supply chains, and can't act on market predictions. Solve identity first.

---

## Team

[Your team names + roles]

## License

MIT

## Acknowledgments

- ASEAN Secretariat for the case study framing
- World Bank, World Economic Forum for MSME financing gap data
- Meta WhatsApp Business Platform
- Google Gemini API
- Firebase
