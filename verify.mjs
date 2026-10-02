// Headless smoke test for the VA BI Dashboard Template restyle (Sept 30, 2026).
// No real browser in this sandbox, so jsdom simulates the DOM; Chart.js and
// fetch() are stubbed; app.js is executed exactly as shipped and must load
// its data through fetch("data.json") (nothing embedded).
// Run from the dse-dashboard folder (or a copy):  node test/verify.mjs
// (requires the "jsdom" npm package). The pre-restyle test suite is kept in
// legacy-tabs/verify.mjs.
import { JSDOM } from "jsdom";
import fs from "fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const dataText = fs.readFileSync(new URL("../data.json", import.meta.url), "utf8");
const data = JSON.parse(dataText);
const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
  console.log("OK:", msg);
}

// ---------- static checks: runtime fetch, no embedded snapshot ----------
assert(/fetch\("data\.json"\)/.test(appJs), 'app.js loads data via fetch("data.json")');
assert(!/const PD\s*=|const DATA\s*=\s*\{/.test(appJs) && appJs.length < 400000, "app.js has no embedded data snapshot");
assert(/<script src="app\.js"><\/script>/.test(html) && /href="style\.css"/.test(html), "index.html links app.js and style.css (no inlined code)");
assert(!/<style>|<script>(?!<\/script>)[^<]/.test(html), "index.html has no inline <style>/<script> blocks");

const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
const { window } = dom;
const doc = window.document;

let chartInstances = 0;
const chartsByCanvas = {};
window.Chart = function (ctx, config) {
  chartInstances++;
  this.canvas = ctx; this.config = config; this.data = config.data; this.options = config.options || {};
  chartsByCanvas[ctx.id] = (chartsByCanvas[ctx.id] || 0) + 1;
  this.destroy = () => {}; this.update = () => {};
  this.getElementsAtEventForMode = () => [];
  this.getDatasetMeta = () => ({ data: [] }); this.isDatasetVisible = () => true;
};
window.Chart.defaults = { font: {}, layout: {}, color: null, borderColor: null, plugins: {}, set: (scope, values) => { window.Chart.defaults[scope] = values; } };
window.Chart.register = () => {};
const fetched = [];
window.fetch = async (url) => { fetched.push(url); return { ok: true, status: 200, json: async () => JSON.parse(dataText) }; };
window.scrollTo = () => {};

const errors = [];
window.onerror = (msg) => { errors.push(String(msg)); };
window.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + (e.reason && e.reason.stack || e.reason)));
const origErr = window.console.error;
window.console.error = (...a) => { errors.push("console.error: " + a.map(String).join(" ")); };

try { window.eval(appJs); } catch (e) { errors.push("eval: " + e.stack); }
await new Promise((r) => setTimeout(r, 400));

assert(errors.length === 0, `no runtime errors on load (got: ${JSON.stringify(errors)})`);
assert(fetched.length === 1 && fetched[0] === "data.json", `fetch called once for "data.json" (got ${JSON.stringify(fetched)})`);
assert(doc.title.includes("Destination Services & Events Dashboard"), "<title> names the dashboard");
assert(doc.querySelector(".sidebar h1").textContent.trim() === "Destination Services & Events Dashboard", "sidebar <h1> names the dashboard");
assert(doc.getElementById("refreshedAt").textContent === data.generatedAt, `"Data last refreshed" shows data.json generatedAt (${data.generatedAt})`);
assert(!doc.getElementById("scopeBanner") && !doc.getElementById("periodSelect"), "preview banner and old period dropdown are gone");

