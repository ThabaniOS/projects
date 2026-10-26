// Builds status.json from projects/*.md and validates every file.
// Run: node scripts/build-status.mjs            -> writes status.json
//      node scripts/build-status.mjs --check    -> validate only, no write
// Exits non-zero on any validation error, so a bad file never reaches the dashboard.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "projects");
const schema = JSON.parse(readFileSync(join(ROOT, "schema/project.schema.json"), "utf8"));
const CHECK_ONLY = process.argv.includes("--check");

function parseFrontmatter(src, file) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter block`);
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 1) throw new Error(`${file}: bad frontmatter line "${raw}"`);
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^\d+$/.test(val)) val = Number(val);
    data[key] = val;
  }
  return { data, body: m[2] };
}

function section(body, name) {
  const m = body.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  return m ? m[1] : "";
}

function validate(fm, file, body) {
  const errs = [];
  for (const k of schema.required) if (fm[k] === undefined || fm[k] === "") errs.push(`missing "${k}"`);
  for (const [k, rule] of Object.entries(schema.properties)) {
    const v = fm[k];
    if (v === undefined) continue;
    if (rule.enum && !rule.enum.includes(v)) errs.push(`"${k}" must be one of ${rule.enum.join(", ")} (got "${v}")`);
    if (rule.pattern && !new RegExp(rule.pattern).test(String(v))) errs.push(`"${k}" doesn't match ${rule.pattern} (got "${v}")`);
    if (rule.type === "integer" && !Number.isInteger(v)) errs.push(`"${k}" must be a whole number`);
  }
  for (const k of Object.keys(fm)) if (!schema.properties[k]) errs.push(`unknown field "${k}"`);
  if (fm.id && fm.id !== basename(file, ".md")) errs.push(`id "${fm.id}" must match the filename`);
  for (const t of body.matchAll(/^- \[[ xX]\] (\S+)/gm)) {
    if (!t[1].startsWith(`${fm.ticker}-`)) errs.push(`task "${t[1]}" must start with "${fm.ticker}-"`);
  }
  return errs;
}

const projects = [];
const problems = [];
const tickers = new Map();

for (const name of readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()) {
  const file = join(DIR, name);
  let parsed;
  try {
    parsed = parseFrontmatter(readFileSync(file, "utf8"), name);
  } catch (e) {
    problems.push(e.message);
    continue;
  }
  const { data: fm, body } = parsed;
  const errs = validate(fm, name, body);
  if (tickers.has(fm.ticker)) errs.push(`ticker "${fm.ticker}" already used by ${tickers.get(fm.ticker)}`);
  tickers.set(fm.ticker, name);
  if (errs.length) {
    problems.push(...errs.map((e) => `${name}: ${e}`));
    continue;
  }

  const tasks = [...section(body, "Tasks").matchAll(/^- \[([ xX])\] (\S+) (.+)$/gm)].map((m) => ({
    id: m[2],
    text: m[3].trim(),
    done: m[1] !== " ",
  }));
  const log = section(body, "Log").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  const open = tasks.filter((t) => !t.done);

  projects.push({
    id: fm.id,
    name: fm.name,
    ticker: fm.ticker,
    status: fm.status,
    category: fm.category,
    client: fm.client ?? null,
    priority: fm.priority,
    finish_line: fm.finish_line,
    deadline: fm.deadline ?? null,
    updated: fm.updated,
    open_tasks: open.map(({ id, text }) => ({ id, text })),
    done_count: tasks.length - open.length,
    last_log: log.at(-1) ?? null,
    // Legacy fields so the v3 dashboard and n8n query bot keep working until Phase 3/4.
    title: fm.name,
    type: fm.category === "personal" ? "personal" : "business",
    next_action: open[0] ? `${open[0].id} ${open[0].text}` : fm.finish_line,
    blocker: null,
    date_canvassed: fm.updated,
    last_modified: `${fm.updated}T00:00:00.000Z`,
  });
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
