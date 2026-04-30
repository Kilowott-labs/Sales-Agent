#!/usr/bin/env node
/**
 * crawl-competitor.js — Crawls a competitor URL for benchmarking.
 * Usage: node scripts/crawl-competitor.js <url> <clientDomain> [maxPages]
 * Output: writes reports/<clientDomain>/competitor-output.json
 */

import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";

const [, , rootUrl, clientDomain, maxPagesArg] = process.argv;

if (!rootUrl || !clientDomain) {
  console.error("Usage: node scripts/crawl-competitor.js <url> <clientDomain> [maxPages]");
  process.exit(1);
}

const MAX_PAGES = parseInt(maxPagesArg || "8");

const KEY_PAGE_PATTERNS = [
  { pattern: /^\/?$|\/home\/?$/i,                       score: 10, type: "homepage" },
  { pattern: /\/pricing|\/plans|\/packages/i,            score: 9,  type: "pricing" },
  { pattern: /\/contact|\/get-in-touch/i,                score: 8,  type: "contact" },
  { pattern: /\/product|\/service|\/solution/i,          score: 8,  type: "product" },
  { pattern: /\/about|\/team/i,                          score: 6,  type: "about" },
  { pattern: /\/demo|\/trial|\/signup/i,                 score: 8,  type: "conversion" },
  { pattern: /\/blog|\/news|\/article/i,                 score: 2,  type: "blog" },
];

function scorePageWeight(url) {
  try {
    const path = new URL(url).pathname;
    for (const { pattern, score, type } of KEY_PAGE_PATTERNS) {
      if (pattern.test(path)) return { score, type };
    }
    const depth = path.split("/").filter(Boolean).length;
    return { score: Math.max(1, 5 - depth), type: "general" };
  } catch {
    return { score: 1, type: "unknown" };
  }
}

// ─── Mozilla Observatory ──────────────────────────────────────────────────
async function fetchSecurityGrade(url) {
  try {
    const hostname = new URL(url).hostname;
    console.error(`[security] Scanning competitor ${hostname}...`);
    const scanRes = await fetch(
      `https://observatory.mozilla.org/api/v1/analyze?host=${hostname}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "rescan=true",
      }
    );
    if (!scanRes.ok) return null;
    let scan = await scanRes.json();
    let attempts = 0;
    while (scan.state !== "FINISHED" && scan.state !== "FAILED" && attempts < 10) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://observatory.mozilla.org/api/v1/analyze?host=${hostname}`);
      scan = await pollRes.json();
      attempts++;
    }
    if (scan.state === "FINISHED") {
      return { grade: scan.grade, score: scan.score, source: "Mozilla Observatory" };
    }
    return null;
  } catch (err) {
    console.error(`[security] Could not fetch competitor grade: ${err.message}`);
    return null;
  }
}

