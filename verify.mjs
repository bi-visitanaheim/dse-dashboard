// Headless smoke test for the DS&E dashboard
// Updated Oct 19, 2026 (later): "# of" dropped from every card label on every tab; the
// clients-serviced card/chart/table row renamed "Clients Serviced During Planning Visits".
// Updated Oct 19, 2026: date pickers / Year lists bounded by real data; Team KPIs card order
// matches the Overview, planning-visit-clients card removed, chart rows re-ordered.
// Updated Oct 16, 2026: Master.xlsx data source, approved (no draft text), root-level logo.
// (Social Media Dashboard layout:
// header band + sticky horizontal tab bar, Oct 14, 2026).
// Updated Oct 14, 2026: five drill-down Overview cards, Repeat ACC Accounts
// retired, Event Touchpoints to Booked Business moved to Trade Shows & Events.
// Updated Oct 14, 2026 (later): Overview simplified for non-technical teams;
// Data sources / Methodology / Definitions moved to a sixth tab,
// "Sources & Methodology"; comparison bar card removed; takeaways <= 3.
// Updated Oct 14, 2026 (later still): Hosted Events tab removed (no longer
// relevant) -- five tabs; its old assertions are saved in
// removed-hosted-events/hosted-events-test-assertions.txt.
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
let printed = 0; window.print = () => { printed++; };

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
assert(doc.getElementById("dashTitle").textContent.trim() === "Destination Services & Events Dashboard", "header <h1> names the dashboard");
// ---------- Shell: Social Media Dashboard layout ----------
assert(doc.querySelector("header.hdr img.logo[alt='Visit Anaheim']") && doc.querySelector("header.hdr #exportPdf"), "header band has the Visit Anaheim logo and an Export PDF button");
{ const tabs = [...doc.querySelectorAll("nav.tabs .tab")];
  assert(tabs.map((t) => t.textContent.trim()).join("|") === "Overview|Team KPIs|Partner Referrals|Client Survey|Sources & Methodology" && tabs.length === 5, `tab bar has exactly 5 tabs: Overview | Team KPIs | Partner Referrals | Client Survey | Sources & Methodology (${tabs.map((t) => t.textContent.trim()).join(" | ")})`);
  assert(tabs.every((t) => t.tagName === "BUTTON") && tabs[0].getAttribute("aria-current") === "true", "tabs are buttons; Overview is the current tab on load"); }
assert(!doc.querySelector(".sidebar, #sidebar, .mobile-bar, #navToggle, .nav-backdrop, .nav-btn"), "no sidebar, mobile drawer or nav buttons left in the DOM");
assert(!/setNavOpen|closeNav|nav-toggle|renderNavCards/.test(appJs), "no sidebar/drawer/nav-card code left in app.js");
doc.getElementById("exportPdf").click();
assert(printed === 1, "Export PDF button calls window.print()");
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
const OV_ORDER = ["Planning Visits", "Clients Serviced During Planning Visits", "Partners Visited", "Convention Groups Serviced", "In-House Groups Serviced"];
assert(cardVals("ov-kpiGrid").map((x) => x[0]).join("|") === OV_ORDER.join("|"), `Overview renders exactly the five requested cards, in order (${cardVals("ov-kpiGrid").map((x) => x[0]).join(" | ")})`);
const badge = () => doc.getElementById("ovPeriodTag").textContent;
console.log("   default pill:", badge());
assert(badge() === "Jan 1, 2026 – Aug 31, 2026", "Overview period pill shows the picked range in plain words (Jan 1, 2026 – Aug 31, 2026)");
assert(!doc.getElementById("periodBadge"), 'no separate "Compared:" badge on the Overview');

