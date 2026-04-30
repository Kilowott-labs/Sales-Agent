#!/usr/bin/env node
/**
 * crawl.js — Fetches and parses a website for the upsell-bot agent.
 * Usage: node scripts/crawl.js <url> [maxPages]
 * Output: writes crawl-output.json in the current directory
 */

import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";

const [, , rootUrl, maxPagesArg] = process.argv;

if (!rootUrl) {
  console.error("Usage: node scripts/crawl.js <url> [maxPages]");
  process.exit(1);
}

const MAX_PAGES = parseInt(maxPagesArg || "15");

// ─── Page weight scoring ──────────────────────────────────────────────────
const KEY_PAGE_PATTERNS = [
  { pattern: /^\/?$|\/home\/?$/i,                       score: 10, type: "homepage" },
  { pattern: /\/pricing|\/plans|\/packages/i,            score: 9,  type: "pricing" },
  { pattern: /\/contact|\/get-in-touch|\/reach-us/i,    score: 8,  type: "contact" },
  { pattern: /\/product|\/service|\/solution|\/offer/i,  score: 8,  type: "product" },
  { pattern: /\/about|\/team|\/who-we-are/i,             score: 6,  type: "about" },
  { pattern: /\/demo|\/trial|\/signup|\/register/i,      score: 8,  type: "conversion" },
  { pattern: /\/faq|\/help|\/support/i,                  score: 5,  type: "support" },
  { pattern: /\/blog|\/news|\/article|\/post/i,          score: 2,  type: "blog" },
  { pattern: /\/tag|\/category|\/author/i,               score: 1,  type: "taxonomy" },
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

// ─── Security grade via Mozilla Observatory API (no key required) ─────────
async function fetchSecurityGrade(url) {
  try {
    const hostname = new URL(url).hostname;
    console.error(`[security] Scanning ${hostname} via Mozilla Observatory...`);

    const scanRes = await fetch(
      `https://observatory.mozilla.org/api/v1/analyze?host=${hostname}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "rescan=true",
      }
    );

    if (!scanRes.ok) {
      console.error(`[security] Observatory scan failed: ${scanRes.status}`);
      return null;
    }

    let scan = await scanRes.json();
    let attempts = 0;
    while (scan.state !== "FINISHED" && scan.state !== "FAILED" && attempts < 10) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(
        `https://observatory.mozilla.org/api/v1/analyze?host=${hostname}`
      );
      scan = await pollRes.json();
      attempts++;
      console.error(`[security] Waiting for scan... (${scan.state})`);
    }

    if (scan.state === "FINISHED") {
      console.error(`[security] Grade: ${scan.grade} (${scan.score}/100)`);
      return { grade: scan.grade, score: scan.score, source: "Mozilla Observatory" };
    }

    return null;
  } catch (err) {
    console.error(`[security] Could not fetch grade: ${err.message}`);
    return null;
  }
}

