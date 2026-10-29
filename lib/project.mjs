// Shared project-file library: parse, validate, summarise and edit projects/<id>.md.
// Used by scripts/build-status.mjs (GitHub Action) and api/telegram.mjs (bot).
// Edits are surgical line edits, so Notes and formatting the bot doesn't touch stay exactly as written.

import { readFileSync } from "node:fs";

export const schema = JSON.parse(readFileSync(new URL("../schema/project.schema.json", import.meta.url), "utf8"));

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const TASK_RE = /^- \[([ xX])\] ([A-Z]{2,4}-\d+) (.+)$/;

/** Today's date in Johannesburg (UTC+2, no DST) as YYYY-MM-DD. */
export function sastDate(d = new Date()) {
  return new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
}

/** Johannesburg date and time as "YYYY-MM-DD HH:MM". */
export function sastStamp(d = new Date()) {
  return new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
}

/** One clean line: no newlines, no leading/trailing space. */
export function oneLine(v) {
  return String(v ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
}

export function parseProject(src, file = "project") {
  const m = src.match(FM_RE);
  if (!m) throw new Error(`${file}: missing frontmatter block`);
  const fm = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 1) throw new Error(`${file}: bad frontmatter line "${raw}"`);
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^\d+$/.test(val)) val = Number(val);
    fm[key] = val;
  }
  return { fm, body: m[2] };
}

export function section(body, name) {
  const m = body.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  return m ? m[1] : "";
}

export function tasksOf(body) {
  return section(body, "Tasks")
    .split("\n")
    .map((l) => l.match(TASK_RE))
    .filter(Boolean)
    .map((m) => ({ id: m[2], text: m[3].trim(), done: m[1] !== " " }));
}

export function logOf(body) {
  return section(body, "Log").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
}

/** Returns a list of problems; empty means valid. */
export function validateProject(fm, body, file) {
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
  const stem = file.replace(/^.*\//, "").replace(/\.md$/, "");
  if (fm.id && fm.id !== stem) errs.push(`id "${fm.id}" must match the filename`);
  for (const t of body.matchAll(/^- \[[ xX]\] (\S+)/gm)) {
    if (!t[1].startsWith(`${fm.ticker}-`)) errs.push(`task "${t[1]}" must start with "${fm.ticker}-"`);
  }
  const ids = tasksOf(body).map((t) => t.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) errs.push(`task ID "${dup}" is used twice`);
  return errs;
}

/** The status.json entry for one project. */
export function summarize(fm, body) {
  const tasks = tasksOf(body);
  const open = tasks.filter((t) => !t.done);
  const log = logOf(body);
  return {
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
    // Legacy v3 fields so the old dashboard and n8n query bot keep working until cutover.
    title: fm.name,
    type: fm.category === "personal" ? "personal" : "business",
    next_action: open[0] ? `${open[0].id} ${open[0].text}` : fm.finish_line,
    blocker: null,
    date_canvassed: fm.updated,
    last_modified: `${fm.updated}T00:00:00.000Z`,
  };
}

// ---------- surgical edits ----------

function splitFrontmatter(src) {
  const lines = src.split("\n");
  if (lines[0].trim() !== "---") throw new Error("missing frontmatter");
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 1) throw new Error("unterminated frontmatter");
  return { lines, end };
}

/** Set (or remove, with value null) one frontmatter field. */
export function setField(src, key, value) {
  if (!schema.properties[key]) throw new Error(`unknown field "${key}"`);
  const { lines, end } = splitFrontmatter(src);
  const idx = lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`));
  if (value === null || value === undefined || value === "") {
    if (idx !== -1) lines.splice(idx, 1);
    return lines.join("\n");
  }
  const line = `${key}: ${oneLine(value)}`;
  if (idx !== -1) lines[idx] = line;
  else lines.splice(end, 0, line);
  return lines.join("\n");
}

function sectionRange(lines, name) {
  const start = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  return { start, end };
}

function ensureSection(src, name, after) {
  const lines = src.split("\n");
  if (sectionRange(lines, name)) return src;
  const prev = after ? sectionRange(lines, after) : null;
  const at = prev ? prev.end : lines.length;
  lines.splice(at, 0, `## ${name}`, "");
  return lines.join("\n");
}

/** Insert a line after the last list item in a section (or right under its heading). */
function appendToSection(src, name, line, after) {
  const lines = ensureSection(src, name, after).split("\n");
  const { start, end } = sectionRange(lines, name);
  let at = start + 1;
  for (let i = start + 1; i < end; i++) if (lines[i].startsWith("- ")) at = i + 1;
  lines.splice(at, 0, line);
  return lines.join("\n");
}

export function nextTaskId(src, ticker) {
  let max = 0;
  for (const m of src.matchAll(new RegExp(`^- \\[[ xX]\\] ${ticker}-(\\d+)\\b`, "gm"))) max = Math.max(max, Number(m[1]));
  return `${ticker}-${max + 1}`;
}

export function addTask(src, ticker, text) {
  const id = nextTaskId(src, ticker);
  return { src: appendToSection(src, "Tasks", `- [ ] ${id} ${oneLine(text)}`), id };
}

function findTask(src, id) {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => {
    const m = l.match(TASK_RE);
    return m && m[2] === id;
  });
  if (i === -1) throw new Error(`task ${id} not found`);
  return { lines, i, m: lines[i].match(TASK_RE) };
}

export function completeTask(src, id, date) {
  const { lines, i, m } = findTask(src, id);
  if (m[1] !== " ") throw new Error(`task ${id} is already done`);
  lines[i] = `- [x] ${id} ${m[3].trim()} (done ${date})`;
  return lines.join("\n");
}

export function reopenTask(src, id) {
  const { lines, i, m } = findTask(src, id);
  if (m[1] === " ") throw new Error(`task ${id} is already open`);
  lines[i] = `- [ ] ${id} ${m[3].replace(/\s*\(done \d{4}-\d{2}-\d{2}\)$/, "").trim()}`;
  return lines.join("\n");
}

export function editTask(src, id, text) {
  const { lines, i, m } = findTask(src, id);
  lines[i] = `- [${m[1]}] ${id} ${oneLine(text)}`;
  return lines.join("\n");
}

export function addLog(src, date, text) {
  return appendToSection(src, "Log", `- ${date}: ${oneLine(text)}`, "Tasks");
}

/** A brand-new project file. */
export function newProjectFile(p, date) {
  const fm = ["---", `id: ${p.id}`, `name: ${oneLine(p.name)}`, `ticker: ${p.ticker}`, `status: ${p.status}`, `category: ${p.category}`];
  if (p.client) fm.push(`client: ${oneLine(p.client)}`);
  fm.push(`priority: ${p.priority}`, `finish_line: ${oneLine(p.finish_line)}`);
  if (p.deadline) fm.push(`deadline: ${p.deadline}`);
  fm.push(`updated: ${date}`, "---");
  const tasks = (p.tasks ?? []).map((t, i) => `- [ ] ${p.ticker}-${i + 1} ${oneLine(t)}`);
  return [...fm, "", "## Tasks", ...tasks, "", "## Log", `- ${date}: Created via Telegram.`, "", "## Notes", oneLine(p.notes ?? ""), ""].join("\n");
}
