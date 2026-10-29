// Turns a list of requested changes into concrete file edits + a readable diff.
// Used twice per change: once when proposing (dry run, shown to Thabani) and again on Confirm
// against the then-current files, so a stale proposal can never overwrite newer edits.

import * as P from "./project.mjs";
import { escapeHtml as h } from "./telegram.mjs";

const SETTABLE = ["name", "status", "category", "client", "priority", "finish_line", "deadline"];

export class ProposalError extends Error {}

/** Find a project by ticker, id or name. index = status.json projects. */
export function resolveRef(ref, index) {
  const r = String(ref ?? "").trim().toLowerCase();
  if (!r) return null;
  return (
    index.find((p) => p.ticker.toLowerCase() === r) ??
    index.find((p) => p.id === r) ??
    index.find((p) => p.name.toLowerCase() === r) ??
    index.find((p) => p.name.toLowerCase().includes(r)) ??
    null
  );
}

/**
 * changes: array of { action: "update" | "create" | "sunset", ... } (see the propose_changes tool schema).
 * readFile(path) -> string | null. index: status.json projects. date: YYYY-MM-DD.
 * Returns { files: {path: content|null}, html, plain, title, sunsets: [{ path, filename, content, name }] }.
 * Throws ProposalError with a message the model (or Thabani) can act on.
 */
