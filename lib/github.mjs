// Minimal GitHub client for the bot.
// - Reads files from master.
// - Writes atomic multi-file commits through the Git Data API (one commit per confirmed change,
//   so one Action run and one Undo target).
// - Keeps pending proposals on a separate `bot-state` branch, so master stays clean.

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(`GitHub ${status}: ${message}`);
    this.status = status;
  }
}

export function createGitHub({ token, owner, repo, branch = "master", stateBranch = "bot-state", fetchImpl = fetch }) {
  const base = `${API}/repos/${owner}/${repo}`;
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

  async function req(method, path, body) {
    const res = await fetchImpl(path.startsWith("http") ? path : `${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "thabanios-bot",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GitHubError(res.status, data.message ?? res.statusText);
    return data;
  }

  /** { content, sha } or null if the file doesn't exist. */
  async function getFile(path, ref = branch) {
    try {
      const d = await req("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      return { content: Buffer.from(d.content, "base64").toString("utf8").replace(/\r\n/g, "\n"), sha: d.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function headSha(ref = branch) {
    return (await req("GET", `/git/ref/heads/${enc(ref)}`)).object.sha;
  }

  /**
   * One atomic commit. files: { path: newContent | null (delete) }.
   * Retries once if master moved underneath us.
   */
  async function commitFiles(files, message, ref = branch) {
    for (let attempt = 0; ; attempt++) {
      const parent = await headSha(ref);
      const parentCommit = await req("GET", `/git/commits/${parent}`);
      const tree = await req("POST", "/git/trees", {
        base_tree: parentCommit.tree.sha,
        tree: Object.entries(files).map(([path, content]) =>
          content === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content },
        ),
      });
      const commit = await req("POST", "/git/commits", { message, tree: tree.sha, parents: [parent] });
      try {
        await req("PATCH", `/git/refs/heads/${enc(ref)}`, { sha: commit.sha, force: false });
        return { sha: commit.sha, url: `https://github.com/${owner}/${repo}/commit/${commit.sha}` };
      } catch (e) {
        if (e.status === 422 && attempt === 0) continue; // not a fast-forward: someone pushed, rebuild on the new head
        throw e;
      }
    }
  }

  /** Parent sha, message and changed files of a commit. */
  async function getCommit(sha) {
    const d = await req("GET", `/commits/${sha}`);
    return {
      sha: d.sha,
      message: d.commit.message,
      parent: d.parents[0]?.sha,
      files: (d.files ?? []).map((f) => ({ path: f.filename, status: f.status, sha: f.sha })),
    };
  }

  // ---- pending-proposal state on the bot-state branch ----

  async function ensureStateBranch() {
    try {
      await headSha(stateBranch);
    } catch (e) {
      if (e.status !== 404) throw e;
      await req("POST", "/git/refs", { ref: `refs/heads/${stateBranch}`, sha: await headSha(branch) });
    }
  }

  async function putState(id, obj) {
    const body = { message: `state: ${id}`, content: Buffer.from(JSON.stringify(obj, null, 2)).toString("base64"), branch: stateBranch };
    try {
      return await req("PUT", `/contents/state/${enc(id)}.json`, body);
    } catch (e) {
      if (e.status !== 404 && e.status !== 422) throw e;
      await ensureStateBranch();
      return req("PUT", `/contents/state/${enc(id)}.json`, body);
    }
  }

  async function getState(id) {
    const f = await getFile(`state/${id}.json`, stateBranch).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
    return f ? { data: JSON.parse(f.content), sha: f.sha } : null;
  }

  async function deleteState(id, sha) {
    await req("DELETE", `/contents/state/${enc(id)}.json`, { message: `state: clear ${id}`, sha, branch: stateBranch });
  }

  return { req, getFile, headSha, commitFiles, getCommit, putState, getState, deleteState, owner, repo, branch };
}
