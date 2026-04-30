# 🤖 Upsell Bot

A Claude Code slash command that audits any client website and produces a prioritised sales report — plus a branded PDF deliverable. Point it at a URL and it crawls the site, runs Lighthouse and axe-core scans, fingerprints the tech stack, pulls ad-library deep links, and hands your sales rep a ready-to-use briefing document.

No separate AI API key needed. Claude does the analysis. The repo provides the crawling and analysis tools, and the slash command orchestrates everything.

---

## What's new in v1.1

- **Real performance data** — PageSpeed Insights (Lighthouse) for mobile + desktop, including Core Web Vitals (LCP, CLS, INP, FCP, TBT)
- **Tech stack fingerprinting** — detects CMS, framework, analytics, ad pixels, payment processors, live chat, email platforms, and hosting/CDN
- **SEO depth** — title/description length, Open Graph, Twitter Card, JSON-LD, canonical, hreflang, sitemap stats
- **Content freshness** — when was the site last updated?
- **Ad intelligence deep links** — Meta Ad Library, Google Ads Transparency, LinkedIn, TikTok — click-ready URLs for the sales rep
- **Deep accessibility scan** — axe-core WCAG 2.2 AA violations on the top 3 highest-weight pages, grouped by severity
- **Branded PDF output** — a polished A4 deliverable rendered via Puppeteer
- **Parallel sub-agent analysis** — upsell / security / UX run as three Claude agents in parallel for deeper per-dimension analysis

---

## What it does

Type `/upsell` in Claude Code and the agent will:

1. Ask for the client's website URL
2. Ask if this is an existing project (to avoid pitching work already delivered)
3. Ask if you want to benchmark against a competitor site
4. **Crawl the site** (up to 15 pages) and run in parallel:
   - Mozilla Observatory security scan
   - PageSpeed Insights (mobile + desktop)
   - Tech stack fingerprinting across all crawled pages
   - Sitemap parsing + content freshness detection
5. **Run axe-core accessibility scan** on the top 3 high-weight pages
6. **Dispatch three specialist sub-agents in parallel:**
   - 💰 Upsell analyst — missing features, revenue gaps, ad-library findings
   - 🔒 Security & compliance analyst — Observatory grade + WCAG violations
   - 🎨 Design & UX analyst — CWV, CTAs, conversion flow, mobile readiness
7. Merge findings into a Markdown report with executive summary, snapshot table, and (if a competitor was provided) a head-to-head comparison table
8. **Render the report to a branded PDF** ready to hand to the client or sales rep
9. Save both files to `reports/<domain>-audit.md` and `reports/<domain>-audit.pdf`

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Kilowott-labs/Sales-Agent
cd upsell-bot
```

### 2. Open in Claude Code

```bash
claude .
```

The `/upsell` command is now available.

That's it. **You don't run `npm install` yourself.** The slash command runs it as Step 4 on every invocation — first run downloads everything (including Puppeteer's Chromium, ~180MB), subsequent runs are a ~3-second no-op.

### How the auto-install works

The `postinstall` hook in `package.json` runs `scripts/ensure-chromium.js` after every `npm install`. This script:
- Runs `npx puppeteer browsers install chrome` (idempotent — skips if already cached)
- Self-heals broken Puppeteer Chromium installs (proxy timeouts, interrupted downloads)
- Exits 0 on failure so `npm install` never breaks, even offline — you'll just lose the a11y scan and PDF render until Chromium is available

The first `/upsell` you run takes 2–5 minutes because of the Chromium download. After that, every audit runs at full speed.

---

## Usage

```
/upsell https://client-website.com
```

Follow the prompts. Everything else happens automatically.

---

## Report structure

Every audit produces a Markdown file at `reports/<domain>-audit.md` **and** a branded PDF at `reports/<domain>-audit.pdf` containing:

| Section | Contents |
|---|---|
| **Executive Summary** | Named tech stack, headline weakness, biggest revenue lever |
| **Snapshot table** | CMS, hosting, Lighthouse scores, LCP, security grade, analytics, ad pixels, content age, critical a11y count |
| **Head-to-Head** *(competitor only)* | 15+ row comparison including PageSpeed, stack, pixels |
| **💰 Upsell Opportunities** | Missing features and revenue gaps — each with impact rating and sales angle |
| **🔒 Security & Accessibility** | Observatory grade + WCAG critical/serious violations |
| **🎨 Design & UX** | CWV, CRO, mobile, conversion flow |
| **Ad Intelligence** | Meta Ad Library, Google Ads Transparency, LinkedIn, TikTok deep links for the rep |
| **Priority Action List** | Top 5 fixes ranked by business value |
| **Talking Points** | 5 lines the rep can say verbatim on the call |

Each finding includes:
- **Impact** rating: High / Medium / Low (weighted by pageWeight — homepage issues rank higher)
- **Sales angle**: one sentence the rep says out loud on the call

---

## Data pipeline

```
┌─────────────────┐       ┌──────────────────────┐
│ crawl.js        │ ───▶  │ crawl-output.json    │
│ (HTML + head    │       │  • pages[]           │
│  ers, parallel  │       │  • security          │
│  fetches:       │       │  • pagespeed {mob/   │
│  Observatory,   │       │    desk}             │
│  PageSpeed,     │       │  • techStack         │
│  sitemap)       │       │  • contentFreshness  │
└─────────────────┘       │  • adIntelligence    │
                          │  • sitemap           │
                          └──────────────────────┘