const cardVals = (gridId) => [...doc.querySelectorAll(`#${gridId} .kpi-card`)].map((c) => {
  const lab = [...c.querySelector(".label").childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("").trim().replace(/\*$/, "");
  return [lab, c.querySelector(".value").textContent.trim(), (c.querySelector(".delta") || {}).textContent || ""];
});
const cardMap = (gridId) => Object.fromEntries(cardVals(gridId).map(([l, v]) => [l, v]));

// ---------- Overview: default range ----------
const fromEl = doc.getElementById("ovFrom"), toEl = doc.getElementById("ovTo");
assert(fromEl.type === "date" && toEl.type === "date", "Overview has native From/To date inputs");
const pvPopulated = data.planningVisits.filter((r) => r.planningVisits !== null && r.planningVisits !== undefined).map((r) => r.date).sort();
const lastPv = pvPopulated[pvPopulated.length - 1];
const lastPvEnd = (() => { const y = +lastPv.slice(0, 4), m = +lastPv.slice(5, 7); return lastPv.slice(0, 7) + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); })();
assert(fromEl.value === lastPvEnd.slice(0, 4) + "-01-01" && toEl.value === lastPvEnd, `default range = Jan 1 -> end of latest populated Planning Visits month (${fromEl.value} -> ${toEl.value})`);
assert(cardVals("ov-kpiGrid").length === 13, "Overview renders 13 KPI cards");
const badge = () => doc.getElementById("periodBadge").textContent;
console.log("   default badge:", badge());
assert(badge().startsWith("Jan 1, 2026 – Aug 31, 2026"), "period badge shows the picked range (Jan 1, 2026 – Aug 31, 2026)");