// Independent re-computation of the five cards straight from data.json.
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
function expected(from, to) {
  const pv = win(data.planningVisits, "date", "planningVisits", from, to, true);
  const int = (v) => (v === null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  const n = (fn) => (pv ? int(S(pv.cur, fn)) : "—");
  return {
    "Planning Visits": n((x) => x.planningVisits),
    "Clients Serviced During Planning Visits": n((x) => x.clientsServiced),
    "Partners Visited": n((x) => x.partnersVisited),
    "Convention Groups Serviced": n((x) => x.conventionGroupsServiced),
    "In-House Groups Serviced": n((x) => x.inHouseGroupsServiced)
  };
}
function checkRange(tag, from, to) {
  const got = cardMap("ov-kpiGrid"), exp = expected(from, to);
  const bad = Object.keys(exp).filter((k) => got[k] !== exp[k]);
  assert(bad.length === 0, `${tag}: all 5 Overview cards match an independent recomputation (${bad.map((k) => `${k}: got ${got[k]} exp ${exp[k]}`).join("; ")})`);
}
checkRange("default range", fromEl.value, toEl.value);
{ const g = cardMap("ov-kpiGrid"); console.log("   default Overview:", JSON.stringify(g));
  assert(g["Partners Visited"] === "284" && g["Planning Visits"] === "62", "default Overview: 284 Partners Visited, 62 Planning Visits (matches prior production default)"); }

// ---------- Overview: metric cards shown directly (Q&A cards removed 2026-10-02) ----------
{
  const grid = doc.getElementById("ov-kpiGrid"), page = doc.getElementById("page-overview");
  assert(!doc.getElementById("ov-qa") && !doc.querySelector(".qa-card, .qa-grid, .qa-intro"), "no question-and-answer cards on the Overview");
  assert(!doc.getElementById("ov-details") && !page.querySelector("details, summary"), "no collapse/toggle wrapper on the Overview");
  assert(grid.closest("section") === page && grid.parentElement === page, "5-card grid sits directly in the Overview page (always visible)");
  const kids = [...page.children];
  assert(kids[0].classList.contains("page-h") && kids[1].classList.contains("date-range") && kids[2] === grid, "Overview order: title/subtitle, light date range row, then the five tiles");
  assert(page.querySelector(".page-h h2") && page.querySelectorAll(".page-h .sub").length === 1, "Overview header has an H2 and one subtitle sentence");
  assert(!page.querySelector(".src-pill, .picker-note, .dr-note, #ov-compare, #ov-compare-bars, .ov-m, #ov-definitions, #ov-sources, #ov-method, dl.defs"), "Overview has no source pills, picker note, comparison bar card, or definitions/sources/methodology blocks");
  const ovText = page.textContent;
  for (const w of ["Methodology", "Data sources", "Definitions", "YoY", "YTD", "Year to date", "cutoff", "Data available through", "prior-year", "Source:"])
    assert(!ovText.includes(w), `Overview text does not contain "${w}"`);
  assert([...page.children].length === 5 && page.querySelector(".ins") && page.querySelector("#ovSeeSources"), "Overview has only: header, date range, tiles, takeaways, and a link to Sources & Methodology");
  window.showPage("overview"); doc.getElementById("ovSeeSources").click();
  assert(doc.getElementById("page-sources").classList.contains("active") && doc.querySelector('.tab[data-page="sources"]').getAttribute("aria-current") === "true", '"How these numbers are counted" link opens the Sources & Methodology tab');
  window.showPage("overview");
  // Sources & Methodology tab
  const sp = doc.getElementById("page-sources"), st = sp.textContent;
  assert(sp.querySelector(".page-h h2") && sp.querySelector(".page-h .overline").textContent.trim() === "Sources & Methodology", "Sources tab uses the overline/heading/subtitle header");
  assert(doc.getElementById("src-sources") && ["Granicus", "Association Insights", "Internal Tracking"].every((x) => doc.getElementById("src-sources").textContent.includes(x)), "Sources tab lists Granicus, Association Insights and Internal Tracking");
  assert(doc.getElementById("src-method") && /Methodology/.test(doc.getElementById("src-method").textContent) && /same dates last year/.test(st), "Sources tab has the Methodology block");
  const defs = doc.getElementById("src-definitions").textContent;
  assert(OV_ORDER.every((l) => defs.includes(l)) && defs.includes("A partner property visited in person during a planning visit.") && defs.includes("Partner Referrals"), "Sources tab Definitions cover all five tiles plus Partners Visited / Partner Referrals");
  assert(!/\bYoY\b|\bYTD\b|cutoff/i.test(st), "Sources tab avoids jargon (YoY / YTD / cutoff)");
  assert(!/show full metrics/i.test(page.textContent), 'no "Show full metrics" text');
  assert(doc.querySelectorAll("#ov-takeaways li").length > 0, "Key Takeaways render");
  const pv = grid.querySelector(".kpi-wrap .def-btn");
  assert(pv && grid.querySelectorAll(".def-btn").length === 1 && pv.closest(".kpi-wrap").querySelector(".label").textContent.trim() === "Partners Visited", "Partners Visited keeps its ? definition button (only card with one)");
  assert(!pv.closest(".kpi-card"), "? button is not nested inside the clickable card (no interactive-in-interactive)");
  // jsdom (runScripts "outside-only") skips inline onclick, so call the same handler it names
  const defId = (pv.getAttribute("onclick").match(/toggleDef\('([^']+)'\)/) || [])[1];
  assert(defId && typeof window.toggleDef === "function", `? button is wired to toggleDef('${defId}')`);
  window.toggleDef(defId);
  assert(doc.querySelector("#ov-kpiGrid .def-pop.open"), "Overview ? button opens its definition popover");
  doc.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert(!doc.querySelector("#ov-kpiGrid .def-pop.open"), "clicking elsewhere closes the definition popover");
  // Removed Overview cards (Oct 14, 2026)
  const gt = grid.textContent;
  for (const gone of ["Partner Referrals", "Repeat Account", "VA Team Experience Rating", "VA Hosted Events", "Event Satisfaction", "Leads Generated", "Conversion Window"])
    assert(!gt.includes(gone), `Overview has no "${gone}" card`);
  const tk = doc.getElementById("ov-takeaways").textContent;
  const tks = [...doc.querySelectorAll("#ov-takeaways li")];
  console.log("   takeaways:", JSON.stringify(tks.map((l) => l.textContent)));
  assert(tks.length >= 1 && tks.length <= 3, `at most 3 Key Takeaways (${tks.length})`);
  assert(tks.every((l) => l.querySelector("b") && (l.textContent.match(/\./g) || []).length === 1 && !/\(|Source|YoY|YTD|prior/i.test(l.textContent)), "each takeaway is one plain sentence with a bold number, no parentheticals or jargon");
  { const tiles = cardVals("ov-kpiGrid"); assert(tks.every((l, i) => l.querySelector("b").textContent === tiles[i][1]), "takeaway numbers match the tiles"); }
  assert(cardVals("ov-kpiGrid").every((x) => /^(▲ Up \d+% vs\. last year|▼ Down \d+% vs\. last year|About the same as last year|New this year, nothing to compare yet)$/.test(x[2].trim())), `tile change lines are plain "up/down X% vs. last year" (${cardVals("ov-kpiGrid").map((x) => x[2].trim()).join(" | ")})`);
  assert(!/Repeat|Booked|Team Experience|Referral|Leads|Conversion|Satisfaction/i.test(tk), "Key Takeaways mention no removed metric");
}

// ---------- Overview: drill-down to Team KPIs ----------
{
  const cards = [...doc.querySelectorAll("#ov-kpiGrid .kpi-card")];
  assert(cards.length === 5 && cards.every((c) => c.getAttribute("role") === "button" && c.getAttribute("tabindex") === "0" && c.dataset.goto === "team"), "all five Overview cards are focusable buttons that target Team KPIs");
  assert(cards.every((c) => c.querySelector(".drill-arrow")), "every Overview card shows a drill-down arrow");
  const onTeam = () => doc.getElementById("page-team").classList.contains("active") && doc.querySelector('.tab[data-page="team"]').getAttribute("aria-current") === "true" && doc.querySelector('.tab[data-page="overview"]').getAttribute("aria-current") === "false";
  cards.forEach((c, i) => {
    window.showPage("overview");
    doc.querySelectorAll("#ov-kpiGrid .kpi-card")[i].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert(onTeam(), `click on "${OV_ORDER[i]}" opens Team KPIs`);
  });
  for (const key of ["Enter", " "]) {
    window.showPage("overview");
    const c = doc.querySelectorAll("#ov-kpiGrid .kpi-card")[1];
    c.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
    assert(onTeam(), `keyboard ${key === " " ? "Space" : key} on an Overview card opens Team KPIs`);
  }
  window.showPage("overview");
  doc.querySelector("#ov-kpiGrid .def-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert(doc.getElementById("page-overview").classList.contains("active"), "clicking the ? button does not navigate away");
  assert(errors.length === 0, `no runtime errors during drill-down (${JSON.stringify(errors)})`);
}

function pick(from, to) {
  // Set both inputs, then fire change (firing between the two edits would
  // briefly produce a reversed range, which the app swaps into order).
  fromEl.value = from; toEl.value = to;
  toEl.dispatchEvent(new window.Event("change"));
}
const defaultSnapshot = doc.getElementById("ov-kpiGrid").innerHTML;
pick("2026-04-01", "2026-06-30");
assert(badge() === "Apr 1, 2026 – Jun 30, 2026", `custom range 1 pill updates (${badge()})`);
assert(doc.getElementById("ov-kpiGrid").innerHTML !== defaultSnapshot, "custom range 1 changes the cards");
checkRange("custom range 1 (Apr 1 – Jun 30, 2026)", "2026-04-01", "2026-06-30");
console.log("   Q2 2026:", JSON.stringify(cardMap("ov-kpiGrid")));
assert(cardMap("ov-kpiGrid")["Planning Visits"] === "24", "custom range 1: Planning Visits Apr–Jun 2026 = 5+10+9 = 24");
pick("2025-07-15", "2026-03-10");
checkRange("custom range 2 (Jul 15, 2025 – Mar 10, 2026, spans two years)", "2025-07-15", "2026-03-10");
{ const tl = [...doc.querySelectorAll("#ov-kpiGrid .delta")].map((d) => d.textContent.trim());
  assert(tl.every((t) => t === "Last year's numbers start Jan 1, 2025, so no full comparison"), `range 2: prior period starts before the data, so tiles say so plainly instead of a % (${tl[0]})`);
  assert([...doc.querySelectorAll("#ov-takeaways li")].every((l) => /only cover part of these dates\.$/.test(l.textContent)), "range 2: takeaways say last year only partly covers the dates"); }
pick("2025-01-01", "2025-06-30");
checkRange("custom range 2b (Jan 1 – Jun 30, 2025, no prior-year data)", "2025-01-01", "2025-06-30");
{ const tl = [...doc.querySelectorAll("#ov-kpiGrid .delta")].map((d) => d.textContent.trim());
  assert(tl.every((t) => t === "No data for the same dates last year") && !/0%|Up|Down/.test(tl.join()), `range 2b: tiles say "No data for the same dates last year" (no fake 0 comparison)`);
  assert([...doc.querySelectorAll("#ov-takeaways li")].every((l) => /no data for the same dates last year to compare\.$/.test(l.textContent)), "range 2b: takeaways say there is no prior-year data"); }
// ---------- Oct 19, 2026: date pickers bounded by the real data ----------
const PVF = ["planningVisits", "clientsServiced", "partnersVisited", "conventionGroupsServiced", "inHouseGroupsServiced"];
const pvReal = data.planningVisits.filter((r) => PVF.some((f) => r[f] !== null && r[f] !== undefined)).map((r) => r.date).sort();
const dataMin = pvReal[0].slice(0, 7) + "-01", dataMax = monthEnd(pvReal[pvReal.length - 1]);
console.log("   Overview picker bounds (from data):", dataMin, "->", dataMax);
assert(fromEl.min === dataMin && toEl.min === dataMin && fromEl.max === dataMax && toEl.max === dataMax, `From/To min = earliest populated Planning Visits date (${fromEl.min}), max = latest (${fromEl.max})`);
assert(dataMin === "2025-01-01" && dataMax === "2026-08-31", "Planning Visits data runs Jan 1, 2025 – Aug 31, 2026");
pick("2022-01-01", "2022-12-31");
assert(fromEl.value === dataMin && toEl.value === dataMin, `typed 2022 dates are pulled back into the data range (${fromEl.value} -> ${toEl.value})`);
pick("2026-02-01", "2026-09-30");
assert(toEl.value === dataMax, "To date past the latest data is capped at the latest date");
checkRange("custom range 3 (To beyond the data -> capped)", "2026-02-01", dataMax);
assert(badge() === "Feb 1, 2026 – Aug 31, 2026" && !doc.getElementById("page-overview").textContent.includes("Data available through"), `range 3: period pill shows the capped dates (${badge()})`);
pick("2026-10-01", "2026-12-31");
assert(fromEl.value === dataMax && toEl.value === dataMax, "range 4: future-only dates are capped at the latest data date");
checkRange("custom range 4 (future dates, capped)", dataMax, dataMax);
pick("2026-06-30", "2026-04-01");
assert(fromEl.value === "2026-04-01" && toEl.value === "2026-06-30", "reversed From/To are swapped into order");
doc.getElementById("ovReset").click();
assert(fromEl.value === "2026-01-01" && toEl.value === lastPvEnd && doc.getElementById("ov-kpiGrid").innerHTML === defaultSnapshot, "This year button restores the default range and cards");
assert(errors.length === 0, `no runtime errors after date-range changes (${JSON.stringify(errors)})`);

assert(!doc.getElementById("ov-navCards") && !doc.querySelector(".nav-card"), "no Open-a-page cards (tab bar replaces them)");
for (const t of ["team", "referrals", "survey", "sources", "overview"]) { doc.querySelector(`.tab[data-page="${t}"]`).click();
  assert(doc.getElementById("page-" + t).classList.contains("active") && doc.querySelectorAll(".page.active").length === 1, `tab "${t}" shows only its page`); }
// Removed pages (Oct 14, 2026)
assert(!doc.getElementById("page-repeat") && !doc.querySelector('[data-page="repeat"]') && !doc.querySelector('[id^="rep-"]'), "Repeat ACC Accounts page, nav button and elements are gone");
assert(!doc.getElementById("page-booked") && !doc.querySelector('[data-page="booked"]') && !doc.querySelector('[id^="bb-"], [id^="hev-bb"]'), "Event Touchpoints to Booked Business page, nav button and elements are gone");
assert(!/initRepeat|renderRepeat|initBooked|renderBooked|renderHevBookedLink/.test(appJs), "no Repeat / Booked Business render code left in app.js");
assert([...doc.querySelectorAll(".tab")].map((b) => b.dataset.page).join() === "overview,team,referrals,survey,sources", "tab bar targets overview, team, referrals, survey, sources (no Repeat / Booked / Hosted Events)");
// Hosted Events tab removed (Oct 14, 2026)
assert(!doc.getElementById("page-events") && !doc.querySelector('[data-page="events"]') && !doc.querySelector('[id^="hev-"], #events-period, .events-team'), "Hosted Events page, tab button, filters, charts and tables are gone");
assert(!/Hosted Events|Event Survey|VA-hosted|events Visit Anaheim hosts/i.test(doc.body.textContent), "no Hosted Events / Event Survey text anywhere in the DOM");
assert(!/initEvents|renderEvents|eventSurveys|hev-/.test(appJs) && !/events-team|hev-/.test(fs.readFileSync(new URL("../style.css", import.meta.url), "utf8")), "no Hosted Events JS (initEvents/renderEvents/eventSurveys) or CSS left");
assert(!/Hosted Events/.test(doc.getElementById("src-sources").textContent) && /Used on Overview and Team KPIs/.test(doc.getElementById("src-sources").textContent), "Sources tab: Internal Tracking now lists only Overview and Team KPIs");
assert(!/Repeat ACC|Repeat Account|Conversion Window/.test(doc.body.textContent), "no Repeat ACC / Repeat Account / Conversion Window text anywhere on the page");
assert(!/Booked Business/.test(doc.getElementById("page-overview").textContent), "Overview has no Booked Business reference");
window.showPage("overview");
// Old sidebar eyebrow ("Internal" + " BI") removed; pattern split so this file doesn't match its own grep
assert(![html, appJs, fs.readFileSync(new URL("../style.css", import.meta.url), "utf8")].some((t) => new RegExp("internal" + " bi", "i").test(t)), 'old sidebar eyebrow text appears nowhere in index.html / app.js / style.css');

// ---------- Section pages ----------
const SECTIONS = {
  team: { grids: ["team-kpiGrid"], filters: ["team-year"] },
  referrals: { grids: ["ref-kpiGrid"], filters: ["ref-year", "ref-manager"] },
  survey: { grids: ["sur-kpiGrid"], filters: ["sur-year", "sur-manager", "sur-question"] }
};
const sig = (page) => doc.getElementById("page-" + page).innerHTML;
for (const [page, cfg] of Object.entries(SECTIONS)) {
  const before = chartInstances;
  window.showPage(page);
  assert(doc.getElementById("page-" + page).classList.contains("active"), `${page}: page opens`);
  for (const g of cfg.grids) assert(doc.querySelectorAll(`#${g} .kpi-card`).length > 0, `${page}: #${g} renders KPI cards (${doc.querySelectorAll(`#${g} .kpi-card`).length})`);
  const canvases = [...doc.querySelectorAll(`#page-${page} canvas`)];
  assert(chartInstances - before >= canvases.length, `${page}: all ${canvases.length} charts drawn when the page opens`);
  assert(doc.getElementById(page + "-period").textContent.startsWith("Reporting period:") && doc.getElementById(page + "-period").classList.contains("tag-o"), `${page}: reporting-period pill set (${doc.getElementById(page + "-period").textContent})`);
  { const pg = doc.getElementById("page-" + page), kids = [...pg.children];
    assert(kids[0].classList.contains("page-h") && pg.querySelector(".page-h h2") && pg.querySelector(".page-h .src-pill") && kids[1].classList.contains("filter-row"), `${page}: title + source pill header, then the filter row`); }
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
// Oct 19, 2026: Team KPIs card order = Overview order; removed card gone; chart rows.
{ const labs = cardVals("team-kpiGrid").map((x) => x[0]);
  assert(labs.join("|") === "Planning Visits|Clients Serviced During Planning Visits|Partners Visited|Convention Groups Serviced|In House Groups Serviced" && labs.length === 5, `Team KPIs: exactly 5 cards in Overview order (${labs.join(" | ")})`);
  const tg = doc.getElementById("team-kpiGrid");
  assert(tg.querySelectorAll(".def-hint").length === 1 && tg.querySelectorAll(".kpi-card")[2].querySelector(".def-hint"), "Team KPIs: Partners Visited keeps its ? definition");
  const t = cardMap("team-kpiGrid"); assert(t["Clients Serviced During Planning Visits"] === "478", `Team KPIs: Clients Serviced During Planning Visits 2026 = 478 (${t["Clients Serviced During Planning Visits"]})`);
  // Oct 19, 2026 (later): the name now belongs to the Planning Visits clients-serviced metric (2nd card);
  // the old repeatingClients-based card stays removed, so there is exactly one such card.
  assert([...tg.querySelectorAll(".kpi-card .label")].filter((l) => l.textContent.includes("Clients Serviced During Planning Visits")).length === 1, "Team KPIs: exactly one 'Clients Serviced During Planning Visits' card");
  assert(!/DATA\.repeatingClients/.test(appJs), "app.js no longer reads repeatingClients");
  const r1 = doc.getElementById("team-row1"), r2 = doc.getElementById("team-row2");
  const heads = (r) => [...r.children].map((b) => b.querySelector("h3").childNodes[0].textContent.trim());
  assert(r1 && r2 && r1.classList.contains("grid2") && r2.classList.contains("grid2") && r1.children.length === 2 && r2.children.length === 2, "Team KPIs: two 2-column rows");
  assert(heads(r1).join("|") === "Partners Visited* & Planning Visits|Clients Serviced During Planning Visits" && r1.querySelector("#team-chart1") && r1.children[1].querySelector("#team-chart3"), `row 1: Partners Visited & Planning Visits, then Clients Serviced During Planning Visits (${heads(r1).join(" | ")})`);
  assert(heads(r2).join("|") === "Groups Serviced|Year over Year KPIs" && r2.children[0].querySelector("#team-chart2") && r2.children[1].querySelector("#team-yoyTable"), `row 2: Groups Serviced, then Year over Year KPIs (${heads(r2).join(" | ")})`);
  assert([...r1.children, ...r2.children].every((b) => b.querySelector(".auto-analysis").textContent.trim() && b.querySelector(".src")), "every Team KPIs visual keeps its auto-analysis sentence and source line");
  assert(r1.compareDocumentPosition(r2) & window.Node.DOCUMENT_POSITION_FOLLOWING, "row 1 comes before row 2 in reading order");
  assert(/\.grid2\.eq\{align-items:stretch;\}/.test(fs.readFileSync(new URL("../style.css", import.meta.url), "utf8")), "Team KPIs rows stretch cards to equal height"); }
// Oct 19, 2026: a year with no prior-year data says so (no column of zeros)
{ const ty = doc.getElementById("team-year"); ty.value = "2025"; ty.dispatchEvent(new window.Event("change"));
  const tb = doc.querySelector("#team-yoyTable tbody").textContent;
  assert(/No 2024 data to compare with/.test(tb) && doc.querySelectorAll("#team-yoyTable tbody tr").length === 1, `Team KPIs 2025: YoY table says there is no 2024 data (${tb.trim()})`);
  ty.value = "2026"; ty.dispatchEvent(new window.Event("change")); }
// Oct 19, 2026: Year dropdowns list only years with real data (no 2022)
{ const yrs = (rows, fields) => [...new Set(rows.filter((r) => fields.some((f) => r[f] !== null && r[f] !== undefined && r[f] !== "")).map((r) => String(r.year)))].sort();
  const exp = { "team-year": yrs(data.planningVisits, PVF), "ref-year": yrs(data.partnerReferrals.raw, ["date"]), "sur-year": yrs(data.accSurvey.raw, ["rating", "feedback"]) };
  for (const [id, e] of Object.entries(exp)) {
    const got = [...doc.getElementById(id).options].map((o) => o.value).filter((v) => v !== "All");
    console.log(`   #${id} years:`, got.join(","));
    assert(got.join() === e.join(), `#${id} lists only years with data (${got.join(",")})`);
  }
  assert(![...doc.querySelectorAll("select option")].some((o) => /2022/.test(o.value + o.textContent)) && !/2022/.test(fromEl.min + fromEl.max + toEl.min + toEl.max), "no 2022 option or date bound anywhere"); }
window.showPage("referrals");
{ const r = cardMap("ref-kpiGrid"); console.log("   referrals:", JSON.stringify(r));
  assert(r["Partner Referrals"] === "103", "Partner Referrals: 103 referrals (2026)"); }
window.showPage("survey");
{ const sv = cardVals("sur-kpiGrid"); console.log("   survey:", JSON.stringify(sv.map((x) => x.slice(0, 2))));
  assert(sv.length > 0 && /Team Experience/.test(doc.getElementById("sur-kpiGrid").textContent), "Client Survey keeps its team experience rating card"); }

window.showPage("sources");
assert(doc.getElementById("footSource").textContent === "Sources: Granicus, Association Insights and Internal Tracking.", "Sources tab footer lists all three sources");
window.showPage("overview");
assert(doc.getElementById("footSource").textContent === "Sources: Granicus and Internal Tracking.", "Overview footer source restored");
{ const f = [...doc.querySelectorAll("footer.ftr .wrap > span")].map((d) => d.textContent.trim());
  assert(f.length === 2 && f[0].startsWith("Sources:") && f[1] === "Powered by Visit Anaheim Business Intelligence Team", `footer: "Sources: ..." left, "Powered by Visit Anaheim Business Intelligence Team" right (${JSON.stringify(f)})`); }
assert([...doc.querySelectorAll("table.mini")].every((t) => t.parentElement.classList.contains("table-scroll")), "every table sits in its own .table-scroll container");
// ---------- Oct 16, 2026: data from Master.xlsx, approved/official (no draft wording) ----------
assert(typeof data.source === "string" && /Master\.xlsx/.test(data.source) && /BusinessIntelligence-Apps/.test(data.source), `data.json records its source workbook (${data.source})`);
assert(Array.isArray(data.planningVisits) && data.planningVisits.length > 0 && data.partnerReferrals.raw.length > 0 && data.accSurvey.raw.length > 0 && data.repeatingClients.raw.length > 0, "data.json has non-empty planningVisits / partnerReferrals / accSurvey / repeatingClients");
{ const bd = fs.readFileSync(new URL("../build_data.py", import.meta.url), "utf8");
  assert(/DEFAULT_SOURCE = os\.path\.join\(SCRIPT_DIR, "\.\.", "Master\.xlsx"\)/.test(bd) && !/Department KPIs\.xlsx/.test(bd), "build_data.py reads Master.xlsx by default (no Department KPIs.xlsx)");
  assert(/class SourceError/.test(bd) && /data\.json was NOT changed/.test(bd), "build_data.py stops with a clear error (no empty data) when a sheet/column is missing"); }
{ const m = doc.getElementById("src-master");
  assert(m && /Master\.xlsx/.test(m.textContent) && /SharePoint/.test(m.textContent) && /Business Intelligence-Apps/.test(m.textContent), "Sources tab names Master.xlsx in SharePoint (Business Intelligence-Apps) as the data source"); }
assert(!/\bdraft\b|pending approval/i.test(doc.body.textContent) && !/draft/i.test(doc.title), "no draft / pending-approval wording on the page");
{ const logo = doc.querySelector("img.logo");
  assert(logo && logo.getAttribute("src") === "visit-anaheim-teal.png" && fs.existsSync(new URL("../visit-anaheim-teal.png", import.meta.url)), "header logo is the root-level visit-anaheim-teal.png (flat repo, no brand/ folder needed)"); }
// ---------- Oct 19, 2026 (later): card labels -- no "# of", renamed clients card ----------
{ const tabs = ["overview", "team", "referrals", "survey", "q2q7", "sources"].filter((t) => doc.getElementById("page-" + t));
  const labels = [];
  for (const t of tabs) { window.showPage(t); doc.querySelectorAll(`#page-${t} .kpi-card .label`).forEach((l) => labels.push(t + ": " + l.textContent.trim())); }
  window.showPage("overview");
  console.log("   card labels:", labels.length);
  assert(labels.length >= 10 && !labels.some((l) => /#\s*of/i.test(l)), `no card label on any tab starts with / contains "# of" (${labels.filter((l) => /#/.test(l)).join(" | ")})`);
  assert(!/#\s*of\b/i.test(doc.body.textContent) && !/#\s*of\b/i.test(html), 'no "# of" anywhere in the page text or index.html');
  assert(!/(card|kpiCard)\("#/.test(appJs), 'no app.js card label starts with "#"');
  const ovLabs = cardVals("ov-kpiGrid").map((x) => x[0]);
  assert(ovLabs[1] === "Clients Serviced During Planning Visits" && ovLabs.length === 5, "Overview 2nd card = 'Clients Serviced During Planning Visits'");
  window.showPage("team");
  const tl = cardVals("team-kpiGrid").map((x) => x[0]);
  assert(tl[1] === "Clients Serviced During Planning Visits", "Team KPIs 2nd card = 'Clients Serviced During Planning Visits'");
  const rows = [...doc.querySelectorAll("#team-yoyTable tbody tr td:first-child")].map((td) => td.textContent.trim());
  assert(rows.includes("Clients Serviced During Planning Visits") && !rows.includes("Clients Serviced"), `Team KPIs YoY table row renamed (${rows.join(" | ")})`);
  assert(/clients during planning visits\./.test(doc.getElementById("team-analysis3").textContent), "Team KPIs clients chart sentence says 'during planning visits'");
  assert(!/Clients Serviced(?! During Planning Visits)/.test(doc.body.textContent.replace(/\s+/g, " ")) && !/Clients Serviced(?! During Planning Visits)/.test(html), "no bare 'Clients Serviced' label left on the page or in index.html");
  window.showPage("overview");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert(/\.ov-grid\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\);\}/.test(css) && /\.ov-tile \.tile-top \.label\{flex:1 1 auto;min-width:0;/.test(css) && /\.ov-tile \.tile-top \.drill-arrow\{flex:0 0 auto;\}/.test(css), "Overview tiles: 5-up row, label wraps, arrow stays top-right");
  const tk = [...doc.querySelectorAll("#ov-takeaways li")].map((l) => l.textContent);
  assert(tk.some((t) => /clients serviced during planning visits/.test(t)), `Overview takeaway uses the new name (${JSON.stringify(tk)})`); }
assert(errors.length === 0, `no runtime errors anywhere (${JSON.stringify(errors)})`);
console.log(`\nALL ${passed} CHECKS PASSED (${chartInstances} chart instances)`);
