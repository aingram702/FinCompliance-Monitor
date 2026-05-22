# FinCompliance Monitor

Automated compliance monitoring newsletter for financial institutions.
Scrapes CISA, NVD, OCC, FinCEN, and FFIEC — synthesizes with Claude — delivers to paying subscribers via Resend.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CRON SCHEDULER (index.js)                   │
│                     Mon/Wed/Fri 7:00 AM (configurable)              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │     scrapers/index.js      │  Runs all scrapers in parallel
              └──┬──────┬──────┬──────┬───┘
                 │      │      │      │
           ┌────▼┐  ┌──▼─┐ ┌─▼──┐ ┌▼────┐ ┌──────┐
           │CISA │  │NVD │ │OCC │ │FINCEN│ │FFIEC │
           └────┬┘  └──┬─┘ └─┬──┘ └┬────┘ └──┬───┘
                └───────┴────┴─────┘          │
                        │          ┌──────────┘
                        ▼
           ┌────────────────────────┐
           │  db/database.js        │  Filter items already sent (SQLite)
           │  filterNewItems()      │
           └────────────┬───────────┘
                        │  (new items only)
                        ▼
           ┌────────────────────────┐
           │  agent/summarizer.js   │  Claude Opus — synthesize + prioritize
           │  generateNewsletter()  │  Returns structured JSON newsletter
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │  templates/newsletter  │  Build HTML + plain-text email
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │  mailer/sender.js      │  Send via Resend to all active subs
           │  sendNewsletter()      │  Personalized unsubscribe links
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │  db/database.js        │  Mark items as sent, log sends
           │  markItemsSent()       │
           └────────────────────────┘

─────────────────────────────────────────────────────────────────────
  PARALLEL: Express server (server.js)
─────────────────────────────────────────────────────────────────────
  POST /subscribe        → Create Stripe Checkout session
  POST /stripe/webhook   → Handle subscription lifecycle events
  GET  /unsubscribe      → One-click unsubscribe
  GET  /admin/stats      → Subscriber counts
  GET  /health           → Health check
```

---

## Data Sources

| Source | Coverage | Update Frequency |
|--------|----------|-----------------|
| CISA   | Cybersecurity advisories, ICS alerts | Daily |
| NVD    | CVSS ≥ 7.0 CVEs | Continuous |
| OCC    | Bank regulatory guidance, enforcement | Weekly |
| FinCEN | AML/BSA advisories, SAR guidance | As published |
| FFIEC  | Interagency guidance, exam procedures | Monthly |

---

## Quick Start

### 1. Install dependencies
```bash
cd compliance-monitor
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Set up external services

**Stripe:**
- Create a product + two prices (Basic ~$49/mo, Pro ~$149/mo)
- Add price IDs to `.env`
- Set up webhook endpoint → `https://yourdomain.com/stripe/webhook`
- Events to enable: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`

**Resend:**
- Verify your sending domain at resend.com
- Add API key to `.env`

**Anthropic:**
- Get API key at console.anthropic.com
- Add to `.env`

**NVD (optional but recommended):**
- Free API key at https://nvd.nist.gov/developers/request-an-api-key
- Without it you get 5 req/30s; with it, 50 req/30s

### 4. Run the server (handles Stripe webhooks)
```bash
node server.js
```

### 5. Test the pipeline manually
```bash
node index.js --now
```

### 6. Start the scheduler
```bash
node index.js
```

---

## Adding a Test Subscriber Manually

```javascript
// run-once: add-test-sub.js
require('dotenv').config();
const { upsertSubscriber } = require('./db/database');
upsertSubscriber({
  email:  'you@youremail.com',
  status: 'active',
  tier:   'basic',
});
console.log('Done');
```
```bash
node add-test-sub.js
```

---

## Production Deployment (Recommended: VPS or Railway)

### Option A: VPS (DigitalOcean, Linode)
```bash
# Install PM2 for process management
npm install -g pm2

# Start both processes
pm2 start server.js --name "compliance-server"
pm2 start index.js  --name "compliance-scheduler"
pm2 save
pm2 startup
```

### Option B: Railway / Render
- Set environment variables in their dashboard
- Use a `Procfile`:
```
web: node server.js
worker: node index.js
```

---

## Revenue Model

| Tier  | Price  | Features |
|-------|--------|----------|
| Basic | $49/mo | Mon/Wed/Fri briefings, all 5 sources |
| Pro   | $149/mo | Same + priority CVE alerts, custom keywords (future) |

**Break-even:** ~3 Basic subscribers covers hosting costs.
**100 Basic subscribers = $4,900 MRR** with near-zero marginal cost.

---

## Customization Ideas

- Add keyword filtering per subscriber (Pro tier feature)
- Add instant CVE alerts for CVSS ≥ 9.0 as a separate email
- Add a web archive of past briefings (Markdown → S3)
- Add Slack/Teams delivery option
- White-label for specific banks/credit unions at higher price point
