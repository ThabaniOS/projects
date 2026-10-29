// The Claude tool loop behind free-text Telegram messages.
// Read tools run immediately. propose_changes is a dry run: if it validates, the loop stops and
// the handler shows the diff with Confirm / Edit / Cancel. Nothing is written until Confirm.

import { rankFocus } from "./focus.mjs";
import { buildProposal, ProposalError } from "./proposal.mjs";

const SYSTEM = `You are ThabaniOS, Thabani's project assistant on Telegram. Thabani runs client and venture projects; each project is a markdown file in a GitHub repo with a ticker (e.g. LEO), tasks with IDs (e.g. LEO-3), a finish line, a log and notes.

What you do:
- Answer questions about projects and what to work on next. For "what should I focus on" style questions call get_focus and explain the top items in a few short lines.
- Turn status updates into changes with propose_changes. Thabani confirms every change in Telegram before it is saved, so propose confidently; don't ask "shall I?".
- Capture loose notes or ideas with capture when he clearly just wants something noted (not a project change).

Rules:
- Resolve projects from the project index below by ticker, name or obvious nickname ("leola" = LEO). If it's genuinely ambiguous, ask one short question.
- Before completing, reopening or editing tasks, call get_project to see the real task IDs and wording, then match what Thabani said to the right task. Never invent IDs.
- Put every change from one message into a single propose_changes call (it can cover several projects).
- New tasks: short imperative phrases ("Set up payment gateway"). Keep his wording where it's clear.
- Only add a log line when there's information beyond the task ticks (completed tasks are logged automatically).
- To retire a project use action "sunset"; to park it, set status to "paused". Status values: active, pipeline, live, paused.
- New projects need: id (kebab-case), ticker (2–4 capital letters, unused), name, category (raiis, mb-digital, client-direct, venture, personal), priority (1 = now, 2 = this month, 3 = when there's room), finish_line, and usually 1–5 starting tasks.
- If propose_changes returns an error, fix the request and call it again.
- Replies are plain text for Telegram: short, no markdown, no headings, no bold. Use line breaks and task IDs.`;

const TOOLS = [
  {
    name: "get_project",
    description: "Full markdown file for one project: frontmatter, all tasks with IDs, log and notes.",
    input_schema: {
      type: "object",
      properties: { project: { type: "string", description: "Ticker, id or name" } },
      required: ["project"],
    },
  },
  {
    name: "get_focus",
    description: "Ranked list of what to work on next across active and pipeline projects (priority, deadlines, staleness), with each project's next open tasks.",
    input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10 } } },
  },
  {
    name: "propose_changes",
    description:
      "Propose changes to project files. Validated as a dry run, then shown to Thabani with Confirm/Edit/Cancel buttons. Nothing is saved until he confirms.",
    input_schema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["update", "create", "sunset"] },
              project: { type: "string", description: "Ticker or id of an existing project (update, sunset)" },
              complete_tasks: { type: "array", items: { type: "string" }, description: "Task IDs to tick off" },
              reopen_tasks: { type: "array", items: { type: "string" } },
              add_tasks: { type: "array", items: { type: "string" }, description: "New task texts; IDs are assigned automatically" },
              edit_tasks: {
                type: "array",
                items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] },
              },
              set: {
                type: "object",
                description: "Frontmatter changes. Use null for deadline to clear it.",
                properties: {
                  name: { type: "string" },
                  status: { type: "string", enum: ["active", "pipeline", "live", "paused"] },
                  category: { type: "string", enum: ["raiis", "mb-digital", "client-direct", "venture", "personal"] },
                  client: { type: "string" },
                  priority: { type: "integer", enum: [1, 2, 3] },
                  finish_line: { type: "string" },
                  deadline: { type: ["string", "null"], description: "YYYY-MM-DD" },
                },
              },
              log: { type: "string", description: "Optional log line (date is added automatically)" },
              id: { type: "string", description: "create: kebab-case id" },
              ticker: { type: "string", description: "create: 2–4 capital letters" },
              name: { type: "string", description: "create" },
              status: { type: "string", enum: ["active", "pipeline", "live", "paused"], description: "create" },
              category: { type: "string", enum: ["raiis", "mb-digital", "client-direct", "venture", "personal"], description: "create" },
              client: { type: "string", description: "create" },
              priority: { type: "integer", enum: [1, 2, 3], description: "create" },
              finish_line: { type: "string", description: "create" },
              deadline: { type: "string", description: "create: YYYY-MM-DD" },
              tasks: { type: "array", items: { type: "string" }, description: "create: starting tasks" },
              notes: { type: "string", description: "create" },
              reason: { type: "string", description: "sunset: why" },
            },
            required: ["action"],
          },
        },
      },
      required: ["changes"],
    },
  },
  {
    name: "capture",
    description: "Save a loose note to an inbox file without touching any project. edge = personal philosophy/voice, idea = new idea, project = project thought, note = anything else.",
    input_schema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["edge", "idea", "project", "note"] }, text: { type: "string" } },
      required: ["kind", "text"],
    },
    cache_control: { type: "ephemeral" },
  },
];

function indexText(index) {
  return index
    .map((p) => `${p.ticker} | ${p.id} | ${p.name} | ${p.status} | P${p.priority} | ${p.open_tasks.length} open${p.deadline ? ` | due ${p.deadline}` : ""}`)
    .join("\n");
}

async function callClaude({ apiKey, model, system, messages, fetchImpl }) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1500, system, tools: TOOLS, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${data.error?.message ?? res.statusText}`);
  return data;
}

/**
 * Returns one of:
 *   { kind: "text", text }
 *   { kind: "proposal", changes, proposal }
 */
export async function runAgent({ text, replyContext, index, date, readFile, capture, apiKey, model, fetchImpl = fetch, maxTurns = 6 }) {
  const system = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Today is ${date} (Johannesburg).\n\nProject index (ticker | id | name | status | priority | open tasks | deadline):\n${indexText(index)}` },
  ];
  const content = replyContext ? `(Replying to your earlier message:\n${replyContext}\n)\n\n${text}` : text;
  const messages = [{ role: "user", content }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await callClaude({ apiKey, model, system, messages, fetchImpl });
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    const said = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!uses.length) return { kind: "text", text: said || "Done." };

    const results = [];
    for (const u of uses) {
      try {
        if (u.name === "propose_changes") {
          const proposal = await buildProposal(u.input.changes, { readFile, index, date });
          return { kind: "proposal", changes: u.input.changes, proposal };
        }
        let out;
        if (u.name === "get_project") {
          const p = index.find((x) => [x.ticker.toLowerCase(), x.id].includes(String(u.input.project).toLowerCase())) ??
            index.find((x) => x.name.toLowerCase().includes(String(u.input.project).toLowerCase()));
          const src = await readFile(`projects/${p?.id ?? String(u.input.project).toLowerCase()}.md`);
          out = src ?? `No project file for "${u.input.project}".`;
        } else if (u.name === "get_focus") {
          out = JSON.stringify(rankFocus(index, date, u.input.limit ?? 5));
        } else if (u.name === "capture") {
          out = await capture(u.input.kind, u.input.text);
        } else {
          out = `Unknown tool ${u.name}`;
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      } catch (e) {
        const msg = e instanceof ProposalError ? e.message : `Error: ${e.message}`;
        results.push({ type: "tool_result", tool_use_id: u.id, content: msg, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { kind: "text", text: "I couldn't finish that one. Try rephrasing, or use a ticker." };
}