// ─── Tech stack fingerprinting ────────────────────────────────────────────
const TECH_PATTERNS = {
  cms: [
    { test: /wp-content|wp-includes|wp-json/i, name: "WordPress" },
    { test: /cdn\.shopify\.com|shopify-section|Shopify\.theme/i, name: "Shopify" },
    { test: /webflow\.com|w-mod|webflow-style/i, name: "Webflow" },
    { test: /wixstatic\.com|wix-(warmup|boot)/i, name: "Wix" },
    { test: /squarespace-cdn|static1\.squarespace/i, name: "Squarespace" },
    { test: /drupal-settings-json|sites\/default\/files/i, name: "Drupal" },
    { test: /ghost-url|ghost\.io/i, name: "Ghost" },
    { test: /hubspotusercontent|hs-scripts\.com/i, name: "HubSpot CMS" },
    { test: /Mage\.Cookies|mage\/cookies|magento/i, name: "Magento" },
    { test: /woocommerce|wc-blocks|wc-ajax/i, name: "WooCommerce" },
    { test: /bigcommerce\.com|stencil-utils/i, name: "BigCommerce" },
    { test: /framer\.(com|website)/i, name: "Framer" },
    { test: /sanity\.io|sanityClient/i, name: "Sanity" },
    { test: /contentful\.com|ctfassets\.net/i, name: "Contentful" },
  ],
  framework: [
    { test: /__NEXT_DATA__|_next\/static/i, name: "Next.js" },
    { test: /_nuxt|__NUXT__/i, name: "Nuxt.js" },
    { test: /ng-version=|ng-app=/i, name: "Angular" },
    { test: /gatsby-(chunk|image|focus-wrapper)/i, name: "Gatsby" },
    { test: /data-reactroot|react-dom/i, name: "React" },
    { test: /data-v-[a-f0-9]{8}/i, name: "Vue.js" },
    { test: /svelte-[a-z0-9]{6}/i, name: "Svelte" },
    { test: /astro-[a-z0-9]+/i, name: "Astro" },
    { test: /remix-run|@remix/i, name: "Remix" },
  ],
  analytics: [
    { test: /gtag\(|google-analytics\.com|googletagmanager\.com/i, name: "Google Analytics / GTM" },
    { test: /hotjar\.com|_hjSettings/i, name: "Hotjar" },
    { test: /mixpanel\.com|mixpanel\.init/i, name: "Mixpanel" },
    { test: /amplitude\.com|amplitude\.getInstance/i, name: "Amplitude" },
    { test: /segment\.com\/analytics|analytics\.load/i, name: "Segment" },
    { test: /plausible\.io\/js/i, name: "Plausible" },
    { test: /matomo\.js|piwik\.js/i, name: "Matomo" },
    { test: /cdn\.heapanalytics\.com/i, name: "Heap" },
    { test: /fullstory\.com|_fs_script/i, name: "FullStory" },
    { test: /clarity\.ms/i, name: "Microsoft Clarity" },
  ],
  ads: [
    { test: /fbevents\.js|connect\.facebook\.net\/.*\/fbevents/i, name: "Meta Pixel" },
    { test: /googleadservices\.com|googlesyndication|adwords/i, name: "Google Ads" },
    { test: /snap\.licdn\.com\/li\.lms-analytics|linkedin.*insight/i, name: "LinkedIn Insight Tag" },
    { test: /static\.ads-twitter\.com|twq\(/i, name: "Twitter/X Pixel" },
    { test: /analytics\.tiktok\.com|ttq\.(load|track)/i, name: "TikTok Pixel" },
    { test: /r\.pinimg\.com\/.*\/pintag|pintrk\(/i, name: "Pinterest Tag" },
    { test: /bat\.bing\.com|uetq/i, name: "Microsoft Advertising (Bing)" },
    { test: /redditstatic\.com\/ads|rdt\(/i, name: "Reddit Pixel" },
  ],
  payments: [
    { test: /js\.stripe\.com|stripe\.com\/v3|Stripe\(/i, name: "Stripe" },
    { test: /checkout\.razorpay\.com|razorpay\.com\/v1/i, name: "Razorpay" },
    { test: /paypal\.com\/sdk|paypalobjects\.com/i, name: "PayPal" },
    { test: /squareup\.com|web\.squarecdn/i, name: "Square" },
    { test: /cdn\.adyen\.com|checkoutshopper/i, name: "Adyen" },
    { test: /js\.braintreegateway|braintree-web/i, name: "Braintree" },
  ],
  liveChat: [
    { test: /widget\.intercom\.io|intercomcdn/i, name: "Intercom" },
    { test: /js\.driftt\.com|drift\.com\/platform/i, name: "Drift" },
    { test: /client\.crisp\.chat/i, name: "Crisp" },
    { test: /embed\.tawk\.to/i, name: "Tawk.to" },
    { test: /static\.zdassets\.com|zopim|zendesk-chat/i, name: "Zendesk" },
    { test: /cdn\.livechatinc\.com/i, name: "LiveChat" },
    { test: /widget-mediator\.hubspot/i, name: "HubSpot Chat" },
  ],
  email: [
    { test: /chimpstatic\.com|list-manage\.com|mailchimp/i, name: "Mailchimp" },
    { test: /klaviyo\.com|_learnq/i, name: "Klaviyo" },
    { test: /js\.hs-forms|hs-scripts.*forms/i, name: "HubSpot Forms" },
    { test: /convertkit\.com|ck\.page/i, name: "ConvertKit" },
    { test: /activehosted\.com|trackcmp\.net/i, name: "ActiveCampaign" },
  ],
};

function matchPatterns(haystack, patterns) {
  return patterns.filter(p => p.test.test(haystack)).map(p => p.name);
}
function matchFirstPattern(haystack, patterns) {
  return patterns.find(p => p.test.test(haystack))?.name || null;
}

function detectHosting(headers) {
  const server = (headers["server"] || "").toString();
  if (headers["cf-ray"]) return "Cloudflare";
  if (headers["x-vercel-id"] || headers["x-vercel-cache"]) return "Vercel";
  if (headers["x-nf-request-id"]) return "Netlify";
  if (headers["x-amz-cf-id"] || /cloudfront/i.test(headers["via"] || "")) return "AWS CloudFront";
  if (/akamai/i.test(server) || headers["x-akamai-transformed"]) return "Akamai";
  if (/fastly/i.test(server) || headers["x-served-by"]?.includes("cache")) return "Fastly";
  if (/nginx/i.test(server)) return `Nginx${server.match(/[\d.]+/)?.[0] ? ` ${server.match(/[\d.]+/)[0]}` : ""}`;
  if (/apache/i.test(server)) return `Apache${server.match(/[\d.]+/)?.[0] ? ` ${server.match(/[\d.]+/)[0]}` : ""}`;
  if (/litespeed/i.test(server)) return "LiteSpeed";
  if (/iis/i.test(server)) return "Microsoft IIS";
  return server || null;
}

function detectTechOnPage(html, headers) {
  const haystack = html + "\n" + JSON.stringify(headers);
  return {
    cms: matchFirstPattern(haystack, TECH_PATTERNS.cms),
    framework: matchFirstPattern(haystack, TECH_PATTERNS.framework),
    analytics: matchPatterns(haystack, TECH_PATTERNS.analytics),
    ads: matchPatterns(haystack, TECH_PATTERNS.ads),
    payments: matchPatterns(haystack, TECH_PATTERNS.payments),
    liveChat: matchFirstPattern(haystack, TECH_PATTERNS.liveChat),
    email: matchPatterns(haystack, TECH_PATTERNS.email),
    hosting: detectHosting(headers),
    serverSoftware: headers["x-powered-by"] || null,
  };
}

function mergeTech(aggregate, page) {
  aggregate.cms ||= page.cms;
  aggregate.framework ||= page.framework;
  aggregate.liveChat ||= page.liveChat;
  aggregate.hosting ||= page.hosting;
  aggregate.serverSoftware ||= page.serverSoftware;
  for (const key of ["analytics", "ads", "payments", "email"]) {
    aggregate[key] = [...new Set([...(aggregate[key] || []), ...(page[key] || [])])];
  }
  return aggregate;
}

// ─── SEO depth extraction ─────────────────────────────────────────────────
function extractSEO($) {
  const title = $("title").first().text().trim();
  const desc = $('meta[name="description"]').attr("content")?.trim() || "";
  const og = $('meta[property^="og:"]').length;
  const tw = $('meta[name^="twitter:"]').length;
  const jsonLd = $('script[type="application/ld+json"]').length;
  const canonical = $('link[rel="canonical"]').attr("href") || null;
  const hreflang = $('link[rel="alternate"][hreflang]').length;
  const robots = $('meta[name="robots"]').attr("content") || null;

  const titleIssue =
    !title ? "missing" :
    title.length < 30 ? "too short" :
    title.length > 65 ? "too long" : null;
  const descIssue =
    !desc ? "missing" :
    desc.length < 70 ? "too short" :
    desc.length > 160 ? "too long" : null;

  return {
    titleLength: title.length,
    descLength: desc.length,
    hasTitle: !!title,
    hasDescription: !!desc,
    ogTagCount: og,
    twitterTagCount: tw,
    jsonLdCount: jsonLd,
    hasOpenGraph: og > 0,
    hasTwitterCard: tw > 0,
    hasStructuredData: jsonLd > 0,
    canonical,
    hreflangCount: hreflang,
    robots,
    titleIssue,
    descIssue,
  };
}

// ─── Content freshness ────────────────────────────────────────────────────
function extractFreshness($, metaTags) {
  const dates = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const json = JSON.parse(raw);
      const items = Array.isArray(json) ? json : (json["@graph"] ? json["@graph"] : [json]);
      items.forEach(item => {
        if (item.datePublished) dates.push(item.datePublished);
        if (item.dateModified) dates.push(item.dateModified);
      });
    } catch {}
  });
  if (metaTags["article:published_time"]) dates.push(metaTags["article:published_time"]);
  if (metaTags["article:modified_time"]) dates.push(metaTags["article:modified_time"]);
  if (metaTags["og:updated_time"]) dates.push(metaTags["og:updated_time"]);
  $("time[datetime]").each((_, el) => {
    const d = $(el).attr("datetime");
    if (d) dates.push(d);
  });

  const parsed = dates
    .map(d => new Date(d))
    .filter(d => !isNaN(d.valueOf()) && d.getFullYear() > 1990 && d.valueOf() <= Date.now() + 86400000);
  if (parsed.length === 0) return null;
  const latest = new Date(Math.max(...parsed.map(d => d.valueOf())));
  return {
    latestDate: latest.toISOString(),
    daysSincePublished: Math.floor((Date.now() - latest.valueOf()) / 86400000),
  };
}

// ─── Sitemap stats ────────────────────────────────────────────────────────
async function fetchSitemapStats(origin) {
  try {
    const res = await fetch(`${origin}/sitemap.xml`, { headers: HEADERS });
    if (!res.ok) return { found: false };
    const xml = await res.text();
    const urlMatches = xml.match(/<loc>/g) || [];
    const lastmodMatches = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1]);
    const parsedDates = lastmodMatches
      .map(d => new Date(d))
      .filter(d => !isNaN(d.valueOf()));
    const latest = parsedDates.length
      ? new Date(Math.max(...parsedDates.map(d => d.valueOf()))).toISOString()
      : null;
    return {
      found: true,
      urlCount: urlMatches.length,
      latestLastmod: latest,
      daysSinceLastmod: latest ? Math.floor((Date.now() - new Date(latest).valueOf()) / 86400000) : null,
    };
  } catch {
    return { found: false };
  }
}

