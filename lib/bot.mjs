// Bot core: everything the webhook does, with its dependencies injected so it can be tested offline.

import { runAgent } from "./agent.mjs";
import { rankFocus } from "./focus.mjs";
import { buildProposal, ProposalError, resolveRef } from "./proposal.mjs";
import * as P from "./project.mjs";
import { escapeHtml as h } from "./telegram.mjs";

const PENDING_TTL_MS = 30 * 60e3;

const INBOX = {
  edge: { path: "inbox/the-edge-inbox.md", tag: "EDGE" },
  idea: { path: "inbox/projects-inbox.md", tag: "IDEA" },
  project: { path: "inbox/projects-inbox.md", tag: "PROJECT" },
  note: { path: "inbox/inbox.md", tag: "INBOX" },
};

const HELP = `ThabaniOS bot

Ask anything:
• what should I focus on?
• what's next on Leola?
• LEO: shopify done. next is payment gateway and klaviyo
• pause vending / sunset AGV / new project: …

Every change shows a preview with Confirm, Edit and Cancel. After saving you get an Undo button.

Shortcuts (no AI, instant):
/focus — top 5 next tasks
/p LEO — one project
/list — all projects
edge: / idea: / project: / note: … — capture to the inbox`;

export function createBot({ gh, tg, allowedChatId, apiKey, model = "claude-haiku-5-5", now = () => new Date(), fetchImpl = fetch, newId }) {
  const makeId = newId ?? (() => Math.random().toString(36).slice(2, 12));
  const allowed = (id) => id !== undefined && String(id) === String(allowedChatId);

  function context() {
    const cache = new Map();
    const readFile = async (path) => {
      if (!cache.has(path)) cache.set(path, (await gh.getFile(path))?.content ?? null);
      return cache.get(path);
    };
    const index = async () => JSON.parse((await readFile("status.json")) ?? '{"projects":[]}').projects;
    return { readFile, index, date: P.sastDate(now()) };
  }

  async function capture(kind, text) {
    const target = INBOX[kind];
    if (!target) throw new Error(`unknown inbox "${kind}"`);
    const cur = (await gh.getFile(target.path))?.content ?? "";
    const entry = `${cur.endsWith("\n") || !cur ? "" : "\n"}\n---\n**[${target.tag}]** ${P.sastStamp(now())}\n${text.trim()}\n`;
    await gh.commitFiles({ [target.path]: cur + entry }, `capture: ${kind}`);
    return `Saved to ${target.path}`;
  }

  // ---------- rendering for shortcuts ----------

  function renderFocus(index, date) {
    const items = rankFocus(index, date, 5);
    if (!items.length) return "Nothing open on active projects. 🎉";
    return [
      "<b>🎯 Focus</b>",
      ...items.map((f, i) =>
        [`\n${i + 1}. <b>${h(f.ticker)}</b> ${h(f.name)}  <i>${h(f.reasons.join(" · "))}</i>`, ...f.next.map((t) => `   • ${h(t.id)} ${h(t.text)}`)].join("\n"),
      ),
    ].join("\n");
  }

  async function renderProject(ref, ctx) {
    const index = await ctx.index();
    const p = resolveRef(ref, index);
    if (!p) return `No project matches "${h(ref)}". Try /list.`;
    const src = await ctx.readFile(`projects/${p.id}.md`);
    if (!src) return `${h(p.ticker)} has no file in the repo.`;
    const { fm, body } = P.parseProject(src, p.id);
    const open = P.tasksOf(body).filter((t) => !t.done);
    const log = P.logOf(body).slice(-3);
    return [
      `<b>${h(fm.ticker)} · ${h(fm.name)}</b>`,
      `<i>${h(fm.status)} · P${fm.priority}${fm.deadline ? ` · due ${h(fm.deadline)}` : ""}${fm.client ? ` · ${h(fm.client)}` : ""}</i>`,
      `🏁 ${h(fm.finish_line)}`,
      "",
      open.length ? open.map((t) => `☐ ${h(t.id)} ${h(t.text)}`).join("\n") : "No open tasks.",
      ...(log.length ? ["", "<b>Recent</b>", ...log.map((l) => `• ${h(l)}`)] : []),
    ].join("\n");
  }

  function renderList(index) {
    const groups = ["active", "pipeline", "live", "paused"];
    return groups
      .map((g) => {
        const ps = index.filter((p) => p.status === g);
        if (!ps.length) return null;
        return [`<b>${g[0].toUpperCase() + g.slice(1)}</b>`, ...ps.map((p) => `${h(p.ticker)} · ${h(p.name)} <i>(P${p.priority}, ${p.open_tasks.length} open)</i>`)].join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }

  // ---------- messages ----------

  async function onMessage(msg) {
    const chat = msg.chat.id;
    const text = (msg.text ?? "").trim();
    if (!text) return tg.send(chat, "Text messages only for now.");
    const ctx = context();

    const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    if (cmd) {
      const [, name, arg] = cmd;
      if (name === "start" || name === "help") return tg.send(chat, HELP);
      if (name === "focus") return tg.send(chat, renderFocus(await ctx.index(), ctx.date), { html: true });
      if (name === "list") return tg.send(chat, renderList(await ctx.index()), { html: true });
      if (name === "p" || name === "project") return tg.send(chat, arg ? await renderProject(arg, ctx) : "Usage: /p LEO", { html: !!arg });
    }

    const cap = text.match(/^(edge|idea|project|note)\s*:\s*([\s\S]+)$/i);
    if (cap) {
      const where = await capture(cap[1].toLowerCase(), cap[2]);
      return tg.send(chat, `📥 ${where}`, { replyTo: msg.message_id });
    }

    await tg.typing(chat);
    const index = await ctx.index();
    const result = await runAgent({
      text,
      replyContext: msg.reply_to_message?.text,
      index,
      date: ctx.date,
      readFile: ctx.readFile,
      capture,
      apiKey,
      model,
      fetchImpl,
    });

    if (result.kind === "text") return tg.send(chat, result.text, { replyTo: msg.message_id });

    const id = makeId();
    await gh.putState(id, { id, created: now().toISOString(), chat_id: chat, text, changes: result.changes });
    return tg.send(chat, `<b>Proposed</b>\n\n${result.proposal.html}`, {
      html: true,
      replyTo: msg.message_id,
      buttons: [[["✅ Confirm", `c:${id}`], ["✏️ Edit", `e:${id}`], ["✖️ Cancel", `x:${id}`]]],
    });
  }

  // ---------- buttons ----------

  async function onCallback(cq) {
    const chat = cq.message?.chat.id;
    const mid = cq.message?.message_id;
    const shown = cq.message?.text ?? "";
    const [op, arg] = String(cq.data ?? "").split(":");

    if (op === "u") return undo(cq, arg, chat, mid, shown);

    const st = await gh.getState(arg);
    if (!st) {
      await tg.edit(chat, mid, `${shown}\n\n(Already handled or expired.)`);
      return tg.answer(cq.id, "Already handled");
    }
    const clear = () => gh.deleteState(arg, st.sha).catch(() => {});

    if (op === "x") {
      await clear();
      await tg.edit(chat, mid, `${shown}\n\n✖️ Cancelled.`);
      return tg.answer(cq.id, "Cancelled");
    }
    if (op === "e") {
      await clear();
      await tg.edit(chat, mid, `${shown}\n\n✏️ Not saved. Reply to this message with what to change and I'll redo it.`);
      return tg.answer(cq.id);
    }
    if (op !== "c") return tg.answer(cq.id, "Unknown button");

    if (now() - Date.parse(st.data.created) > PENDING_TTL_MS) {
      await clear();
      await tg.edit(chat, mid, `${shown}\n\n⌛ Expired (older than 30 min). Send it again.`);
      return tg.answer(cq.id, "Expired");
    }

    const ctx = context();
    let proposal;
    try {
      // Rebuilt against the current files, so anything changed since the preview is respected.
      proposal = await buildProposal(st.data.changes, { readFile: ctx.readFile, index: await ctx.index(), date: ctx.date });
    } catch (e) {
      if (!(e instanceof ProposalError)) throw e;
      await clear();
      await tg.edit(chat, mid, `${shown}\n\n⚠️ Couldn't save: ${e.message}`);
      return tg.answer(cq.id, "Not saved");
    }
    const commit = await gh.commitFiles(proposal.files, `${proposal.title}\n\nFrom Telegram: ${st.data.text}`);
    await clear();
    await tg.edit(chat, mid, `${proposal.html}\n\n✅ Saved · <a href="${commit.url}">${commit.sha.slice(0, 7)}</a>`, {
      html: true,
      buttons: [[["↩️ Undo", `u:${commit.sha}`]]],
    });
    for (const s of proposal.sunsets) {
      await tg.sendDocument(chat, s.filename, s.content, `🗄 ${s.name} — save this into ThabaniOS/archive/`);
    }
    return tg.answer(cq.id, "Saved");
  }

  async function undo(cq, sha, chat, mid, shown) {
    if (!/^[0-9a-f]{40}$/.test(sha ?? "")) return tg.answer(cq.id, "Bad undo reference");
    const c = await gh.getCommit(sha);
    if (!c.message.startsWith("bot:") || c.message.startsWith("bot: undo")) return tg.answer(cq.id, "Can only undo bot changes");
    const restore = {};
    for (const f of c.files) {
      const cur = await gh.getFile(f.path);
      const unchanged = f.status === "removed" ? cur === null : cur?.sha === f.sha;
      if (!unchanged) {
        await tg.edit(chat, mid, `${shown}\n\n⚠️ Can't undo: ${f.path} has changed since. Fix it by message instead.`);
        return tg.answer(cq.id, "Changed since");
      }
      restore[f.path] = f.status === "added" ? null : (await gh.getFile(f.path, c.parent)).content;
    }
    const r = await gh.commitFiles(restore, `bot: undo ${sha.slice(0, 7)}`);
    await tg.edit(chat, mid, `${shown}\n\n↩️ Undone (${r.sha.slice(0, 7)}).`);
    return tg.answer(cq.id, "Undone");
  }

  // ---------- entry point ----------

  async function handleUpdate(update) {
    const msg = update.message ?? update.edited_message;
    const cq = update.callback_query;
    const chat = msg?.chat.id ?? cq?.message?.chat.id;
    if (!allowed(chat) || (cq && !allowed(cq.from?.id))) return { ignored: true };
    try {
      if (cq) return await onCallback(cq);
      if (update.message) return await onMessage(msg);
      return { ignored: true };
    } catch (e) {
      console.error(e);
      if (cq) await tg.answer(cq.id, "Something went wrong").catch(() => {});
      await tg.send(chat, `⚠️ ${e.message}`).catch(() => {});
      return { error: e.message };
    }
  }

  return { handleUpdate, capture };
}
