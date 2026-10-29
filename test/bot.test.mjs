import { test } from "node:test";
import assert from "node:assert/strict";
import { createBot } from "../lib/bot.mjs";
import { createGitHub } from "../lib/github.mjs";
import { createTelegram } from "../lib/telegram.mjs";
import { parseProject, validateProject, tasksOf } from "../lib/project.mjs";
import { fakeGitHub, fakeTelegram, fakeClaude, seedFromRepo, toolUse, say } from "./fakes.mjs";

const CHAT = 4242;

function setup(script = [], { start = new Date("2026-10-29T20:00:00Z") } = {}) {
  const gh = fakeGitHub(seedFromRepo());
  const tg = fakeTelegram();
  const claude = fakeClaude(script);
  const clock = { t: start };
  let ids = 0;
  const bot = createBot({
    gh: createGitHub({ token: "t", owner: "ThabaniOS", repo: "projects", fetchImpl: gh.fetchImpl }),
    tg: createTelegram({ token: "x", fetchImpl: tg.fetchImpl }),
    allowedChatId: String(CHAT),
    apiKey: "k",
    now: () => clock.t,
    fetchImpl: claude.fetchImpl,
    newId: () => `p${++ids}`,
  });
  const say_ = (text, extra = {}) => bot.handleUpdate({ message: { message_id: 1, chat: { id: CHAT }, text, ...extra } });
  const press = (data) => {
    const msg = tg.last("sendMessage");
    return bot.handleUpdate({ callback_query: { id: "cb", data, from: { id: CHAT }, message: { message_id: 101, chat: { id: CHAT }, text: msg?.text ?? "" } } });
  };
  return { gh, tg, claude, bot, clock, say: say_, press };
}

const valid = (src, path) => {
  const { fm, body } = parseProject(src, path);
  return validateProject(fm, body, path);
};

test("ignores anyone who isn't Thabani", async () => {
  const s = setup();
  const r = await s.bot.handleUpdate({ message: { message_id: 1, chat: { id: 999 }, text: "/focus" } });
  assert.deepEqual(r, { ignored: true });
  assert.equal(s.tg.calls.length, 0);
});

test("/focus ranks P1 work first, no AI call", async () => {
  const s = setup();
  await s.say("/focus");
  const out = s.tg.last("sendMessage");
  assert.equal(out.parse_mode, "HTML");
  assert.match(out.text, /Focus/);
  assert.match(out.text, /1\. <b>/);
  assert.equal(s.claude.requests.length, 0);
});

test("/p leola shows open tasks; /list groups by status", async () => {
  const s = setup();
  await s.say("/p leola");
  assert.match(s.tg.last("sendMessage").text, /LEO · Leola Atelier[\s\S]*LEO-1 Finish Shopify store setup/);
  await s.say("/list");
  assert.match(s.tg.last("sendMessage").text, /<b>Active<\/b>[\s\S]*<b>Paused<\/b>/);
});

test("prefix capture appends to the inbox in the old format", async () => {
  const s = setup();
  await s.say("idea: vending + skubu combo");
  const inbox = s.gh.file("inbox/projects-inbox.md");
  assert.match(inbox, /\n---\n\*\*\[IDEA\]\*\* 2026-10-29 22:00\nvending \+ skubu combo\n$/);
  assert.equal(s.gh.log()[0], "capture: idea");
});