// ─── Ad intelligence (deep links for sales rep) ───────────────────────────
function buildAdIntelligence(rootUrl, aggregatedTech, brandName) {
  const hostname = new URL(rootUrl).hostname.replace(/^www\./, "");
  const query = encodeURIComponent(brandName || hostname.split(".")[0]);
  return {
    detectedAdPixels: aggregatedTech.ads || [],
    metaAdLibraryUrl: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${query}&search_type=keyword_unordered`,
    googleAdsTransparencyUrl: `https://adstransparency.google.com/?region=anywhere&domain=${hostname}`,
    linkedInAdsUrl: `https://www.linkedin.com/ad-library/search?keyword=${query}`,
    tiktokAdsUrl: `https://library.tiktok.com/ads?region=all&q=${query}`,
    note: "These libraries are public. Check them manually to see active ad creative, spend signals, and targeting strategy.",
  };
}

// ─── Crawl helpers ────────────────────────────────────────────────────────
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
  } catch {
    return null;
  }
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
  $("img").each((_, el) => {
    images.push({ src: $(el).attr("src") || "", alt: $(el).attr("alt") || "" });
  });

  const forms = [];
  $("form").each((_, el) => {
    const inputs = [];
    $(el).find("input,select,textarea").each((_, inp) => {
      inputs.push($(inp).attr("type") || $(inp).attr("name") || "field");
    });
    forms.push({ action: $(el).attr("action") || "", inputs });
  });

  const headers = {};
  if (responseHeaders) {
    for (const [k, v] of responseHeaders.entries()) headers[k.toLowerCase()] = v;
  }

  const seo = extractSEO($);
  const freshness = extractFreshness($, metaTags);
  const tech = detectTechOnPage(html, headers);

  $("script,style,noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);

  const { score: pageWeight, type: pageType } = scorePageWeight(url);

  return {
    url,
    pageWeight,
    pageType,
    title: $("title").first().text().trim(),
    statusCode,
    loadTime,
    hasHttps: url.startsWith("https://"),
    hasViewportMeta: html.includes('name="viewport"') || html.includes("name='viewport'"),
    hasH1: html.includes("<h1"),
    hasH2: html.includes("<h2"),
    htmlLang: /<html[^>]+lang=/.test(html),
    hasCookieBanner: /cookie|gdpr|consent/i.test(text),
    hasPrivacyPolicy: /privacy.?policy/i.test(text),
    hasCTA: /get.?started|sign.?up|contact|book|demo|free.?trial|buy.?now/i.test(text.slice(0, 1500)),
    hasTestimonials: /testimonial|review|rating|trust/i.test(text),
    hasSocialLinks: /facebook|twitter|linkedin|instagram|youtube/i.test(html),
    hasSearch: html.includes('type="search"') || html.includes("search-form"),
    imagesWithoutAlt: images.filter(i => !i.alt.trim()).length,
    images: images.slice(0, 20),
    forms,
    metaTags,
    headers,
    seo,
    freshness,
    tech,
    links: [...new Set(links)].slice(0, 50),
    textSnippet: text.slice(0, 1500),
  };
}

