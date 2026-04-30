#!/usr/bin/env node
/**
 * render-pdf.js — Renders a markdown report into a branded PDF.
 *
 * Usage: node scripts/render-pdf.js <markdown-path> [output-pdf-path]
 * Example: node scripts/render-pdf.js reports/acme-com-audit.md
 *          → writes reports/acme-com-audit.pdf
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import puppeteer from "puppeteer";
import { marked } from "marked";

const [, , mdPath, outPathArg] = process.argv;

if (!mdPath) {
  console.error("Usage: node scripts/render-pdf.js <markdown-path> [output-pdf-path]");
  process.exit(1);
}

const outPath = outPathArg || mdPath.replace(/\.md$/i, ".pdf");

const markdown = readFileSync(mdPath, "utf-8");
const bodyHtml = marked.parse(markdown, { gfm: true, breaks: false });

const today = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const htmlTemplate = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(basename(mdPath).replace(/\.md$/i, ""))}</title>
<style>
  @page { size: A4; margin: 22mm 18mm 24mm 18mm; }
  :root {
    --ink: #111827;
    --muted: #6b7280;
    --accent: #0d5cff;
    --accent-soft: #eef3ff;
    --border: #e5e7eb;
    --critical: #b91c1c;
    --warning: #b45309;
    --ok: #047857;
  }
  * { box-sizing: border-box; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.55;
    margin: 0;
  }
  .cover {
    page-break-after: always;
    padding: 60mm 0 0 0;
    text-align: left;
    border-left: 6px solid var(--accent);
    padding-left: 14mm;
  }
  .cover .eyebrow {
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 9pt;
    color: var(--accent);
    font-weight: 600;
    margin-bottom: 10mm;
  }
  .cover h1 {
    font-size: 26pt;
    line-height: 1.15;
    margin: 0 0 12mm 0;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .cover .meta {
    color: var(--muted);
    font-size: 10.5pt;
  }
  .cover .footer-strip {
    margin-top: 80mm;
    font-size: 9pt;
    color: var(--muted);
    border-top: 1px solid var(--border);
    padding-top: 6mm;
  }
  .content h1 {
    font-size: 18pt;
    margin-top: 14mm;
    margin-bottom: 3mm;
    font-weight: 700;
    color: var(--ink);
    border-bottom: 2px solid var(--accent);
    padding-bottom: 2mm;
  }
  .content h1:first-child { margin-top: 0; }
  .content h2 {
    font-size: 13.5pt;
    margin-top: 9mm;
    margin-bottom: 2.5mm;
    font-weight: 700;
    color: var(--ink);
  }
  .content h3 {
    font-size: 11.5pt;
    margin-top: 6mm;
    margin-bottom: 2mm;
    font-weight: 600;
    color: var(--ink);
  }
  .content p { margin: 0 0 3mm 0; }
  .content ul, .content ol { margin: 0 0 4mm 5mm; padding: 0; }
  .content li { margin-bottom: 1.5mm; }
  .content strong { font-weight: 600; }
  .content em { font-style: italic; color: var(--ink); }
  .content blockquote {
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    padding: 3mm 5mm;
    margin: 3mm 0;
    font-style: normal;
    color: var(--ink);
  }
  .content blockquote p:last-child { margin-bottom: 0; }
  .content code {
    background: #f3f4f6;
    padding: 0.5mm 1.5mm;
    border-radius: 1mm;
    font-family: "SF Mono", "Consolas", "Courier New", monospace;
    font-size: 9.5pt;
  }
  .content pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 4mm;
    border-radius: 2mm;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.45;
  }
  .content pre code { background: transparent; padding: 0; color: inherit; }
  .content table {
    border-collapse: collapse;
    width: 100%;
    margin: 4mm 0;
    font-size: 9.5pt;
  }
  .content th {
    background: var(--accent-soft);
    color: var(--ink);
    text-align: left;
    padding: 2mm 3mm;
    border: 1px solid var(--border);
    font-weight: 600;
  }
  .content td {
    padding: 2mm 3mm;
    border: 1px solid var(--border);
    vertical-align: top;
  }
  .content tr:nth-child(even) td { background: #fafbfc; }
  .content a { color: var(--accent); text-decoration: none; }
  .content hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 6mm 0;
  }
  .content img { max-width: 100%; height: auto; }
</style>
</head>
<body>
  <div class="cover">
    <div class="eyebrow">Website Sales Audit</div>
    <h1>${escapeHtml(extractTitle(markdown) || "Website Audit Report")}</h1>
    <div class="meta">
      Prepared ${today}<br>
      by Kilowott
    </div>
    <div class="footer-strip">
      Confidential — prepared for internal sales use. Findings are based on publicly available signals at the time of audit.
    </div>
  </div>
  <div class="content">
    ${bodyHtml}
  </div>
</body>
</html>`;

function extractTitle(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

async function render() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err) {
    console.error(`[pdf] Could not launch browser: ${err.message}`);
    console.error("[pdf] Run 'npx puppeteer browsers install chrome' if this is the first run.");
    process.exit(1);
  }

  try {
    const page = await browser.newPage();
    await page.setContent(htmlTemplate, { waitUntil: "domcontentloaded" });
    await page.pdf({
      path: resolve(outPath),
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="font-size:8pt; color:#9ca3af; width:100%; padding:0 14mm; display:flex; justify-content:space-between;">
          <span>Kilowott — Website Sales Audit</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
      margin: { top: "22mm", bottom: "24mm", left: "18mm", right: "18mm" },
    });
    console.error(`[pdf] Wrote ${outPath}`);
    console.log(JSON.stringify({ success: true, savedTo: outPath }));
  } finally {
    await browser.close();
  }
}

render().catch(err => {
  console.error(`[pdf] Fatal: ${err.message}`);
  process.exit(1);
});
