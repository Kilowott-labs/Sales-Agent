#!/usr/bin/env node
/**
 * a11y-scan.js — Runs axe-core accessibility scans on the top high-weight pages
 * already identified by crawl.js.
 *
 * Reads:  crawl-output.json
 * Writes: a11y-output.json
 *
 * Scans up to N pages (default 3) with the highest pageWeight. Uses puppeteer
 * to render each page with JS executed, then injects axe-core to get real WCAG
 * violations with severity.
 *
 * Usage: node scripts/a11y-scan.js [maxPages]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import puppeteer from "puppeteer";
import { AxePuppeteer } from "@axe-core/puppeteer";

const [, , domainArg, maxPagesArg] = process.argv;
const MAX_SCAN_PAGES = parseInt(maxPagesArg || "3");

if (!domainArg) {
  console.error("Usage: node scripts/a11y-scan.js <clientDomain> [maxPages]");
  process.exit(1);
}

const crawlFile = `reports/${domainArg}/crawl-output.json`;
if (!existsSync(crawlFile)) {
  console.error(`[a11y] ${crawlFile} not found. Run crawl.js first.`);
  process.exit(1);
}

const crawl = JSON.parse(readFileSync(crawlFile, "utf-8"));
const targets = crawl.pages
  .slice(0, MAX_SCAN_PAGES)
  .map(p => ({ url: p.url, pageType: p.pageType, pageWeight: p.pageWeight }));

if (targets.length === 0) {
  console.error("[a11y] No pages to scan.");
  writeFileSync(`reports/${domainArg}/a11y-output.json`, JSON.stringify({ scans: [], available: false }, null, 2));
  process.exit(0);
}

console.error(`[a11y] Scanning ${targets.length} page(s)...`);

function summariseByImpact(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    if (counts[v.impact] !== undefined) counts[v.impact] += v.nodes.length;
  }
  return counts;
}

function compactViolation(v) {
  return {
    id: v.id,
    impact: v.impact,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    affectedElements: v.nodes.length,
    examples: v.nodes.slice(0, 3).map(n => ({
      html: (n.html || "").slice(0, 200),
      target: n.target,
      failureSummary: (n.failureSummary || "").slice(0, 300),
    })),
  };
}

async function run() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err) {
    console.error(`[a11y] Could not launch browser: ${err.message}`);
    console.error("[a11y] Skipping accessibility scan. Run 'npx puppeteer browsers install chrome' if needed.");
    writeFileSync(`reports/${domainArg}/a11y-output.json`, JSON.stringify({
      scans: [],
      available: false,
      error: err.message,
    }, null, 2));
    return;
  }

  const scans = [];
  for (const target of targets) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1366, height: 900 });
      console.error(`[a11y] → ${target.url}`);
      await page.goto(target.url, { waitUntil: "networkidle2", timeout: 30000 });
      const results = await new AxePuppeteer(page)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();

      const violations = results.violations.map(compactViolation);
      const counts = summariseByImpact(results.violations);
      const totalFailures = counts.critical + counts.serious + counts.moderate + counts.minor;

      console.error(`[a11y]   ${violations.length} violation types, ${totalFailures} total failures (crit:${counts.critical} sr:${counts.serious} mod:${counts.moderate} min:${counts.minor})`);

      scans.push({
        url: target.url,
        pageType: target.pageType,
        pageWeight: target.pageWeight,
        violationTypes: violations.length,
        totalFailures,
        impactCounts: counts,
        violations,
        incomplete: results.incomplete.length,
        passes: results.passes.length,
      });
    } catch (err) {
      console.error(`[a11y]   ✗ ${target.url}: ${err.message}`);
      scans.push({
        url: target.url,
        pageType: target.pageType,
        pageWeight: target.pageWeight,
        error: err.message,
      });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const output = {
    available: true,
    scannedAt: new Date().toISOString(),
    pagesScanned: scans.length,
    scans,
    summary: {
      totalViolationTypes: scans.reduce((s, x) => s + (x.violationTypes || 0), 0),
      totalFailures: scans.reduce((s, x) => s + (x.totalFailures || 0), 0),
      totalCritical: scans.reduce((s, x) => s + (x.impactCounts?.critical || 0), 0),
      totalSerious: scans.reduce((s, x) => s + (x.impactCounts?.serious || 0), 0),
    },
  };

  const outFile = `reports/${domainArg}/a11y-output.json`;
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`[a11y] Done → ${outFile}`);
  console.log(JSON.stringify({ success: true, ...output.summary, outputFile: outFile }));
}

run().catch(err => {
  console.error(`[a11y] Fatal: ${err.message}`);
  process.exit(1);
});