// Independent re-computation of the 13 cards straight from data.json.
function monthEnd(iso) { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return iso.slice(0, 7) + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); }
function sy(iso, n) { return String(+iso.slice(0, 4) + n) + iso.slice(4); }
function win(rows, f, chk, from, to, monthly) {
  const ds = rows.filter((r) => r[f] && (!chk || (r[chk] !== null && r[chk] !== undefined))).map((r) => r[f]).sort();
  if (!ds.length) return null;
  const effTo = to < monthEnd(ds[ds.length - 1]) ? to : monthEnd(ds[ds.length - 1]);
  if (effTo < from) return null;
  const inR = (v, a, b) => monthly ? (v.slice(0, 7) >= a.slice(0, 7) && v.slice(0, 7) <= b.slice(0, 7)) : (v >= a && v <= b);
  return { cur: rows.filter((r) => r[f] && inR(r[f], from, effTo)), pri: rows.filter((r) => r[f] && inR(r[f], sy(from, -1), sy(effTo, -1))) };
}
const S = (a, fn) => a.reduce((s, r) => s + (Number(fn(r)) || 0), 0);
const M = (a, fn) => { const v = a.map(fn).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const Dn = (a, fn) => new Set(a.map(fn).filter((x) => x !== null && x !== undefined)).size;
function expected(from, to) {
  const pv = win(data.planningVisits, "date", "planningVisits", from, to, true);
  const ref = win(data.partnerReferrals.raw, "date", null, from, to);
  const rep = win(data.repeatingClients.raw, "startDate", null, from, to);
  const sur = win(data.accSurvey.raw, "date", "rating", from, to);
  const evs = win(data.eventSurveys.raw, "date", null, from, to);
  const bb = win(data.bookedBusiness.raw, "eventStartDate", null, from, to);
  const n = (w, fn, f2) => (w ? f2(fn(w.cur)) : "—");
  const int = (v) => (v === null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  const pct = (v) => (v === null ? "—" : (v * 100).toFixed(1) + "%");
  const cw = (v) => (v === null ? "—" : v > 90 ? (v / 30).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " months" : int(v) + " days");
  return {
    "Partners Visited": n(pv, (r) => S(r, (x) => x.partnersVisited), int),
    "Planning Visits": n(pv, (r) => S(r, (x) => x.planningVisits), int),
    "Clients Serviced During Planning Visits": n(rep, (r) => r.length, int),
    "Convention Groups Serviced": n(pv, (r) => S(r, (x) => x.conventionGroupsServiced), int),
    "In House Groups Serviced": n(pv, (r) => S(r, (x) => x.inHouseGroupsServiced), int),
    "Clients Serviced": n(pv, (r) => S(r, (x) => x.clientsServiced), int),
    "Partner Referrals": n(ref, (r) => S(r, (x) => x.count), int),
    "Repeat Account %": n(rep, (r) => (r.length ? r.filter((x) => x.repeat === "Yes").length / r.length : null), pct),
    "VA Team Experience Rating": n(sur, (r) => M(r, (x) => x.rating), (v) => (v === null ? "—" : v.toFixed(2) + " / 10")),
    "VA Hosted Events": n(evs, (r) => Dn(r, (x) => x.eventId), int),
    "VA Event Satisfaction Score": n(evs, (r) => M(r, (x) => x.satisfaction), pct),
    "Leads Generated From VA Events": n(bb, (r) => Dn(r, (x) => x.leadId), int),
    "Avg. Lead Conversion Window": n(bb, (r) => M(r, (x) => x.daysFromLeadCreatedToEvent), cw)
  };
}
function checkRange(tag, from, to) {
  const got = cardMap("ov-kpiGrid"), exp = expected(from, to);
  const bad = Object.keys(exp).filter((k) => got[k] !== exp[k]);
  assert(bad.length === 0, `${tag}: all 13 Overview cards match an independent recomputation (${bad.map((k) => `${k}: got ${got[k]} exp ${exp[k]}`).join("; ")})`);
}
checkRange("default range", fromEl.value, toEl.value);
{ const g = cardMap("ov-kpiGrid"); console.log("   default Overview:", JSON.stringify(g));
  assert(g["Partners Visited"] === "284" && g["Planning Visits"] === "62", "default Overview: 284 Partners Visited, 62 Planning Visits (matches prior production default)"); }

// ---------- Overview: metric cards shown directly (Q&A cards removed 2026-10-02) ----------
{
  const grid = doc.getElementById("ov-kpiGrid"), page = doc.getElementById("page-overview");
  assert(!doc.getElementById("ov-qa") && !doc.querySelector(".qa-card, .qa-grid, .qa-intro"), "no question-and-answer cards on the Overview");
  assert(!doc.getElementById("ov-details") && !page.querySelector("details, summary"), "no collapse/toggle wrapper on the Overview");
  assert(grid.closest("section") === page && grid.parentElement === page, "13-card grid sits directly in the Overview page (always visible)");
  const firstContent = [...page.children].find((el) => !el.classList.contains("topbar") && el.id !== "periodBadge" && !el.classList.contains("picker-note"));
  assert(firstContent === grid, "metric grid is the first content block after the date picker");
  assert(!/show full metrics/i.test(page.textContent), 'no "Show full metrics" text');
  assert(doc.querySelectorAll("#ov-takeaways li").length > 0, "Key Takeaways render");
  const pv = grid.querySelector(".kpi-card .def-btn");
  assert(pv, "Overview cards keep their ? definition buttons");
  // jsdom (runScripts "outside-only") skips inline onclick, so call the same handler it names
  const defId = (pv.getAttribute("onclick").match(/toggleDef\('([^']+)'\)/) || [])[1];
  assert(defId && typeof window.toggleDef === "function", `? button is wired to toggleDef('${defId}')`);
  window.toggleDef(defId);
  assert(doc.querySelector("#ov-kpiGrid .def-pop.open"), "Overview ? button opens its definition popover");
  doc.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert(!doc.querySelector("#ov-kpiGrid .def-pop.open"), "clicking elsewhere closes the definition popover");
}

function pick(from, to) {
  // Set both inputs, then fire change (firing between the two edits would
  // briefly produce a reversed range, which the app swaps into order).
  fromEl.value = from; toEl.value = to;
  toEl.dispatchEvent(new window.Event("change"));
}
const defaultSnapshot = doc.getElementById("ov-kpiGrid").innerHTML;
pick("2026-04-01", "2026-06-30");
assert(badge().startsWith("Apr 1, 2026 – Jun 30, 2026"), `custom range 1 badge updates (${badge()})`);
assert(doc.getElementById("ov-kpiGrid").innerHTML !== defaultSnapshot, "custom range 1 changes the cards");
checkRange("custom range 1 (Apr 1 – Jun 30, 2026)", "2026-04-01", "2026-06-30");
console.log("   Q2 2026:", JSON.stringify(cardMap("ov-kpiGrid")));
assert(cardMap("ov-kpiGrid")["Planning Visits"] === "24", "custom range 1: Planning Visits Apr–Jun 2026 = 5+10+9 = 24");
pick("2025-07-15", "2026-03-10");
checkRange("custom range 2 (Jul 15, 2025 – Mar 10, 2026, spans two years)", "2025-07-15", "2026-03-10");
pick("2026-02-01", "2026-09-30");
checkRange("custom range 3 (To beyond some sheets' data -> per-card clamp)", "2026-02-01", "2026-09-30");
assert(doc.getElementById("ov-kpiGrid").textContent.includes("Data available through"), "range 3: lagging sheets are labelled 'Data available through ...'");
pick("2026-10-01", "2026-12-31");
checkRange("custom range 4 (future dates, no data)", "2026-10-01", "2026-12-31");
assert(doc.getElementById("ov-kpiGrid").textContent.includes("No data in this date range"), "range 4: empty cards say 'No data in this date range' (no fabricated zeros)");
pick("2026-06-30", "2026-04-01");
assert(fromEl.value === "2026-04-01" && toEl.value === "2026-06-30", "reversed From/To are swapped into order");
doc.getElementById("ovReset").click();
assert(fromEl.value === "2026-01-01" && toEl.value === lastPvEnd && doc.getElementById("ov-kpiGrid").innerHTML === defaultSnapshot, "Year-to-date button restores the default range and cards");
assert(errors.length === 0, `no runtime errors after date-range changes (${JSON.stringify(errors)})`);

// Nav teasers are data-driven (not hardcoded)
{ const t = doc.getElementById("ov-navCards").textContent;
  assert(doc.querySelectorAll("#ov-navCards .nav-card").length === 6 && /Partners Visited\*?: 284/.test(t) && /Partner Referrals: 103/.test(t), "Open-a-page cards read live section values (284 partners, 103 referrals)"); }

// "Open a page" cards link to all six section pages (inline onclick -> showPage)
{ const targets = [...doc.querySelectorAll("#ov-navCards .nav-card")].map((c) => (c.getAttribute("onclick").match(/showPage\('([^']+)'\)/) || [])[1]);
  assert(targets.join() === "team,referrals,repeat,survey,events,booked", `Open-a-page cards link to the six section pages (${targets.join()})`);
  window.showPage(targets[1]);
  assert(doc.getElementById("page-referrals").classList.contains("active"), "Open-a-page Partner Referrals link opens that page"); }
window.showPage("overview");
// Old sidebar eyebrow ("Internal" + " BI") removed; pattern split so this file doesn't match its own grep
assert(doc.querySelector(".sidebar .brand").textContent.trim() === "Visit Anaheim", 'sidebar brand line reads just "Visit Anaheim"');
assert(![html, appJs, fs.readFileSync(new URL("../style.css", import.meta.url), "utf8")].some((t) => new RegExp("internal" + " bi", "i").test(t)), 'old sidebar eyebrow text appears nowhere in index.html / app.js / style.css');

// ---------- Section pages ----------
const SECTIONS = {
  team: { grids: ["team-kpiGrid"], filters: ["team-year"] },
  referrals: { grids: ["ref-kpiGrid"], filters: ["ref-year", "ref-manager"] },
  repeat: { grids: ["rep-kpiGrid-accounts"], filters: ["rep-year", "rep-account", "rep-manager", "rep-lead", "rep-repeat"] },
  survey: { grids: ["sur-kpiGrid"], filters: ["sur-year", "sur-manager", "sur-question"] },
  events: { grids: ["hev-kpiGrid"], filters: ["hev-year", "hev-category", "hev-event"] },
  booked: { grids: ["bb-kpiGrid", "bb-kpiGrid2"], filters: ["bb-year", "bb-status", "bb-event", "bb-manager", "bb-eventstatus"] }
};
const sig = (page) => doc.getElementById("page-" + page).innerHTML;
for (const [page, cfg] of Object.entries(SECTIONS)) {
  const before = chartInstances;
  window.showPage(page);
  assert(doc.getElementById("page-" + page).classList.contains("active"), `${page}: page opens`);
  for (const g of cfg.grids) assert(doc.querySelectorAll(`#${g} .kpi-card`).length > 0, `${page}: #${g} renders KPI cards (${doc.querySelectorAll(`#${g} .kpi-card`).length})`);
  const canvases = [...doc.querySelectorAll(`#page-${page} canvas`)];
  assert(chartInstances - before >= canvases.length, `${page}: all ${canvases.length} charts drawn when the page opens`);
  assert(doc.getElementById(page + "-period").textContent.startsWith("Reporting period:"), `${page}: reporting-period badge set (${doc.getElementById(page + "-period").textContent})`);
  for (const fid of cfg.filters) {
    const el = doc.getElementById(fid);
    const base = sig(page);
    let values;
    if (el.tagName === "SELECT") values = [...el.options].map((o) => o.value);
    else values = [...doc.getElementById(el.getAttribute("list")).options].map((o) => o.value).slice(0, 6);
    const orig = el.value;
    let changed = 0;
    for (const v of values) {
      el.value = v; el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input")); el.dispatchEvent(new window.Event("change"));
      if (sig(page) !== base) changed++;
    }
    el.value = orig; el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input")); el.dispatchEvent(new window.Event("change"));
    assert(errors.length === 0, `${page}: filter #${fid} ran all ${values.length} options without errors`);
    assert(changed > 0, `${page}: filter #${fid} changes the page output (${changed}/${values.length} options differ from default)`);
    assert(sig(page) === base, `${page}: restoring #${fid} returns to the default output`);
  }
  // footer source line follows the page
  assert(doc.getElementById("footSource").textContent.startsWith("Sources:"), `${page}: footer source line updated (${doc.getElementById("footSource").textContent})`);
}

// Key real numbers (default filter state), loaded via fetch("data.json")
window.showPage("team");
{ const t = cardMap("team-kpiGrid"); console.log("   team:", JSON.stringify(t));
  assert(t["Partners Visited"] === "284" && t["Planning Visits"] === "62", "Team KPIs: 284 Partners Visited, 62 Planning Visits"); }
window.showPage("referrals");
{ const r = cardMap("ref-kpiGrid"); console.log("   referrals:", JSON.stringify(r));
  assert(r["Partner Referrals"] === "103", "Partner Referrals: 103 referrals (2026)"); }
window.showPage("repeat");
{ const v = cardVals("rep-kpiGrid-accounts").map((x) => x[1]); console.log("   repeat:", JSON.stringify(cardVals("rep-kpiGrid-accounts").map((x) => x.slice(0, 2))));
  assert(v.slice(0, 3).join("/") === "50/23/27", "Repeat ACC Accounts: 50 total / 23 repeat / 27 new accounts"); }
for (const p of ["survey", "events", "booked"]) { window.showPage(p); console.log(`   ${p}:`, JSON.stringify(cardVals(SECTIONS[p].grids[0]).map((x) => x.slice(0, 2)))); }

window.showPage("sources");
assert(doc.getElementById("page-sources").classList.contains("active"), "Sources page opens");
window.showPage("overview");
assert(doc.getElementById("footSource").textContent.includes("Granicus, Association Insights"), "Overview footer source restored");
// Mobile nav drawer (responsive pass, 2026-09-30): hamburger / backdrop / Escape / nav click
{ const sb = doc.getElementById("sidebar"), tg = doc.getElementById("navToggle"), bd = doc.getElementById("navBackdrop");
  const st = () => [sb.classList.contains("open"), tg.getAttribute("aria-expanded"), bd.hidden, doc.body.classList.contains("nav-open")].join(",");
  const CLOSED = "false,false,true,false";
  assert(sb && tg && bd && st() === CLOSED, "mobile drawer: starts closed");
  tg.click(); assert(st() === "true,true,false,true", "mobile drawer: hamburger opens it");
  tg.click(); assert(st() === CLOSED, "mobile drawer: hamburger closes it");
  tg.click(); bd.click(); assert(st() === CLOSED, "mobile drawer: backdrop click closes it");
  tg.click(); doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })); assert(st() === CLOSED, "mobile drawer: Escape closes it");
  tg.click(); doc.querySelector('.nav-btn[data-page="team"]').click();
  assert(st() === CLOSED && doc.getElementById("page-team").classList.contains("active"), "mobile drawer: nav click opens the page and closes the drawer");
  window.showPage("overview");
  assert([...doc.querySelectorAll("table.mini")].every((t) => t.parentElement.classList.contains("table-scroll")), "every table sits in its own .table-scroll container"); }
assert(errors.length === 0, `no runtime errors anywhere (${JSON.stringify(errors)})`);
console.log(`\nALL ${passed} CHECKS PASSED (${chartInstances} chart instances)`);
