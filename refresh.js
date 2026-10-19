/* =====================================================================
   DS&E Dashboard -- "Refresh data" button (published Oct 19, 2026).
   Approved by John Picou (per Samantha Lujan). INERT until the credentials
   in SETUP-REFRESH.md exist: /api/status answers {configured:false} and the
   button stays hidden.

   Flow: one click -> POST /api/refresh -> GitHub Actions rebuilds
   data.json from SharePoint Master.xlsx -> Vercel redeploys -> this script
   polls /api/status, then reloads the newer data.json in place.

   - No secret lives here, and nothing is typed or stored: one click starts
     the refresh. The server applies same-origin, cooldown and
     "already running" checks.
   - The button stays HIDDEN unless /api/status answers {enabled:true}
     (and never when it answers {configured:false})
     (so it never shows on a local file, the Cowork artifact, or if the
     serverless functions are not configured).
   - Optional overrides for tests / the mock preview:
       window.DSE_REFRESH_CONFIG = { statusUrl, refreshUrl, dataUrl, pollMs, maxMs }
   ===================================================================== */
(function () {
  "use strict";
  const CFG = Object.assign({
    statusUrl: "/api/status",
    refreshUrl: "/api/refresh",
    dataUrl: "data.json",
    pollMs: 10000,       // poll /api/status every ~10 s
    maxMs: 5 * 60000     // give up after ~5 minutes
  }, window.DSE_REFRESH_CONFIG || {});
  const MSG = {
    failed: "Couldn’t refresh — try again or contact BI.",
    running: "A refresh is already running — following it now…",
    busy: "A refresh was just started — please wait a minute before trying again.",
    noNew: "No newer data in Master.xlsx — the dashboard is already up to date.",
    timeout: "Still not finished after 5 minutes — reload the page later or contact BI.",
    working: "Refreshing… getting the latest Master.xlsx (about 1–2 minutes)."
  };

  const $ = (id) => document.getElementById(id);
  const btn = $("refreshData"), statusEl = $("refreshStatus");
  if (!btn || !statusEl) return;            // markup stripped (artifact build)
  if (typeof location !== "undefined" && location.protocol === "file:") return;

  let timer = null, busy = false;

  // ---------- small helpers ----------
  function fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function fmtDate(isoDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay || "")) return "";
    const [y, m, d] = isoDay.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function hash(text) {                                         // FNV-1a, enough to spot a changed file
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ":" + text.length;
  }
  function say(text, kind) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", kind === "error");
    statusEl.classList.toggle("is-ok", kind === "ok");
    statusEl.hidden = !text;
  }
  function setBusy(on) {
    busy = on;
    btn.disabled = on;
    btn.setAttribute("aria-busy", on ? "true" : "false");
  }
  async function getJson(url, opts) {
    const res = await fetch(url, Object.assign({ cache: "no-store", credentials: "same-origin" }, opts || {}));
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, ok: res.ok, body };
  }
  async function fetchDataText() {
    const sep = CFG.dataUrl.indexOf("?") >= 0 ? "&" : "?";
    const res = await fetch(CFG.dataUrl + sep + "v=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("data.json HTTP " + res.status);
    return await res.text();
  }
  function lastRefreshedText(s) {
    if (s && s.lastSuccess && s.lastSuccess.updatedAt) return "Last refreshed " + fmtDateTime(s.lastSuccess.updatedAt);
    if (s && s.generatedAt) return "Data as of " + fmtDate(s.generatedAt);
    return "";
  }

  btn.addEventListener("click", () => { if (!busy) start(); });

  // ---------- refresh ----------
  async function start() {
    setBusy(true);
    say(MSG.working);
    let baseline = null;
    try { baseline = hash(await fetchDataText()); } catch (e) { baseline = null; }
    let r;
    try {
      r = await getJson(CFG.refreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
    } catch (e) { return finish(MSG.failed, "error"); }

    if (r.status === 202) return watch(r.body && r.body.dispatchedAt, baseline);
    if (r.status === 409) { say(MSG.running); return watch(null, baseline); }
    if (r.status === 429) return finish(MSG.busy, "error");
    return finish(MSG.failed, "error");
  }

  // Poll /api/status until the run finishes and the redeployed data.json changes.
  function watch(dispatchedAt, baseline) {
    const t0 = Date.now();
    const since = dispatchedAt ? Date.parse(dispatchedAt) - 60000 : null;  // 1 min clock slack
    let runId = null;
    const tick = async () => {
      timer = null;
      if (Date.now() - t0 > CFG.maxMs) return finish(MSG.timeout, "error");
      let s;
      try { s = (await getJson(CFG.statusUrl)).body; } catch (e) { s = null; }
      const run = s && s.run;
      const mine = run && (runId ? run.id === runId : (since == null || Date.parse(run.createdAt) >= since));
      if (mine) {
        runId = run.id;
        if (run.status === "completed") {
          if (run.conclusion !== "success") return finish(MSG.failed, "error");
          const c = s.dataCommit;
          const committed = c && c.date && Date.parse(c.date) >= Date.parse(run.createdAt) - 5000;
          if (!committed) return finish(MSG.noNew, "ok");
          // Data was committed: wait for Vercel to serve the new data.json.
          try {
            const text = await fetchDataText();
            if (baseline == null || hash(text) !== baseline) {
              const data = JSON.parse(text);
              if (typeof window.DSE_reloadData === "function") window.DSE_reloadData(data);
              else { window.location.reload(); return; }
              return finish("Updated " + fmtDateTime(new Date().toISOString()) +
                (data.generatedAt ? " · data as of " + fmtDate(data.generatedAt) : ""), "ok");
            }
          } catch (e) { /* not deployed yet or mid-deploy: keep polling */ }
        }
      }
      timer = setTimeout(tick, CFG.pollMs);
    };
    timer = setTimeout(tick, Math.min(CFG.pollMs, 3000));
  }

  function finish(text, kind) {
    if (timer) { clearTimeout(timer); timer = null; }
    setBusy(false);
    say(text, kind);
  }

  // ---------- show the button only when the backend answers ----------
  (async function probe() {
    let s;
    try {
      const r = await getJson(CFG.statusUrl);
      s = r.ok ? r.body : null;
    } catch (e) { s = null; }
    if (!s || s.configured === false || s.enabled !== true) return;   // not configured / unreachable: stay hidden, log nothing
    btn.hidden = false;
    say(lastRefreshedText(s));
    if (s.run && s.run.status && s.run.status !== "completed") {
      setBusy(true); say(MSG.running);
      let baseline = null;
      try { baseline = hash(await fetchDataText()); } catch (e) { baseline = null; }
      watch(null, baseline);
    }
  })();

  // test hook (no secrets): lets tests check that polling stopped
  window.DSE_refreshState = () => ({ busy, polling: timer !== null });
})();
