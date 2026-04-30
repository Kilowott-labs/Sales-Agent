#!/usr/bin/env node
/**
 * ensure-chromium.js — Safety net that makes sure Puppeteer has a Chrome
 * binary available. Runs automatically as a postinstall hook, and can be
 * invoked manually with `node scripts/ensure-chromium.js`.
 *
 * Puppeteer's own postinstall downloads Chrome, but can fail silently on
 * flaky networks, behind proxies, or if a previous install was interrupted.
 * This script re-runs the install (idempotent — skips if already cached)
 * so the a11y scan and PDF render always Just Work™.
 *
 * Exits 0 even on failure — we don't want to block `npm install` if the
 * machine is offline. The crawl script still works without Puppeteer.
 */

import { execSync } from "child_process";

try {
  console.error("[chromium] Verifying Chrome is installed for Puppeteer...");
  execSync("npx puppeteer browsers install chrome", {
    stdio: "inherit",
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "false" },
  });
  console.error("[chromium] ✓ Chrome ready.");
} catch (err) {
  console.error(`[chromium] Warning: Chrome install failed — ${err.message}`);
  console.error("[chromium] The crawl and basic analysis will still work.");
  console.error("[chromium] To enable the accessibility scan and PDF render later, run:");
  console.error("[chromium]   npx puppeteer browsers install chrome");
  // Exit 0 — do not block npm install
}
