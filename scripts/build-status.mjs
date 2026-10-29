// Builds status.json from projects/*.md and validates every file.
// Run: node scripts/build-status.mjs            -> writes status.json
//      node scripts/build-status.mjs --check    -> validate only, no write
// Exits non-zero on any validation error, so a bad file never reaches the dashboard.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject, validateProject, summarize } from "../lib/project.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, "projects");
const CHECK_ONLY = process.argv.includes("--check");

const projects = [];
const problems = [];
const tickers = new Map();

for (const name of readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()) {
  let parsed;
  try {
    parsed = parseProject(readFileSync(join(DIR, name), "utf8").replace(/\r\n/g, "\n"), name);
  } catch (e) {
    problems.push(e.message);
    continue;
  }
  const { fm, body } = parsed;
  const errs = validateProject(fm, body, name);
  if (tickers.has(fm.ticker)) errs.push(`ticker "${fm.ticker}" already used by ${tickers.get(fm.ticker)}`);
  tickers.set(fm.ticker, name);
  if (errs.length) {
    problems.push(...errs.map((e) => `${name}: ${e}`));
    continue;
  }
  projects.push(summarize(fm, body));
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ` + problems.join("\n  "));
  process.exit(1);
}

const order = { active: 0, pipeline: 1, live: 2, paused: 3 };
projects.sort((a, b) => order[a.status] - order[b.status] || a.priority - b.priority || a.name.localeCompare(b.name));

const out = {
  schema_version: 4,
  generated: new Date().toISOString(),
  total: projects.length,
  business: projects.filter((p) => p.type === "business").length,
  personal: projects.filter((p) => p.type === "personal").length,
  projects,
};

console.log(`✓ ${projects.length} projects valid`);
if (!CHECK_ONLY) {
  writeFileSync(join(ROOT, "status.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("✓ status.json written");
}