// ─── PageSpeed Insights ───────────────────────────────────────────────────
async function fetchPageSpeed(url, strategy = "mobile") {
  try {
    const apiUrl = `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo&key=AIzaSyD92ywF5oQc2e1cHZkUL6a_3YcLbX8GJ2A`;
    console.error(`[pagespeed] Competitor ${strategy}...`);
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const lh = data.lighthouseResult;
    if (!lh) return null;
    const audits = lh.audits || {};
    const cats = lh.categories || {};
    return {
      strategy,
      performance: Math.round((cats.performance?.score ?? 0) * 100),
      accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((cats["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((cats.seo?.score ?? 0) * 100),
      lcp: audits["largest-contentful-paint"]?.displayValue || null,
      cls: audits["cumulative-layout-shift"]?.displayValue || null,
      fcp: audits["first-contentful-paint"]?.displayValue || null,
      tbt: audits["total-blocking-time"]?.displayValue || null,
    };
  } catch (err) {
    console.error(`[pagespeed] Competitor error: ${err.message}`);
    return null;
  }
}

// ─── Tech stack (shared patterns, compact) ────────────────────────────────
const TECH_PATTERNS = {
  cms: [
    { test: /wp-content|wp-includes|wp-json/i, name: "WordPress" },
    { test: /cdn\.shopify\.com|shopify-section/i, name: "Shopify" },
    { test: /webflow\.com|w-mod/i, name: "Webflow" },
    { test: /wixstatic\.com/i, name: "Wix" },
    { test: /squarespace-cdn/i, name: "Squarespace" },
    { test: /drupal-settings-json/i, name: "Drupal" },
    { test: /hubspotusercontent/i, name: "HubSpot CMS" },
    { test: /magento/i, name: "Magento" },
    { test: /woocommerce/i, name: "WooCommerce" },
    { test: /framer\.(com|website)/i, name: "Framer" },
  ],
  framework: [
    { test: /__NEXT_DATA__|_next\/static/i, name: "Next.js" },
    { test: /_nuxt|__NUXT__/i, name: "Nuxt.js" },
    { test: /ng-version=/i, name: "Angular" },
    { test: /gatsby-/i, name: "Gatsby" },
    { test: /data-reactroot/i, name: "React" },
  ],
  analytics: [
    { test: /gtag\(|google-analytics\.com|googletagmanager/i, name: "Google Analytics / GTM" },
    { test: /hotjar\.com/i, name: "Hotjar" },
    { test: /mixpanel/i, name: "Mixpanel" },
    { test: /segment\.com\/analytics/i, name: "Segment" },
    { test: /clarity\.ms/i, name: "Microsoft Clarity" },
  ],
  ads: [
    { test: /fbevents\.js|connect\.facebook\.net\/.*\/fbevents/i, name: "Meta Pixel" },
    { test: /googleadservices|googlesyndication/i, name: "Google Ads" },
    { test: /linkedin.*insight|snap\.licdn/i, name: "LinkedIn Insight" },
    { test: /analytics\.tiktok\.com|ttq\./i, name: "TikTok Pixel" },
    { test: /bat\.bing\.com/i, name: "Microsoft Ads" },
  ],
  payments: [
    { test: /js\.stripe\.com/i, name: "Stripe" },
    { test: /razorpay\.com/i, name: "Razorpay" },
    { test: /paypal\.com\/sdk/i, name: "PayPal" },
  ],
  liveChat: [
    { test: /intercom/i, name: "Intercom" },
    { test: /drift\.com/i, name: "Drift" },
    { test: /crisp\.chat/i, name: "Crisp" },
    { test: /tawk\.to/i, name: "Tawk.to" },
    { test: /zendesk/i, name: "Zendesk" },
  ],
};

function matchPatterns(hay, patterns) {
  return patterns.filter(p => p.test.test(hay)).map(p => p.name);
}
function matchFirst(hay, patterns) {
  return patterns.find(p => p.test.test(hay))?.name || null;
}
function detectHosting(headers) {
  const server = (headers["server"] || "").toString();
  if (headers["cf-ray"]) return "Cloudflare";
  if (headers["x-vercel-id"]) return "Vercel";
  if (headers["x-nf-request-id"]) return "Netlify";
  if (headers["x-amz-cf-id"]) return "AWS CloudFront";
  if (/akamai/i.test(server) || headers["x-akamai-transformed"]) return "Akamai";
  if (/fastly/i.test(server)) return "Fastly";
  if (/nginx/i.test(server)) return "Nginx";
  if (/apache/i.test(server)) return "Apache";
  return server || null;
}

function detectTechOnPage(html, headers) {
  const hay = html + "\n" + JSON.stringify(headers);
  return {
    cms: matchFirst(hay, TECH_PATTERNS.cms),
    framework: matchFirst(hay, TECH_PATTERNS.framework),
    analytics: matchPatterns(hay, TECH_PATTERNS.analytics),
    ads: matchPatterns(hay, TECH_PATTERNS.ads),
    payments: matchPatterns(hay, TECH_PATTERNS.payments),
    liveChat: matchFirst(hay, TECH_PATTERNS.liveChat),
    hosting: detectHosting(headers),
    serverSoftware: headers["x-powered-by"] || null,
  };
}

function mergeTech(a, p) {
  a.cms ||= p.cms;
  a.framework ||= p.framework;
  a.liveChat ||= p.liveChat;
  a.hosting ||= p.hosting;
  a.serverSoftware ||= p.serverSoftware;
  for (const k of ["analytics", "ads", "payments"]) {
    a[k] = [...new Set([...(a[k] || []), ...(p[k] || [])])];
  }
  return a;
}

// ─── SEO ──────────────────────────────────────────────────────────────────
function extractSEO($) {
  const title = $("title").first().text().trim();
  const desc = $('meta[name="description"]').attr("content")?.trim() || "";
  return {
    titleLength: title.length,
    descLength: desc.length,
    hasTitle: !!title,
    hasDescription: !!desc,
    ogTagCount: $('meta[property^="og:"]').length,
    twitterTagCount: $('meta[name^="twitter:"]').length,
    jsonLdCount: $('script[type="application/ld+json"]').length,
    hasCanonical: $('link[rel="canonical"]').length > 0,
    hreflangCount: $('link[rel="alternate"][hreflang]').length,
  };
}

// ─── Freshness ────────────────────────────────────────────────────────────
function extractFreshness($, metaTags) {
  const dates = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const json = JSON.parse(raw);
      const items = Array.isArray(json) ? json : (json["@graph"] ? json["@graph"] : [json]);
      items.forEach(i => {
        if (i.datePublished) dates.push(i.datePublished);
        if (i.dateModified) dates.push(i.dateModified);
      });
    } catch {}
  });
  if (metaTags["article:published_time"]) dates.push(metaTags["article:published_time"]);
  if (metaTags["article:modified_time"]) dates.push(metaTags["article:modified_time"]);
  $("time[datetime]").each((_, el) => {
    const d = $(el).attr("datetime");
    if (d) dates.push(d);
  });
  const parsed = dates.map(d => new Date(d)).filter(d => !isNaN(d.valueOf()));
  if (parsed.length === 0) return null;
  const latest = new Date(Math.max(...parsed.map(d => d.valueOf())));
  return {
    latestDate: latest.toISOString(),
    daysSincePublished: Math.floor((Date.now() - latest.valueOf()) / 86400000),
  };
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; UpsellBot/1.0)",
  Accept: "text/html,application/xhtml+xml",
};

