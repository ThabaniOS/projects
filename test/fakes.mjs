// In-memory fakes of the GitHub, Telegram and Anthropic HTTP APIs, so the real clients are exercised offline.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const blobSha = (s) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function seedFromRepo() {
  // Frozen snapshot, so live project edits (e.g. ticking LEO-1 from Telegram) never break the suite.
  const root = fileURLToPath(new URL("./fixtures/", import.meta.url));
  const tree = {};
  for (const f of readdirSync(`${root}projects`)) tree[`projects/${f}`] = readFileSync(`${root}projects/${f}`, "utf8");
  for (const f of readdirSync(`${root}inbox`)) tree[`inbox/${f}`] = readFileSync(`${root}inbox/${f}`, "utf8");
  tree["status.json"] = readFileSync(`${root}status.json`, "utf8");
  return tree;
}

export function fakeGitHub(initialTree) {
  let n = 0;
  const commits = new Map(); // sha -> { tree, parent, message }
  const trees = new Map(); // sha -> tree object
  const branches = new Map();
  const newSha = (p) => createHash("sha1").update(`${p}${++n}`).digest("hex");
  const root = newSha("c");
  commits.set(root, { tree: { ...initialTree }, parent: null, message: "init" });
  branches.set("master", root);

  const treeAt = (ref) => {
    const sha = branches.get(ref) ?? ref;
    return commits.get(sha)?.tree ?? null;
  };
  function commit(ref, tree, message) {
    const sha = newSha("c");
    commits.set(sha, { tree, parent: branches.get(ref), message });
    branches.set(ref, sha);
    return sha;
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ""));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    let m;

    if ((m = path.match(/^\/contents\/(.+)$/))) {
      const ref = u.searchParams.get("ref") ?? body?.branch ?? "master";
      const t = treeAt(ref);
      if (method === "GET") {
        if (!t || t[m[1]] === undefined) return json(404, { message: "Not Found" });
        return json(200, { content: Buffer.from(t[m[1]]).toString("base64"), sha: blobSha(t[m[1]]) });
      }
      if (!branches.has(body.branch)) return json(404, { message: "Branch not found" });
      const next = { ...treeAt(body.branch) };
      if (method === "PUT") next[m[1]] = Buffer.from(body.content, "base64").toString("utf8");
      if (method === "DELETE") {
        if (blobSha(next[m[1]] ?? "") !== body.sha) return json(409, { message: "sha mismatch" });
        delete next[m[1]];
      }
      commit(body.branch, next, body.message);
      return json(200, { content: { sha: next[m[1]] ? blobSha(next[m[1]]) : null } });
    }
    if ((m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      return branches.has(m[1]) ? json(200, { object: { sha: branches.get(m[1]) } }) : json(404, { message: "Not Found" });
    }
    if (path === "/git/refs" && method === "POST") {
      branches.set(body.ref.replace("refs/heads/", ""), body.sha);
      return json(201, {});
    }
    if ((m = path.match(/^\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") {
      const c = commits.get(body.sha);
      if (c.parent !== branches.get(m[1]) && !body.force) return json(422, { message: "Update is not a fast forward" });
      branches.set(m[1], body.sha);
      return json(200, {});
    }
    if ((m = path.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      return json(200, { sha: m[1], tree: { sha: `tree-of-${m[1]}` } });
    }
    if (path === "/git/trees" && method === "POST") {
      const base = { ...commits.get(body.base_tree.replace("tree-of-", "")).tree };
      for (const e of body.tree) e.sha === null ? delete base[e.path] : (base[e.path] = e.content);
      const sha = newSha("t");
      trees.set(sha, base);
      return json(201, { sha });
    }
    if (path === "/git/commits" && method === "POST") {
      const sha = newSha("c");
      commits.set(sha, { tree: trees.get(body.tree), parent: body.parents[0], message: body.message });
      return json(201, { sha });
    }
    if ((m = path.match(/^\/commits\/([0-9a-f]+)$/))) {
      const c = commits.get(m[1]);
      const before = commits.get(c.parent)?.tree ?? {};
      const files = [];
      for (const p of new Set([...Object.keys(before), ...Object.keys(c.tree)])) {
        if (before[p] === c.tree[p]) continue;
        const status = before[p] === undefined ? "added" : c.tree[p] === undefined ? "removed" : "modified";
        files.push({ filename: p, status, sha: blobSha(c.tree[p] ?? before[p]) });
      }
      return json(200, { sha: m[1], commit: { message: c.message }, parents: c.parent ? [{ sha: c.parent }] : [], files });
    }
    return json(500, { message: `fake GitHub: unhandled ${method} ${path}` });
  }

  return {
    fetchImpl,
    file: (path, ref = "master") => treeAt(ref)?.[path],
    setFile(path, content, message = "manual edit") {
      const next = { ...treeAt("master") };
      content === null ? delete next[path] : (next[path] = content);
      commit("master", next, message);
    },
    head: (ref = "master") => branches.get(ref),
    log: (ref = "master") => {
      const out = [];
      for (let s = branches.get(ref); s; s = commits.get(s).parent) out.push(commits.get(s).message.split("\n")[0]);
      return out;
    },
    branches,
  };
}

export function fakeTelegram() {
  const calls = [];
  let mid = 100;
  async function fetchImpl(url, init) {
    const method = url.split("/").pop();
    let payload;
    if (init.body instanceof FormData) {
      payload = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `<file ${v.name ?? "blob"} ${v.size}b>`]));
      payload.document_text = await init.body.get("document").text();
    } else payload = JSON.parse(init.body);
    calls.push({ method, payload });
    return json(200, { ok: true, result: method === "sendMessage" ? { message_id: ++mid } : true });
  }
  return { fetchImpl, calls, last: (method) => [...calls].reverse().find((c) => !method || c.method === method)?.payload };
}

/** Scripted Claude: each call returns the next response; requests are recorded. */
export function fakeClaude(script) {
  const requests = [];
  async function fetchImpl(url, init) {
    const body = JSON.parse(init.body);
    requests.push(body);
    const next = script.shift();
    if (!next) return json(500, { error: { message: "fake Claude: script exhausted" } });
    const content = typeof next === "function" ? next(body) : next;
    return json(200, { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" });
  }
  return { fetchImpl, requests };
}

let tu = 0;
export const toolUse = (name, input) => ({ type: "tool_use", id: `tu_${++tu}`, name, input });
export const say = (text) => ({ type: "text", text });
