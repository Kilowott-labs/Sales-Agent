#!/usr/bin/env node
/**
 * save-report.js — Reads report content from stdin and saves it.
 * Usage: echo "# Report..." | node scripts/save-report.js <domain>
 * Or Claude can call: node scripts/save-report.js <domain> <filepath>
 */

import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const [, , domain, customPath] = process.argv;

const outputDir = "reports";
mkdirSync(outputDir, { recursive: true });

const filename = customPath || join(outputDir, `${(domain || "audit").replace(/[^a-z0-9-]/gi, "-")}-audit.md`);

// Read from stdin if available, otherwise check for crawl-output to derive domain
let content = "";
try {
  content = readFileSync("/dev/stdin", "utf-8");
} catch {
  console.error("No stdin content. Pipe the report markdown into this script.");
  process.exit(1);
}

writeFileSync(filename, content, "utf-8");
console.log(JSON.stringify({ success: true, savedTo: filename }));