function normalizeUrl(url, base) {
  try {
    const u = new URL(url, base);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch { return null; }
}

function extractPage(url, html, statusCode, loadTime, responseHeaders) {
  const $ = cheerio.load(html);
  const metaTags = {};
  $("meta").each((_, el) => {
    const name = $(el).attr("name") || $(el).attr("property");
    const content = $(el).attr("content");
    if (name && content) metaTags[name.toLowerCase()] = content;
  });
  const links = [];
  $("a[href]").each((_, el) => {
    const n = normalizeUrl($(el).attr("href"), url);
    if (n) links.push(n);
  });
  const images = [];
  $("img").each((_, el) => images.push({ alt: $(el).attr("alt") || "" }));
  const forms = [];
  $("form").each((_, el) => {
    const inputs = [];
    $(el).find("input,select,textarea").each((_, inp) => inputs.push($(inp).attr("type") || "field"));
    forms.push({ action: $(el).attr("action") || "", inputs });
  });
  const headers = {};
  if (responseHeaders) for (const [k, v] of responseHeaders.entries()) headers[k.toLowerCase()] = v;

  const seo = extractSEO($);
  const freshness = extractFreshness($, metaTags);
  const tech = detectTechOnPage(html, headers);

  $("script,style,noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000);
  const { score: pageWeight, type: pageType } = scorePageWeight(url);

  return {
    url, pageWeight, pageType,
    title: $("title").first().text().trim(),
    statusCode, loadTime,
    hasHttps: url.startsWith("https://"),
    hasViewportMeta: html.includes('name="viewport"'),
    hasH1: html.includes("<h1"),
    hasCTA: /get.?started|sign.?up|contact|book|demo|free.?trial|buy/i.test(text.slice(0, 1500)),
    hasTestimonials: /testimonial|review|rating|trust/i.test(text),
    hasPricing: /pricing|plans|\$|£|€|per month|per year/i.test(text),
    hasLiveChat: /livechat|live.chat|intercom|drift|crisp|tawk/i.test(html),
    hasBlog: /blog|news|article|insights/i.test(html),
    hasSocialLinks: /facebook|twitter|linkedin|instagram|youtube/i.test(html),
    hasSearch: html.includes('type="search"') || html.includes("search-form"),
    imagesWithoutAlt: images.filter(i => !i.alt.trim()).length,
    forms, headers, metaTags, seo, freshness, tech,
    links: [...new Set(links)].slice(0, 30),
    textSnippet: text.slice(0, 1000),
  };
}

async function crawl(rootUrl, maxPages) {
  const normalizedRoot = normalizeUrl(rootUrl, rootUrl) || rootUrl;
  const origin = new URL(normalizedRoot).origin;
  const visited = new Set();
  const queue = [normalizedRoot];
  const pages = [];

  console.error(`[competitor-crawl] Starting: ${normalizedRoot} (max ${maxPages} pages)`);

  const securityPromise = fetchSecurityGrade(normalizedRoot);
  const pagespeedMobilePromise = fetchPageSpeed(normalizedRoot, "mobile");
  const pagespeedDesktopPromise = fetchPageSpeed(normalizedRoot, "desktop");

  let sitemapFound = false;
  try {
    const r = await fetch(`${origin}/sitemap.xml`, { headers: HEADERS });
    if (r.ok) sitemapFound = true;
  } catch {}

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try { if (new URL(url).origin !== origin) continue; } catch { continue; }

    try {
      const start = Date.now();
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      const loadTime = Date.now() - start;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) continue;
      const html = await res.text();
      const page = extractPage(url, html, res.status, loadTime, res.headers);
      pages.push(page);
      console.error(`[competitor-crawl] ✓ [weight:${page.pageWeight}] ${url}`);
      for (const link of page.links) {
        try { if (new URL(link).origin === origin && !visited.has(link)) queue.push(link); } catch {}
      }
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(`[competitor-crawl] ✗ ${url}: ${err.message}`);
    }
  }

  pages.sort((a, b) => b.pageWeight - a.pageWeight);

  const aggregatedTech = pages.reduce(
    (acc, p) => mergeTech(acc, p.tech),
    { analytics: [], ads: [], payments: [] }
  );

  const [security, pagespeedMobile, pagespeedDesktop] = await Promise.all([
    securityPromise, pagespeedMobilePromise, pagespeedDesktopPromise,
  ]);

  const output = {
    rootUrl: normalizedRoot,
    crawledAt: new Date().toISOString(),
    totalPages: pages.length,
    sitemapFound,
    security,
    pagespeed: { mobile: pagespeedMobile, desktop: pagespeedDesktop },
    techStack: aggregatedTech,
    pages,
  };

  const outDir = `reports/${clientDomain}`;
  mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/competitor-output.json`;
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`[competitor-crawl] Done. ${pages.length} pages → ${outFile}`);
  console.log(JSON.stringify({
    success: true,
    pages: pages.length,
    security,
    pagespeed: output.pagespeed,
    techStack: aggregatedTech,
    outputFile: outFile,
  }));
}

crawl(rootUrl, MAX_PAGES).catch(err => {
  console.error(err.message);
  process.exit(1);
});