test("update flow: propose → nothing written → confirm → commit → undo", async () => {
  const s = setup([
    [toolUse("get_project", { project: "LEO" })],
    [
      toolUse("propose_changes", {
        changes: [{ action: "update", project: "LEO", complete_tasks: ["LEO-1"], add_tasks: ["Set up payment gateway on Shopify", "Start Klaviyo account"] }],
      }),
    ],
  ]);
  const before = s.gh.file("projects/leola.md");
  const head = s.gh.head();
  await s.say("LEO: shopify done. next is payment gateway and starting a klaviyo account");

  // The model saw the real file before proposing.
  assert.match(JSON.stringify(s.claude.requests[1].messages), /LEO-1 Finish Shopify store setup/);
  // Preview shown with buttons; master untouched; pending saved on bot-state.
  const preview = s.tg.last("sendMessage");
  assert.match(preview.text, /✅ LEO-1 Finish Shopify store setup/);
  assert.match(preview.text, /➕ LEO-6 Set up payment gateway on Shopify/);
  assert.match(preview.text, /➕ LEO-7 Start Klaviyo account/);
  assert.deepEqual(preview.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["c:p1", "e:p1", "x:p1"]);
  assert.equal(s.gh.head(), head);
  assert.ok(s.gh.file("state/p1.json", "bot-state"));

  await s.press("c:p1");
  const after = s.gh.file("projects/leola.md");
  assert.notEqual(after, before);
  assert.deepEqual(valid(after, "projects/leola.md"), []);
  assert.match(after, /- \[x\] LEO-1 Finish Shopify store setup \(done 2026-10-29\)/);
  assert.match(after, /- 2026-10-29: Done: LEO-1 Finish Shopify store setup/);
  assert.match(after, /^updated: 2026-10-29$/m);
  assert.match(s.gh.log()[0], /^bot: LEO/);
  assert.equal(s.gh.file("state/p1.json", "bot-state"), undefined, "pending cleared");
  const saved = s.tg.last("editMessageText");
  assert.match(saved.text, /✅ Saved/);
  const undo = saved.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(undo, /^u:[0-9a-f]{40}$/);

  // Second confirm on the same proposal does nothing.
  await s.press("c:p1");
  assert.match(s.tg.last("editMessageText").text, /Already handled/);

  await s.press(undo);
  assert.equal(s.gh.file("projects/leola.md"), before);
  assert.match(s.gh.log()[0], /^bot: undo/);
});

test("model gets a validation error back and corrects itself", async () => {
  const s = setup([
    [toolUse("propose_changes", { changes: [{ action: "update", project: "HOD", complete_tasks: ["HOD-99"] }] })],
    (req) => {
      const last = req.messages.at(-1).content[0];
      assert.equal(last.is_error, true);
      assert.match(last.content, /HOD-99 not found/);
      return [toolUse("propose_changes", { changes: [{ action: "update", project: "HOD", complete_tasks: ["2"] }] })];
    },
  ]);
  await s.say("hod: rapaport unblocked with thanyani");
  assert.match(s.tg.last("sendMessage").text, /✅ HOD-2 Unblock the Rapaport work/);
});

test("cancel and edit write nothing", async () => {
  const s = setup([
    [toolUse("propose_changes", { changes: [{ action: "update", project: "VND", set: { status: "active" } }] })],
    [toolUse("propose_changes", { changes: [{ action: "update", project: "VND", set: { priority: 2 } }] })],
  ]);
  const head = s.gh.head();
  await s.say("unpause vending");
  await s.press("x:p1");
  assert.match(s.tg.last("editMessageText").text, /Cancelled/);
  await s.say("vending priority 2");
  await s.press("e:p2");
  assert.match(s.tg.last("editMessageText").text, /Reply to this message/);
  assert.equal(s.gh.head(), head);
});