export async function buildProposal(changes, { readFile, index, date }) {
  if (!Array.isArray(changes) || !changes.length) throw new ProposalError("No changes given.");
  const files = {};
  const html = [];
  const plain = [];
  const titles = [];
  const sunsets = [];
  const tickers = new Set(index.map((p) => p.ticker));

  for (const c of changes) {
    const action = c.action ?? "update";

    if (action === "create") {
      const id = String(c.id ?? c.project ?? "").trim().toLowerCase();
      const ticker = String(c.ticker ?? "").trim().toUpperCase();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new ProposalError(`New project id "${id}" must be kebab-case, e.g. "stadium-checkin".`);
      if (tickers.has(ticker) || Object.values(files).some((f) => f && f.includes(`\nticker: ${ticker}\n`)))
        throw new ProposalError(`Ticker ${ticker} is already taken. Pick another 2–4 letter ticker.`);
      if (files[`projects/${id}.md`] !== undefined || (await readFile(`projects/${id}.md`)) !== null)
        throw new ProposalError(`A project with id "${id}" already exists.`);
      const p = {
        id,
        ticker,
        name: c.name,
        status: c.status ?? "active",
        category: c.category,
        client: c.client,
        priority: c.priority ?? 2,
        finish_line: c.finish_line,
        deadline: c.deadline,
        tasks: c.tasks ?? c.add_tasks ?? [],
        notes: c.notes,
      };
      const content = P.newProjectFile(p, date);
      check(content, `projects/${id}.md`);
      files[`projects/${id}.md`] = content;
      tickers.add(ticker);
      titles.push(`+${ticker}`);
      html.push(`🆕 <b>${h(ticker)} · ${h(p.name)}</b>  <i>${h(p.status)} · P${p.priority} · ${h(p.category)}</i>`, `🏁 ${h(p.finish_line)}`);
      plain.push(`New project ${ticker} · ${p.name}`);
      p.tasks.forEach((t, i) => html.push(`➕ ${ticker}-${i + 1} ${h(t)}`));
      html.push("");
      continue;
    }

    const proj = resolveRef(c.project, index) ?? (await byId(c.project, readFile));
    if (!proj) throw new ProposalError(`No project matches "${c.project}". Use a ticker from the project list.`);
    const path = `projects/${proj.id}.md`;
    const current = files[path] !== undefined ? files[path] : await readFile(path);
    if (current === null) throw new ProposalError(`${proj.ticker} has no file in the repo (it may have been sunset).`);

    if (action === "sunset") {
      files[path] = null;
      sunsets.push({ path, filename: `${proj.id}.md`, content: current, name: proj.name });
      titles.push(`sunset ${proj.ticker}`);
      html.push(`🗄 <b>${h(proj.ticker)} · ${h(proj.name)}</b> — sunset`, `Removed from the repo. I'll send you the file for your local archive.`);
      if (c.reason) html.push(`Reason: ${h(c.reason)}`);
      html.push("");
      plain.push(`Sunset ${proj.ticker}${c.reason ? `: ${c.reason}` : ""}`);
      continue;
    }

    if (action !== "update") throw new ProposalError(`Unknown action "${action}".`);
    let src = current;
    const { fm } = P.parseProject(src, path);
    const lines = [];
    const autoLog = [];
    try {
      for (const id of c.reopen_tasks ?? []) {
        src = P.reopenTask(src, norm(id, fm.ticker));
        lines.push(`↩️ ${h(norm(id, fm.ticker))} reopened`);
      }
      for (const id of c.complete_tasks ?? []) {
        const tid = norm(id, fm.ticker);
        const text = P.tasksOf(P.parseProject(src, path).body).find((t) => t.id === tid)?.text;
        src = P.completeTask(src, tid, date);
        lines.push(`✅ ${h(tid)} ${h(text ?? "")}`);
        autoLog.push(`${tid} ${text ?? ""}`.trim());
      }
      for (const e of c.edit_tasks ?? []) {
        const tid = norm(e.id, fm.ticker);
        src = P.editTask(src, tid, e.text);
        lines.push(`✏️ ${h(tid)} → ${h(e.text)}`);
      }
      for (const t of c.add_tasks ?? []) {
        const r = P.addTask(src, fm.ticker, t);
        src = r.src;
        lines.push(`➕ ${h(r.id)} ${h(t)}`);
      }
    } catch (e) {
      throw new ProposalError(`${fm.ticker}: ${e.message}. Call get_project to see the current task IDs.`);
    }
    for (const [k, v] of Object.entries(c.set ?? {})) {
      if (!SETTABLE.includes(k)) throw new ProposalError(`Field "${k}" can't be changed from Telegram (allowed: ${SETTABLE.join(", ")}).`);
      const before = fm[k] ?? "—";
      src = P.setField(src, k, v);
      lines.push(`⚙️ ${h(k)}: ${h(before)} → ${h(v === null || v === "" ? "—" : v)}`);
      if (k === "status") autoLog.push(`Status ${before} → ${v}`);
    }
    const logText = c.log ? P.oneLine(c.log) : autoLog.length ? `Done: ${autoLog.join("; ")}` : null;
    if (logText) {
      src = P.addLog(src, date, logText);
      lines.push(`📝 ${h(logText)}`);
    }
    if (!lines.length) throw new ProposalError(`No actual change for ${fm.ticker}.`);
    src = P.setField(src, "updated", date);
    check(src, path);
    files[path] = src;
    titles.push(fm.ticker);
    html.push(`<b>${h(fm.ticker)} · ${h(fm.name)}</b>`, ...lines, "");
    plain.push(`${fm.ticker}: ${lines.length} change(s)`);
  }

  return { files, html: html.join("\n").trim(), plain: plain.join("\n"), title: `bot: ${titles.join(", ")}`, sunsets };
}

function norm(id, ticker) {
  const s = String(id).trim().toUpperCase();
  return /^\d+$/.test(s) ? `${ticker}-${s}` : s;
}

async function byId(ref, readFile) {
  const id = String(ref ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const src = await readFile(`projects/${id}.md`);
  if (!src) return null;
  const { fm } = P.parseProject(src, id);
  return { id: fm.id, ticker: fm.ticker, name: fm.name };
}

function check(src, path) {
  const { fm, body } = P.parseProject(src, path);
  const errs = P.validateProject(fm, body, path);
  if (errs.length) throw new ProposalError(`${path} would be invalid: ${errs.join("; ")}`);
}
