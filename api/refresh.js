// POST /api/refresh -- start the "Refresh data" GitHub Actions workflow.
// Published Oct 19, 2026 (approved by John Picou, per Samantha Lujan). INERT until the env vars below exist.
//
// One click on the dashboard's Refresh button calls this, with no sign-in step of its
// own: anyone who can open the dashboard can start a refresh (see SETUP.md). The caller cannot
// change any data -- the workflow only downloads Master.xlsx read-only and commits
// data.json only if it changed and passed the sanity check. Protections here:
//   1. POST only, JSON only, same-origin only (Origin / Referer / Sec-Fetch-Site must
//      match this deployment's own host). No CORS headers are ever sent.
//   2. Cooldown: at most one new refresh per 60 s per instance (best-effort).
//   3. Per-IP soft rate limit (best-effort).
//   4. Authoritative guard: asks GitHub for queued / running refreshes before
//      dispatching, so repeated clicks cannot stack runs. The workflow's
//      concurrency group is a second backstop.
//
// Vercel serverless function (Node 18+ runtime, built-in fetch, no dependencies).
// Environment variables (Vercel project settings only -- never in code or the browser):
//   GITHUB_TOKEN          fine-grained PAT, repo bi-visitanaheim/dse-dashboard only, Actions: Read and write
//   GITHUB_REPO           e.g. bi-visitanaheim/dse-dashboard
//   GITHUB_WORKFLOW_FILE  e.g. refresh-data.yml
//   GITHUB_REF            e.g. main
// If any of the four is missing: 503 {configured:false, status:"not_configured"} and GitHub is never called.
// Response: JSON { status, message, dispatchedAt?, retryAfter? }. Never returns or logs secrets.
"use strict";

const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const COOLDOWN_MS = 60 * 1000;          // min gap between new refreshes (per instance)
const IP_WINDOW_MS = 10 * 60 * 1000;    // per-IP soft limit window
const IP_LIMIT = 10;                    // requests per IP per window

// Best-effort, per-instance memory (serverless instances are not shared).
// The authoritative guards are the GitHub "already running" check below and
// the workflow's concurrency group.
const state = { ips: new Map(), lastDispatch: -Infinity };

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (body && body.retryAfter) res.setHeader("Retry-After", String(body.retryAfter));
  res.end(JSON.stringify(body));
}
function header(req, name) {
  const v = req.headers && req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
function clientIp(req) {
  const xf = header(req, "x-forwarded-for");
  return (xf ? String(xf).split(",")[0] : header(req, "x-real-ip") || (req.socket && req.socket.remoteAddress) || "unknown").trim();
}
function originOf(url) {
  try { return new URL(url).origin; } catch (e) { return null; }
}
// Same-origin only: the request must come from a page on this deployment's own host.
function sameOrigin(req) {
  const host = header(req, "x-forwarded-host") || header(req, "host");
  if (!host) return false;
  const self = "https://" + String(host).split(",")[0].trim().toLowerCase();
  const site = header(req, "sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = header(req, "origin");
  if (origin) return origin.toLowerCase() === self;          // browsers send Origin on POST fetch
  const referer = header(req, "referer");
  return !!referer && (originOf(referer) || "").toLowerCase() === self;
}
function gh(env, path, init) {
  return fetch("https://api.github.com" + path, Object.assign({}, init, {
    headers: Object.assign({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dse-dashboard-refresh"
    }, (init && init.headers) || {})
  }));
}

async function handler(req, res, env = process.env, now = Date.now) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { status: "method_not_allowed", message: "Use POST." }); }
  // Not configured yet (published Oct 19, 2026 before credentials exist): clean 503, GitHub never called.
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_REF } = env;
  const ref = GITHUB_REF;
  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_WORKFLOW_FILE || !GITHUB_REF) {
    return send(res, 503, { configured: false, status: "not_configured", message: "Refresh is not set up yet." });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPO) || !/^[\w.-]+\.ya?ml$/.test(GITHUB_WORKFLOW_FILE) || !/^[\w./-]+$/.test(ref)) {
    return send(res, 503, { configured: false, status: "not_configured", message: "Refresh is misconfigured." });
  }
  if (!sameOrigin(req)) return send(res, 403, { status: "forbidden", message: "Cross-origin requests are not allowed." });
  const ctype = String(header(req, "content-type") || "");
  if (!/^application\/json\b/i.test(ctype)) return send(res, 415, { status: "unsupported_media_type", message: "Send JSON." });

  const t = now();
  // per-IP soft rate limit (best-effort)
  const ip = clientIp(req);
  let rec = state.ips.get(ip);
  if (!rec || t - rec.first > IP_WINDOW_MS) { rec = { count: 0, first: t }; state.ips.set(ip, rec); }
  rec.count++;
  if (rec.count > IP_LIMIT) {
    return send(res, 429, { status: "rate_limited", message: "Too many requests. Please wait a few minutes.", retryAfter: Math.max(1, Math.ceil((rec.first + IP_WINDOW_MS - t) / 1000)) });
  }
  if (state.ips.size > 5000) state.ips.clear();               // keep memory bounded

  // cooldown (best-effort, per instance)
  if (t - state.lastDispatch < COOLDOWN_MS) {
    return send(res, 429, { status: "cooldown", message: "A refresh was just started. Please wait a minute.", retryAfter: Math.max(1, Math.ceil((state.lastDispatch + COOLDOWN_MS - t) / 1000)) });
  }

  const wf = `/repos/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW_FILE)}`;
  // Claim the cooldown now so overlapping clicks on this instance can't both dispatch;
  // release it again if nothing was started.
  const prev = state.lastDispatch;
  state.lastDispatch = t;
  const release = () => { if (state.lastDispatch === t) state.lastDispatch = prev; };
  try {
    // authoritative guard: never stack runs
    const runsRes = await gh(env, `${wf}/runs?per_page=10`);
    if (!runsRes.ok) { release(); return send(res, 502, { status: "github_error", message: "Could not check for running refreshes." }); }
    const runs = (await runsRes.json()).workflow_runs || [];
    const active = runs.find((r) => ACTIVE.has(r.status));
    if (active) { release(); return send(res, 409, { status: "already_running", message: "A refresh is already running.", runStartedAt: active.created_at }); }

    const dispatchedAt = new Date(t).toISOString();
    const d = await gh(env, `${wf}/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, inputs: { trigger: "dashboard-button" } })
    });
    if (d.status !== 204 && d.status !== 200) { release(); return send(res, 502, { status: "github_error", message: "Could not start the refresh." }); }
    return send(res, 202, { status: "dispatched", message: "Refresh started.", dispatchedAt });
  } catch (e) {
    release();
    return send(res, 502, { status: "github_error", message: "Could not reach GitHub." });
  }
}

module.exports = handler;
module.exports._test = { state, sameOrigin, COOLDOWN_MS, IP_LIMIT, IP_WINDOW_MS };
