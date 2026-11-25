#!/usr/bin/env node
/**
 * Keeps real company data out of this public repo.
 *
 * Terms live in `.private-terms` at the repo root (git-ignored): one per line,
 * `#` for comments. Matching is case-insensitive on whole words: a term never
 * matches inside a longer word.
 *
 *   node scripts/check-private-terms.mjs          staged changes (pre-commit hook)
 *   node scripts/check-private-terms.mjs --all    every tracked file
 *
 * No `.private-terms` file → nothing to check (fresh clones, CI, cloud agents).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const TERMS_FILE = ".private-terms";
const scanAll = process.argv.includes("--all");

if (!existsSync(TERMS_FILE)) {
  if (scanAll) console.log(`No ${TERMS_FILE} file — nothing to check.`);
  process.exit(0);
}

const terms = readFileSync(TERMS_FILE, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
if (!terms.length) process.exit(0);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(
  `(?<![A-Za-z0-9])(?:${terms.map(escape).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** @type {Array<{ file: string; line: number | null; term: string; text: string }>} */
const hits = [];

function scanLine(file, line, text) {
  for (const match of text.matchAll(pattern)) {
    hits.push({ file, line, term: match[0], text: text.trim().slice(0, 140) });
  }
}

if (scanAll) {
  for (const file of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    if (!existsSync(file) || statSync(file).size > 4 * 1024 * 1024) continue;
    const buf = readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    scanLine(file, null, file); // the path itself
    buf
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((text, i) => scanLine(file, i + 1, text));
  }
} else {
  const names = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
    .split("\0")
    .filter(Boolean);
  for (const file of names) scanLine(file, null, file);

  let file = "";
  let lineNo = 0;
  const diff = git(["diff", "--cached", "-U0", "--no-color", "--diff-filter=ACMR"]);
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.replace(/^\+\+\+ (b\/)?/, "");
    } else if (raw.startsWith("@@")) {
      const m = /\+(\d+)/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
    } else if (raw.startsWith("+")) {
      scanLine(file, lineNo, raw.slice(1));
      lineNo += 1;
    }
  }
}

if (!hits.length) {
  if (scanAll) console.log(`Clean: no ${TERMS_FILE} terms in tracked files.`);
  process.exit(0);
}

console.error(`\nPrivate terms found (${TERMS_FILE}). This repo is public.\n`);
for (const hit of hits) {
  const where = hit.line == null ? `${hit.file} (file name)` : `${hit.file}:${hit.line}`;
  console.error(`  ${where}  [${hit.term}]  ${hit.text}`);
}
console.error(
  scanAll
    ? "\nMove real data to data/eval/private/ (git-ignored) or swap in fictional names.\n"
    : "\nMove real data to data/eval/private/ (git-ignored) or swap in fictional names.\n" +
        "If a hit is a false positive, edit .private-terms or commit with --no-verify.\n",
);
process.exit(1);
