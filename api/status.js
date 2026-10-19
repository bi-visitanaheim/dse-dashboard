// GET /api/status -- latest "Refresh data" workflow run + data refresh time.
// Published Oct 19, 2026 (approved by John Picou, per Samantha Lujan). INERT until the env vars below exist.
//
// Vercel serverless function (Node 18+, built-in fetch, no dependencies).
// Uses the same env vars as api/refresh.js (GITHUB_TOKEN, GITHUB_REPO,
// GITHUB_WORKFLOW_FILE, GITHUB_REF). Returns no secrets. If any of the four is
// missing it answers 200 {configured:false, enabled:false} and the dashboard keeps the button hidden.
"use strict";
const fs = require("fs");
const path = require("path");

const CACHE_MS = 5000; // tiny per-instance cache so many open dashboards don't hammer the GitHub API
const cache = { at: 0, body: null };

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}
function readGeneratedAt() {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), "data.json"), "utf8");
    const m = /"generatedAt"\s*:\s*"([^"]+)"/.exec(text.slice(0, 500));
    return m ? m[1] : null;
  } catch (e) { return null; }
}
function pickRun(r) {
  return r ? { id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, createdAt: r.created_at, updatedAt: r.updated_at } : null;
}

async function handler(req, res, env = process.env, now = Date.now) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); return send(res, 405, { status: "method_not_allowed" }); }
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_REF } = env;
  const ref = GITHUB_REF;
  const generatedAt = readGeneratedAt();
  // Not configured yet (published Oct 19, 2026 before credentials exist): answer a clean
  // 200 {configured:false}; the dashboard keeps the Refresh button hidden. GitHub is not called.
  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_WORKFLOW_FILE || !GITHUB_REF ||
      !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPO) || !/^[\w.-]+\.ya?ml$/.test(GITHUB_WORKFLOW_FILE) || !/^[\w./-]+$/.test(GITHUB_REF)) {
    return send(res, 200, { configured: false, enabled: false, status: "not_configured", generatedAt });
  }
  if (cache.body && now() - cache.at < CACHE_MS) return send(res, 200, cache.body);
  const h = { Accept: "application/vnd.github+json", Authorization: "Bearer " + GITHUB_TOKEN, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dse-dashboard-refresh" };
  const base = `https://api.github.com/repos/${GITHUB_REPO}`;
  try {
    const [runsRes, okRes, commitRes] = await Promise.all([
      fetch(`${base}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW_FILE)}/runs?per_page=1`, { headers: h }),
      fetch(`${base}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW_FILE)}/runs?per_page=1&status=success`, { headers: h }),
      fetch(`${base}/commits?path=data.json&per_page=1&sha=${encodeURIComponent(ref)}`, { headers: h })
    ]);
    if (!runsRes.ok) return send(res, 502, { configured: true, enabled: true, status: "github_error", generatedAt });
    const run = ((await runsRes.json()).workflow_runs || [])[0];
    const okRun = okRes.ok ? ((await okRes.json()).workflow_runs || [])[0] : null;
    const commit = commitRes.ok ? (await commitRes.json())[0] : null;
    const body = {
      configured: true,
      enabled: true,
      run: pickRun(run),
      lastSuccess: pickRun(okRun),
      dataCommit: commit ? { sha: commit.sha, date: commit.commit && commit.commit.committer && commit.commit.committer.date } : null,
      deployedSha: env.VERCEL_GIT_COMMIT_SHA || null,
      generatedAt,
      checkedAt: new Date(now()).toISOString()
    };
    cache.at = now(); cache.body = body;
    return send(res, 200, body);
  } catch (e) {
    return send(res, 502, { configured: true, enabled: true, status: "github_error", generatedAt });
  }
}

module.exports = handler;
module.exports._test = { cache };