test("stale proposal: confirm re-checks against the current file", async () => {
  const s = setup([[toolUse("propose_changes", { changes: [{ action: "update", project: "OPT", complete_tasks: ["OPT-1"] }] })]]);
  await s.say("opticien mailchimp is back up");
  // Meanwhile the task gets ticked some other way.
  s.gh.setFile("projects/opticien.md", s.gh.file("projects/opticien.md").replace("- [ ] OPT-1", "- [x] OPT-1"));
  const head = s.gh.head();
  await s.press("c:p1");
  assert.match(s.tg.last("editMessageText").text, /Couldn't save: .*already done/);
  assert.equal(s.gh.head(), head);
});

test("proposals expire after 30 minutes", async () => {
  const s = setup([[toolUse("propose_changes", { changes: [{ action: "update", project: "GK", log: "Call with partner" }] })]]);
  await s.say("gk: had a call with the partner");
  s.clock.t = new Date(s.clock.t.getTime() + 31 * 60e3);
  await s.press("c:p1");
  assert.match(s.tg.last("editMessageText").text, /Expired/);
});

test("create a project and sunset another in one change", async () => {
  const s = setup([
    [
      toolUse("propose_changes", {
        changes: [
          { action: "create", id: "besos-website", ticker: "BES", name: "Besos Website", category: "client-direct", priority: 3, finish_line: "Site handed over and maintained", tasks: ["Get hosting access"] },
          { action: "sunset", project: "AGV", reason: "Nicholas went quiet" },
        ],
      }),
    ],
  ]);
  await s.say("new project besos website, and sunset angovast");
  assert.match(s.tg.last("sendMessage").text, /🆕 <b>BES · Besos Website/);
  await s.press("c:p1");
  const created = s.gh.file("projects/besos-website.md");
  assert.deepEqual(valid(created, "projects/besos-website.md"), []);
  assert.equal(s.gh.file("projects/angovast.md"), undefined);
  const doc = s.tg.last("sendDocument");
  assert.match(doc.document_text, /ticker: AGV/);
});

test("ticker clash is rejected before anything is shown", async () => {
  const s = setup([
    [toolUse("propose_changes", { changes: [{ action: "create", id: "leo-two", ticker: "LEO", name: "X", category: "personal", priority: 3, finish_line: "x" }] })],
    [say("LEO is taken, use another ticker?")],
  ]);
  await s.say("new project leo two");
  assert.match(s.claude.requests[1].messages.at(-1).content[0].content, /already taken/);
  assert.match(s.tg.last("sendMessage").text, /taken/);
});

test("undo refuses if the file changed after the bot's commit", async () => {
  const s = setup([[toolUse("propose_changes", { changes: [{ action: "update", project: "ORI", add_tasks: ["Ask Nic for access"] }] })]]);
  await s.say("origami: ask nic for access");
  await s.press("c:p1");
  const undo = s.tg.last("editMessageText").reply_markup.inline_keyboard[0][0].callback_data;
  s.gh.setFile("projects/origami.md", s.gh.file("projects/origami.md") + "\nmanual note\n");
  await s.press(undo);
  assert.match(s.tg.last("editMessageText").text, /Can't undo/);
});

test("plain questions get a plain answer with the focus tool available", async () => {
  const s = setup([
    [toolUse("get_focus", { limit: 3 })],
    (req) => {
      const focus = JSON.parse(req.messages.at(-1).content[0].content);
      assert.equal(focus.length, 3);
      assert.ok(focus.every((f) => f.next.length));
      return [say(`Start with ${focus[0].ticker}.`)];
    },
  ]);
  await s.say("what should I focus on today?");
  assert.match(s.tg.last("sendMessage").text, /^Start with [A-Z]+\.$/);
  // System prompt carries the date and the project index; the big static part is cached.
  const sys = s.claude.requests[0].system;
  assert.ok(sys[0].cache_control);
  assert.match(sys[1].text, /Today is 2026-10-29/);
  assert.match(sys[1].text, /LEO \| leola \| Leola Atelier/);
});

test("Claude API failure is reported to the chat, not swallowed", async () => {
  const s = setup([]); // exhausted script → 500
  await s.say("hello");
  assert.match(s.tg.last("sendMessage").text, /⚠️ Claude API 500/);
});

test("every live project file validates", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../projects/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const path = `projects/${f}`;
    const src = readFileSync(new URL(f, dir), "utf8");
    if (!path.startsWith("projects/")) continue;
    assert.deepEqual(valid(src, path), [], path);
    assert.ok(Array.isArray(tasksOf(parseProject(src, path).body)));
  }
});