async function crawl(rootUrl, maxPages) {
  const normalizedRoot = normalizeUrl(rootUrl, rootUrl) || rootUrl;
  const origin = new URL(normalizedRoot).origin;
  const visited = new Set();
  const queue = [normalizedRoot];
  const pages = [];

  let robotsTxt = null;
  try {
    const r = await fetch(`${origin}/robots.txt`, { headers: HEADERS });
    if (r.ok) robotsTxt = (await r.text()).slice(0, 1000);
  } catch {}

  console.error(`[crawl] Starting: ${normalizedRoot} (max ${maxPages} pages)`);

  // Fire long-running external scans in parallel ──────────────────────────
  const securityPromise = fetchSecurityGrade(normalizedRoot);
  const sitemapPromise = fetchSitemapStats(origin);

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      if (new URL(url).origin !== origin) continue;
    } catch { continue; }

    try {
      const start = Date.now();
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      const loadTime = Date.now() - start;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) continue;

      const html = await res.text();
      const page = extractPage(url, html, res.status, loadTime, res.headers);
      pages.push(page);
      console.error(`[crawl] ✓ [weight:${page.pageWeight} type:${page.pageType}] ${url} (${loadTime}ms)`);

      for (const link of page.links) {
        try {
          if (new URL(link).origin === origin && !visited.has(link)) queue.push(link);
        } catch {}
      }

      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(`[crawl] ✗ ${url}: ${err.message}`);
    }
  }

  pages.sort((a, b) => b.pageWeight - a.pageWeight);

  // Aggregate tech stack across all pages ─────────────────────────────────
  const aggregatedTech = pages.reduce(
    (acc, p) => mergeTech(acc, p.tech),
    { analytics: [], ads: [], payments: [], email: [] }
  );

  // Determine a brand name for ad library search (best guess) ─────────────
  const topPage = pages[0];
  const brandName =
    topPage?.metaTags?.["og:site_name"] ||
    topPage?.title?.split(/[-|–—·:]/)[0]?.trim() ||
    new URL(normalizedRoot).hostname.replace(/^www\./, "").split(".")[0];

  const [security, sitemap] = await Promise.all([
    securityPromise,
    sitemapPromise,
  ]);

  const adIntelligence = buildAdIntelligence(normalizedRoot, aggregatedTech, brandName);

  // Freshness: latest article across all pages ────────────────────────────
  const allFreshDates = pages
    .map(p => p.freshness?.latestDate)
    .filter(Boolean)
    .map(d => new Date(d).valueOf());
  const siteFreshness = allFreshDates.length
    ? {
        latestContentDate: new Date(Math.max(...allFreshDates)).toISOString(),
        daysSinceLatest: Math.floor((Date.now() - Math.max(...allFreshDates)) / 86400000),
      }
    : null;

  const output = {
    rootUrl: normalizedRoot,
    crawledAt: new Date().toISOString(),
    totalPages: pages.length,
    brandName,
    sitemap,
    robotsTxt,
    security,
    techStack: aggregatedTech,
    contentFreshness: siteFreshness,
    adIntelligence,
    pages,
  };

  const domain = new URL(rootUrl).hostname.replace(/^www\./, "");
  const outDir = `reports/${domain}`;
  mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/crawl-output.json`;
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`[crawl] Done. ${pages.length} pages → ${outFile}`);
  if (security) console.error(`[security] Final grade: ${security.grade} (${security.score}/100)`);
  console.log(JSON.stringify({
    success: true,
    pages: pages.length,
    security,
    techStack: aggregatedTech,
    outputFile: outFile,
  }));
}

crawl(rootUrl, MAX_PAGES).catch(err => {
  console.error(err.message);
  process.exit(1);
});