┌─────────────────┐       ┌──────────────────────┐
│ a11y-scan.js    │ ───▶  │ a11y-output.json     │
│ (puppeteer +    │       │  • scans[]           │
│  axe-core,      │       │  • violations by     │
│  top 3 pages)   │       │    impact            │
└─────────────────┘       └──────────────────────┘
┌─────────────────┐       ┌──────────────────────┐
│ crawl-          │ ───▶  │ competitor-          │
│ competitor.js   │       │ output.json          │
└─────────────────┘       └──────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Claude dispatches 3 parallel sub-agents │
│  • Upsell / revenue                     │
│  • Security / compliance                │
│  • Design / UX / performance            │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ save-report.js   → reports/<dom>-audit.md │
│ render-pdf.js    → reports/<dom>-audit.pdf│
└─────────────────────────────────────────┘
```

---

## How page weighting works

The crawler scores every page from 1–10 based on its type:

| Page type | Score | Examples |
|---|---|---|
| Homepage | 10 | `/`, `/home` |
| Pricing | 9 | `/pricing`, `/plans` |
| Conversion | 8 | `/demo`, `/signup`, `/trial` |
| Product / Service | 8 | `/product`, `/services` |
| Contact | 8 | `/contact`, `/get-in-touch` |
| About | 6 | `/about`, `/team` |
| Support | 5 | `/faq`, `/help` |
| Blog / News | 2 | `/blog`, `/news`, `/article` |
| Taxonomy | 1 | `/tag`, `/category` |

A missing CTA on the homepage (score 10) is flagged as **High** impact. The same issue on a blog post (score 2) is **Low**.

---

## How the tech stack fingerprinting works

The crawler inspects the HTML and response headers of every page it visits and looks for known signatures. It aggregates matches across pages, so signals from checkout (e.g. Stripe) show up even if only one page loads it.

**Detected categories:**
- **CMS:** WordPress, Shopify, Webflow, Wix, Squarespace, Drupal, Ghost, HubSpot CMS, Magento, WooCommerce, BigCommerce, Framer, Sanity, Contentful
- **Framework:** Next.js, Nuxt.js, Angular, Gatsby, React, Vue.js, Svelte, Astro, Remix
- **Analytics:** Google Analytics / GTM, Hotjar, Mixpanel, Amplitude, Segment, Plausible, Matomo, Heap, FullStory, Microsoft Clarity
- **Ads:** Meta Pixel, Google Ads, LinkedIn Insight, Twitter/X, TikTok, Pinterest, Microsoft Ads, Reddit
- **Payments:** Stripe, Razorpay, PayPal, Square, Adyen, Braintree
- **Live chat:** Intercom, Drift, Crisp, Tawk.to, Zendesk, LiveChat, HubSpot Chat
- **Email:** Mailchimp, Klaviyo, HubSpot Forms, ConvertKit, ActiveCampaign
- **Hosting / CDN:** Cloudflare, Vercel, Netlify, AWS CloudFront, Akamai, Fastly, Nginx, Apache, LiteSpeed, IIS

Each detection maps to a potential upsell conversation. A Shopify site with no Klaviyo = email marketing upsell. A custom PHP stack with no analytics = GA4 setup + modernisation upsell.

---

## How the PageSpeed Insights scan works

The crawler calls Google's PageSpeed Insights v5 API for the homepage in both **mobile** and **desktop** strategies, in parallel with the crawl. **An API key is required.**

### Getting a PageSpeed API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **"PageSpeed Insights API"** and enable it
5. Go to **APIs & Services → Credentials → Create Credentials → API key**
6. Copy the key

### Adding the key to the scripts

Open `scripts/crawl.js` and `scripts/crawl-competitor.js`. In the `fetchPageSpeed` function, find the `apiUrl` line and replace `key=YOUR_KEY` with your actual key:

```js
const apiUrl = `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=...&key=YOUR_KEY`;
```

Returns:
- **Lighthouse scores:** performance, accessibility, best practices, SEO (0–100)
- **Core Web Vitals:** LCP, CLS, INP (displayValue strings)
- **Supporting metrics:** FCP, TBT, TTI, Speed Index

Mobile scores get priority in the analysis because Google's Page Experience ranking uses mobile scores for indexing.

---

## How the security scan works

The crawler calls the [Mozilla Observatory API](https://observatory.mozilla.org) — no API key required. It triggers a scan on the root domain and polls for results while the page crawl runs in parallel.

Results include:
- **Letter grade** (A+ down to F) and score out of 100
- Checked headers: Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy

An F or D grade is framed as a client risk with a strong sales angle — far more compelling than listing individual missing headers.

---

## How the accessibility scan works

`a11y-scan.js` reads `crawl-output.json`, picks the top 3 highest-weight pages, launches headless Chrome via Puppeteer, loads each page (with JS executing), and injects axe-core. It runs WCAG 2.0, 2.1, 2.2 AA + best-practice rules and returns violations grouped by severity: **critical**, **serious**, **moderate**, **minor**.

A critical violation on the homepage (weight 10) is a hard talking point — it means the site is legally vulnerable under accessibility regulations (ADA in the US, EAA in the EU, RPWD in India).

---

## How the ad intelligence works

The agent does two things:
1. **Detects ad pixels on the site** from the tech stack pass (Meta Pixel, Google Ads, LinkedIn Insight, TikTok, etc.)
2. **Builds deep links to every major public ad library** for the domain/brand — Meta Ad Library, Google Ads Transparency, LinkedIn, TikTok

The sales rep clicks the links before the call to see the client's (or competitor's) actively running ads. If they're running Meta ads but have no Meta Pixel on the site → immediate conversion-tracking upsell. If they're not running ads anywhere → paid-media services upsell.

---

## Project structure

```
upsell-bot/
├── .claude/
│   └── commands/
│       └── upsell.md            ← slash command + orchestration prompt
├── scripts/
│   ├── crawl.js                 ← client crawl + PageSpeed + tech + SEO + freshness + ad intel
│   ├── crawl-competitor.js      ← competitor crawl with the same enrichments
│   ├── a11y-scan.js             ← puppeteer + axe-core deep accessibility scan
│   ├── render-pdf.js            ← markdown → branded A4 PDF (puppeteer + marked)
│   ├── ensure-chromium.js       ← postinstall safety net — guarantees Chromium is installed
│   └── save-report.js           ← saves markdown to reports/
├── reports/                     ← generated .md and .pdf land here
├── package.json
└── README.md
```

### Key file: `.claude/commands/upsell.md`

This is the brain of the agent. It contains all the instructions Claude follows when `/upsell` is triggered — the conversation flow, tool orchestration, sub-agent dispatch, report format, and PDF render. If you want to customise what the agent looks for or how it formats the report, edit this file.

Do not delete the `.claude` folder — without it, the `/upsell` command does not exist.

---

## Requirements summary

| Requirement | Version |
|---|---|
| Claude Code | Latest |
| Node.js | 18+ |
| npm | 8+ |
| Disk (for Chromium) | ~200MB |
