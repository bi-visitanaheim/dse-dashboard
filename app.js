/* Destination Services & Events Dashboard -- app.js
   Layout (Oct 14, 2026): same shell as the Visit Anaheim Social Media
   Dashboard -- header band (logo, title, Export PDF), sticky horizontal tab
   bar (Overview | Team KPIs | Partner Referrals | Client Survey | Sources &
   Methodology), centered content, footer. Definitions, data sources and
   methodology sit on the Sources & Methodology tab.
   Oct 14, 2026: Hosted Events tab removed (no longer relevant); its code is
   saved in removed-hosted-events/ (not deployed). data.json still carries
   the event survey section, but app.js no longer reads it.
   Oct 14, 2026 layout (approved by John Picou, 2026-10-16): Overview
   shows five Planning Visits cards that drill down to Team KPIs; section
   pages are Team KPIs, Partner Referrals and Client Survey.
   Oct 16, 2026: data.json is now built from Master.xlsx (SharePoint,
   Business Intelligence-Apps) by build_data.py -- see README.md.
   Repeat ACC Accounts was retired, and Event Touchpoints to Booked Business
   moved to the Trade Shows & Events dashboard (original source saved in
   moved-to-trade-shows/). Reads data.json (built by build_data.py) at
   runtime via fetch("data.json") -- the monthly refresh (rerun
   build_data.py, re-upload data.json) needs no code changes here.
   The pre-restyle tabbed version is kept in legacy-tabs/ for rollback. */

/* =====================================================================
   OVERVIEW PAGE (Oct 14, 2026)
   ---------------------------------------------------------------------
   Five KPI cards, in this order: # of Planning Visits, # of Clients
   Serviced, # of Partners Visited, # of Convention Groups Serviced,
   # of In-House Groups Serviced. All five come from the monthly Planning
   Visits sheet and are driven by the From/To date-range picker:
     - current period = every month the picked From..To range touches
     - prior period   = the same months one year earlier
     - if the sheet's data ends before To, the window is clamped to the end
       of the latest populated month (prior-year window clamped the same
       way) and the card says so.
   Each card drills down to the Team KPIs page (click, Enter or Space).
   Default window: Jan 1 of the current year through the end of the latest
   populated Planning Visits month. Everything is read from data.json.
   ===================================================================== */
const OV = (function () {
  let OVD = null;           // trimmed rows for the Overview cards
  let DEFAULT_RANGE = null; // { from, to } ISO strings

  function ovFmt(n, dig) { dig = dig || 0; if (n === null || n === undefined || Number.isNaN(n)) return "&mdash;"; return Number(n).toLocaleString("en-US", { maximumFractionDigits: dig, minimumFractionDigits: dig }); }
  function ovPct(n, dig) { dig = dig === undefined ? 1 : dig; if (n === null || n === undefined || Number.isNaN(n)) return "&mdash;"; return (n * 100).toFixed(dig) + "%"; }
  function ovSum(arr, fn) { return arr.reduce((a, r) => a + (Number(fn(r)) || 0), 0); }
  function ovPctChange(a, b) { if (a == null || b == null || a === 0) return null; return (b - a) / a; }
  function ovDeltaClass(n) { if (n === null || n === undefined) return "flat"; return n > 0.001 ? "up" : n < -0.001 ? "down" : "flat"; }
  function ovDeltaArrow(n) { if (n === null || n === undefined) return ""; return n > 0.001 ? "&#9650; " : n < -0.001 ? "&#9660; " : "&#9679; "; }

  // ---- ISO date helpers (string-based, no timezone drift) ----
  function isValidIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function monthEndIso(iso) {
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return iso.slice(0, 7) + "-" + String(last).padStart(2, "0");
  }
  function shiftYear(iso, n) { return String(Number(iso.slice(0, 4)) + n).padStart(4, "0") + iso.slice(4); }
  function minIso(a, b) { return a < b ? a : b; }
  function longDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function rangeText(from, to) { return longDate(from) + " &ndash; " + longDate(to); }

  // Latest populated date in a sheet (optionally requiring a non-null field,
  // e.g. Planning Visits pre-creates an empty placeholder row for next month).
  function latestDate(rows, field, chk) {
    let best = null;
    rows.forEach(r => {
      const v = r[field];
      if (!isValidIso(v)) return;
      if (chk && (r[chk] === null || r[chk] === undefined)) return;
      if (best === null || v > best) best = v;
    });
    return best;
  }

  // Builds the current/prior row sets for one sheet and the picked range.
  function windowRows(rows, field, chk, from, to, monthly) {
    const latest = latestDate(rows, field, chk);
    if (!latest) return { cur: [], pri: [], effTo: null, clamped: false, empty: true };
    const dataEnd = monthEndIso(latest);
    const effTo = minIso(to, dataEnd);
    const clamped = effTo < to;
    if (effTo < from) return { cur: [], pri: [], effTo, clamped, empty: true };
    const pFrom = shiftYear(from, -1), pTo = shiftYear(effTo, -1);
    let inCur, inPri;
    if (monthly) {
      const f = from.slice(0, 7), t = effTo.slice(0, 7), pf = pFrom.slice(0, 7), pt = pTo.slice(0, 7);
      inCur = v => { const k = v.slice(0, 7); return k >= f && k <= t; };
      inPri = v => { const k = v.slice(0, 7); return k >= pf && k <= pt; };
    } else {
      inCur = v => v >= from && v <= effTo;
      inPri = v => v >= pFrom && v <= pTo;
    }
    const cur = rows.filter(r => isValidIso(r[field]) && inCur(r[field]));
    const pri = rows.filter(r => isValidIso(r[field]) && inPri(r[field]));
    return { cur, pri, effTo, clamped, empty: false };
  }

  // Maps data.json (exact shape produced by build_data.py) to the few
  // columns the Overview needs. No field names are changed in data.json.
  function buildOverviewData(DATA) {
    return {
      pv: (DATA.planningVisits || []).map(r => ({ date: r.date, pv: r.planningVisits, cs: r.clientsServiced, pw: r.partnersVisited, cg: r.conventionGroupsServiced, ih: r.inHouseGroupsServiced }))
    };
  }

  function computeDefaultRange(D, generatedAt) {
    const pvLatest = latestDate(D.pv, "date", "pv");
    const to = pvLatest ? monthEndIso(pvLatest) : (isValidIso(generatedAt) ? generatedAt : new Date().toISOString().slice(0, 10));
    return { from: to.slice(0, 4) + "-01-01", to };
  }

  // Overview cards, in the order requested (Oct 14, 2026). Every card drills
  // down to the Team KPIs page, where all five metrics have charts and a
  // YoY table.
  const OV_DRILL = { page: "team", title: "Team KPIs" };
  function computeOverview(from, to) {
    const pvW = windowRows(OVD.pv, "date", "pv", from, to, true);
    function card(label, short, calc, def) {
      return { label, short, def, w: pvW, cur: pvW.empty ? null : calc(pvW.cur), pri: pvW.empty ? null : calc(pvW.pri), fmtFn: v => ovFmt(v) };
    }
    return [
      card("# of Planning Visits", "Planning Visits", rs => ovSum(rs, r => r.pv)),
      card("# of Clients Serviced", "Clients Serviced", rs => ovSum(rs, r => r.cs)),
      card("# of Partners Visited", "Partners Visited", rs => ovSum(rs, r => r.pw), "A partner property visited in person during a planning visit."),
      card("# of Convention Groups Serviced", "Convention Groups Serviced", rs => ovSum(rs, r => r.cg)),
      card("# of In-House Groups Serviced", "In-House Groups Serviced", rs => ovSum(rs, r => r.ih))
    ];
  }

  function toggleDef(id) {
    document.querySelectorAll(".def-pop").forEach(el => { if (el.id !== id) el.classList.remove("open"); });
    const el = document.getElementById(id);
    if (el) el.classList.toggle("open");
    document.querySelectorAll(".def-btn[aria-controls]").forEach(b => {
      const pop = document.getElementById(b.getAttribute("aria-controls"));
      b.setAttribute("aria-expanded", pop && pop.classList.contains("open") ? "true" : "false");
    });
  }

  function readRange() {
    const fEl = document.getElementById("ovFrom"), tEl = document.getElementById("ovTo");
    let from = isValidIso(fEl.value) ? fEl.value : DEFAULT_RANGE.from;
    let to = isValidIso(tEl.value) ? tEl.value : DEFAULT_RANGE.to;
    if (from > to) { const t = from; from = to; to = t; }
    fEl.value = from; tEl.value = to;
    return { from, to };
  }

  // Overview render (simplified Oct 14, 2026 for non-technical readers):
  // big number, short label, one plain "vs. last year" line per tile; at
  // most three one-sentence takeaways; no source, cutoff or method text
  // (those live on the Sources & Methodology tab).
  function plainDelta(dd) {
    if (dd === null) return "New this year, nothing to compare yet";
    if (dd >= 0.005) return "Up " + ovPct(Math.abs(dd), 0) + " vs. last year";
    if (dd <= -0.005) return "Down " + ovPct(Math.abs(dd), 0) + " vs. last year";
    return "About the same as last year";
  }
  function render() {
    const { from, to } = readRange();
    const cats = computeOverview(from, to);
    const html = cats.map((c, i) => {
      const dd = c.w.empty ? null : ovPctChange(c.pri, c.cur);
      const delta = c.w.empty
        ? `<div class="delta flat">No data in this date range</div>`
        : `<div class="delta ${dd !== null && Math.abs(dd) < 0.005 ? "flat" : ovDeltaClass(dd)}">${dd === null || Math.abs(dd) < 0.005 ? "" : ovDeltaArrow(dd)}${plainDelta(dd)}</div>`;
      const defBtn = c.def ? `<button type="button" class="def-btn kpi-def" aria-label="What does ${c.short} mean?" aria-controls="def-${i}" aria-expanded="false" onclick="event.stopPropagation();toggleDef('def-${i}')">?</button>` : "";
      const pop = c.def ? `<div class="def-pop" id="def-${i}" role="note">${c.def}</div>` : "";
      return `<div class="kpi-wrap${c.def ? " has-def" : ""}">
      <div class="kpi-card drill ov-tile" role="button" tabindex="0" data-goto="${OV_DRILL.page}" data-metric="${c.short}">
        <div class="tile-top"><div class="label">${c.label}</div><span class="drill-arrow" aria-hidden="true">&rarr;</span></div>
        <div class="value">${c.fmtFn(c.cur)}</div>
        ${delta}
        <span class="sr-only">Open the ${OV_DRILL.title} page for ${c.short} details.</span>
      </div>
      ${defBtn}
      ${pop}
    </div>`;
    }).join("");
    document.getElementById("ov-kpiGrid").innerHTML = html;

    // Key takeaways: at most three one-sentence bullets, number in bold.
    const tk = cats.filter(c => !c.w.empty).slice(0, 3).map(c => {
      const dd = ovPctChange(c.pri, c.cur);
      const name = c.short.toLowerCase();
      let cmp;
      if (dd === null) cmp = ", the first year this is counted.";
      else if (dd >= 0.005) cmp = `, up ${ovPct(Math.abs(dd), 0)} compared with last year.`;
      else if (dd <= -0.005) cmp = `, down ${ovPct(Math.abs(dd), 0)} compared with last year.`;
      else cmp = ", about the same as last year.";
      return `<li><b>${c.fmtFn(c.cur)}</b> ${name}${cmp}</li>`;
    });
    document.getElementById("ov-takeaways").innerHTML = tk.length ? tk.join("") : "<li>No numbers yet for these dates.</li>";

    // Period pill: the dates in plain words (shortened to the latest month
    // with numbers when the picked range runs past it).
    const w = cats[0].w;
    document.getElementById("ovPeriodTag").innerHTML = (!w.empty && w.clamped)
      ? rangeText(from, w.effTo) + " (latest numbers)"
      : rangeText(from, to);
  }

  // Drill-down: Overview KPI tiles open Team KPIs.
  function bindDrill() {
    const go = el => { if (el && el.dataset.goto) showPage(el.dataset.goto); };
    document.getElementById("ov-kpiGrid").addEventListener("click", e => {
      if (e.target.closest(".def-btn") || e.target.closest(".def-pop")) return;
      go(e.target.closest("[data-goto]"));
    });
    document.getElementById("ov-kpiGrid").addEventListener("keydown", e => {
      const card = e.target.closest(".kpi-card.drill");
      if (!card || e.target !== card) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); go(card); }
    });
  }

  function init(DATA) {
    OVD = buildOverviewData(DATA);
    DEFAULT_RANGE = computeDefaultRange(OVD, DATA.generatedAt);
    document.getElementById("refreshedAt").textContent = DATA.generatedAt || "";
    const fEl = document.getElementById("ovFrom"), tEl = document.getElementById("ovTo");
    fEl.value = DEFAULT_RANGE.from; tEl.value = DEFAULT_RANGE.to;
    fEl.addEventListener("change", render);
    tEl.addEventListener("change", render);
    document.getElementById("ovReset").addEventListener("click", () => {
      fEl.value = DEFAULT_RANGE.from; tEl.value = DEFAULT_RANGE.to; render();
    });
    document.addEventListener("click", e => {
      if (!e.target.closest(".def-btn") && !e.target.closest(".def-pop")) {
        document.querySelectorAll(".def-pop").forEach(el => el.classList.remove("open"));
        document.querySelectorAll(".def-btn[aria-expanded]").forEach(b => b.setAttribute("aria-expanded", "false"));
      }
    });
    bindDrill();
    { const more = document.getElementById("ovSeeSources"); if (more) more.addEventListener("click", () => showPage("sources")); }
    render();
  }

  return { init, render, toggleDef, computeOverview, getDefaultRange: () => DEFAULT_RANGE };
})();
window.toggleDef = OV.toggleDef;

// ---- Tab navigation (Social Media Dashboard layout, Oct 14, 2026) ----
// One sticky horizontal tab bar; each tab shows one .page. The active tab
// carries aria-current="true" (and .active for styling/tests).
function showPage(id) {
  if (!document.getElementById("page-" + id)) id = "overview";
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + id));
  document.querySelectorAll(".tab[data-page]").forEach(b => {
    const on = b.dataset.page === id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "true" : "false");
    if (on && b.scrollIntoView && b.parentElement && b.parentElement.scrollWidth > b.parentElement.clientWidth) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  window.scrollTo(0, 0);
  if (window.onSectionShow) window.onSectionShow(id);
}
window.showPage = showPage;
document.querySelectorAll(".tab[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
{ const ex = document.getElementById("exportPdf"); if (ex) ex.addEventListener("click", () => window.print()); }

/* =====================================================================
   SECTION PAGES
   Everything from "const COLORS" down to the adapter layer is the
   pre-restyle production app.js logic, unchanged (same formulas, same
   filters, same data.json fields).
   ===================================================================== */
const Sections = (function () {
// Chart tokens follow the Trade Show App globals.css (Oct 2026): series 1
// Escapism 03, series 2 Escapism 01, series 3 Escapism 02, prior/4th
// Escapism 04; hairline gridlines; axis text in ink-soft.
const COLORS = {
  navy: "#125C60", teal: "#43A3A3", tealLight: "#77C7C9", pale: "#B4D9E3",
  text: "#231F20", bg: "#F9F9F2",
  grid: "#E3E2DA", muted: "#4A4647",
  seriesA: "#125C60", seriesB: "#43A3A3", seriesC: "#77C7C9", seriesD: "#B4D9E3"
};
const YEAR_PALETTE = { 2023: "#B4D9E3", 2024: "#77C7C9", 2025: "#43A3A3", 2026: "#125C60" };

Chart.defaults.font.family = "'Sharp Sans Disp No2','Sharp Sans Display No2','Proxima Nova',system-ui,sans-serif";
Chart.defaults.color = COLORS.muted;
Chart.defaults.borderColor = COLORS.grid;

// ---------- data labels (every chart, dashboard-wide) ----------
if (typeof ChartDataLabels !== "undefined") Chart.register(ChartDataLabels);
// Dark brand colors need white labels; light ones need the near-black text color.
function labelContrast(hex) {
  return (hex === COLORS.navy || hex === COLORS.teal) ? "#ffffff" : COLORS.text;
}
function numberLabel(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const num = typeof value === "object" ? (value.y ?? value.r ?? value.v ?? null) : value;
  if (typeof num !== "number" || Number.isNaN(num)) return "";
  return Number.isInteger(num) ? num.toLocaleString("en-US") : num.toFixed(1);
}
Chart.defaults.set("plugins.datalabels", {
  color: COLORS.text,
  anchor: "end",
  align: "end",
  offset: 2,
  clamp: true,
  font: { size: 10, weight: "700" },
  formatter: numberLabel
});

let DATA = null;
const CHARTS = {};

// ---------- generic helpers ----------
function destroyChart(id) { if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; } }
function makeChart(id, config) {
  const el = document.getElementById(id);
  if (!el) return;
  destroyChart(id);
  CHARTS[id] = new Chart(el, config);
}
function fmt(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "&mdash;";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function pct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "&mdash;";
  return (n * 100).toFixed(digits) + "%";
}
function deltaClass(n) { if (n === null || n === undefined) return "flat"; return n > 0.001 ? "up" : n < -0.001 ? "down" : "flat"; }
function deltaArrow(n) { if (n === null || n === undefined) return ""; return n > 0.001 ? "&#9650; " : n < -0.001 ? "&#9660; " : "&#9679; "; }
function pctChange(a, b) { if (a === null || a === undefined || b === null || b === undefined || a === 0) return null; return (b - a) / a; }
function sum(arr, fn) { return arr.reduce((s, r) => s + (Number(fn(r)) || 0), 0); }
function mean(arr, fn) {
  const vals = arr.map(fn).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function distinctCount(arr, fn) { return new Set(arr.map(fn).filter(v => v !== null && v !== undefined)).size; }
function groupBy(arr, keyFn) {
  const m = new Map();
  arr.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return m;
}
function monthKey(iso) { return iso.slice(0, 7); }
function monthLabel(m) { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }
function kpiCard(label, value, deltaText, deltaCls, dateRange, cardClass, note, extraAttrs) {
  return `<div class="kpi-card${cardClass ? " " + cardClass : ""}"${extraAttrs ? " " + extraAttrs : ""}><div class="label">${label}</div><div class="value">${value}</div>${deltaText ? `<div class="delta ${deltaCls || ""}">${deltaText}</div>` : ""}${note ? `<div class="daterange">${note}</div>` : ""}${dateRange ? `<div class="daterange">${dateRange}</div>` : ""}</div>`;
}
// "Jan 3, 2023 – Jun 12, 2026" -- for tabs other than Overview, whose KPI
// cards aren't a fixed YTD window: shows the actual earliest-to-latest date
// covered by the rows feeding the card, dynamic with whatever filters
// (Year/Manager/etc.) are currently applied on that tab.
function isoRangeToLabel(startIso, endIso) {
  function f(iso) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return `${f(startIso)} &ndash; ${f(endIso)}`;
}
function rangeLabel(rows, dateField) {
  const dates = rows.map(r => r[dateField]).filter(Boolean).sort();
  if (!dates.length) return "";
  return isoRangeToLabel(dates[0], dates[dates.length - 1]);
}
// Same as rangeLabel, but first excludes rows where none of `checkFields`
// have a real value -- e.g. Planning Visits pre-creates a placeholder row
// for the upcoming month before it has real numbers, which would otherwise
// stretch the range a month past the actual data.
function rangeLabelFiltered(rows, dateField, checkFields) {
  const valid = rows.filter(r => checkFields.some(f => r[f] !== null && r[f] !== undefined));
  return rangeLabel(valid, dateField);
}
function getYears(arr) { return [...new Set(arr.map(r => r.year).filter(Boolean))].sort(); }
// "Select All" is the display label for every filter's all-inclusive option
// dashboard-wide (value stays "All" so existing filter logic/tests don't need
// to change, only the visible text).
const SELECT_ALL_OPTION = `<option value="All">Select All</option>`;
function populateYearSelect(sel, years, onChange) {
  sel.innerHTML = SELECT_ALL_OPTION + years.map(y => `<option value="${y}">${y}</option>`).join("");
  sel.value = "All";
  sel.onchange = onChange;
}
function byYear(arr, year) { return year === "All" ? arr : arr.filter(r => String(r.year) === String(year)); }
function latestTwoYears(years) {
  const sorted = [...years].sort((a, b) => a - b);
  const latest = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2];
  return { prior, latest };
}
// Wraps long text into an array of lines (Chart.js renders string-array tick
// labels as multi-line) so category labels don't need to be truncated.
function wrapLabel(str, maxLen = 34) {
  if (!str) return str;
  const words = String(str).split(" ");
  const lines = [];
  let cur = "";
  words.forEach(w => {
    if ((cur + " " + w).trim().length > maxLen && cur) { lines.push(cur.trim()); cur = w; }
    else { cur = (cur + " " + w).trim(); }
  });
  if (cur) lines.push(cur);
  return lines;
}
// ---------- cross-chart month click-to-highlight (per tab) ----------
const MONTH_LINK_STATE = {};
function fadeColor(color) {
  if (typeof color !== "string" || !color.startsWith("#")) return color;
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7),16);
  return `rgba(${r},${g},${b},0.22)`;
}
function bindMonthLink(tabKey, chartIds) {
  MONTH_LINK_STATE[tabKey] = null;
  const charts = chartIds.map(id => CHARTS[id]).filter(Boolean);
  charts.forEach(chart => {
    chart.canvas.style.cursor = "pointer";
    chart.canvas.onclick = (evt) => {
      const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
      if (!points.length) return;
      const label = chart.data.labels[points[0].index];
      MONTH_LINK_STATE[tabKey] = (MONTH_LINK_STATE[tabKey] === label) ? null : label;
      applyMonthHighlight(charts, MONTH_LINK_STATE[tabKey]);
    };
  });
  applyMonthHighlight(charts, null);
}
function applyMonthHighlight(charts, selected) {
  charts.forEach(chart => {
    const labels = chart.data.labels;
    chart.data.datasets.forEach(ds => {
      if (!ds._baseColor) ds._baseColor = ds.backgroundColor;
      ds.backgroundColor = selected ? labels.map(l => l === selected ? ds._baseColor : fadeColor(ds._baseColor)) : ds._baseColor;
    });
    chart.update();
  });
}
// Partner Referrals tab: a two-dimension version of the month-link above.
// "By Staff" (ref-chart1) has staff on its x-axis with no month dimension;
// "by Month" (ref-chart2) has month on its x-axis with no staff dimension;
// "Monthly Referrals by Staff" (ref-chart3) has month on its x-axis with one
// dataset per staff member, so it's the only chart that can show either kind
// of selection. Clicking a bar in ref-chart1 selects a staff member (fades
// non-matching bars there, and fades non-matching *datasets* in ref-chart3).
// Clicking a bar in ref-chart2 or ref-chart3 selects a month (fades
// non-matching bars/segments there). The two selections are independent and
// can be combined.
const REF_LINK_STATE = { month: null, staff: null };
function bindReferralsLink() {
  const c1 = CHARTS["ref-chart1"], c2 = CHARTS["ref-chart2"], c3 = CHARTS["ref-chart3"];
  if (!c1 || !c2 || !c3) return;
  REF_LINK_STATE.month = null;
  REF_LINK_STATE.staff = null;

  function apply() {
    const ds1 = c1.data.datasets[0];
    if (!ds1._baseColor) ds1._baseColor = ds1.backgroundColor;
    ds1.backgroundColor = REF_LINK_STATE.staff
      ? c1.data.labels.map(l => l === REF_LINK_STATE.staff ? ds1._baseColor : fadeColor(ds1._baseColor))
      : ds1._baseColor;
    c1.update();

    const ds2 = c2.data.datasets[0];
    if (!ds2._baseColor) ds2._baseColor = ds2.backgroundColor;
    ds2.backgroundColor = REF_LINK_STATE.month
      ? c2.data.labels.map(l => l === REF_LINK_STATE.month ? ds2._baseColor : fadeColor(ds2._baseColor))
      : ds2._baseColor;
    c2.update();

    c3.data.datasets.forEach(ds => {
      if (!ds._baseColor) ds._baseColor = ds.backgroundColor;
      const staffMatches = !REF_LINK_STATE.staff || ds.label === REF_LINK_STATE.staff;
      if (!staffMatches) {
        ds.backgroundColor = fadeColor(ds._baseColor);
      } else if (REF_LINK_STATE.month) {
        ds.backgroundColor = c3.data.labels.map(l => l === REF_LINK_STATE.month ? ds._baseColor : fadeColor(ds._baseColor));
      } else {
        ds.backgroundColor = ds._baseColor;
      }
    });
    c3.update();
  }

  c1.canvas.style.cursor = "pointer";
  c1.canvas.onclick = (evt) => {
    const points = c1.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
    if (!points.length) return;
    const label = c1.data.labels[points[0].index];
    REF_LINK_STATE.staff = REF_LINK_STATE.staff === label ? null : label;
    apply();
  };
  [c2, c3].forEach(chart => {
    chart.canvas.style.cursor = "pointer";
    chart.canvas.onclick = (evt) => {
      const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
      if (!points.length) return;
      const label = chart.data.labels[points[0].index];
      REF_LINK_STATE.month = REF_LINK_STATE.month === label ? null : label;
      apply();
    };
  });

  apply();
}

// Each tab pulls from a different mix of source systems, so the footer's
// "Source:" line updates to match whichever tab is currently active.
const TAB_SOURCES = {
  overview: "Granicus and Internal Tracking",
  team: "Granicus and Internal Tracking",
  referrals: "Granicus",
  survey: "Association Insights",
  sources: "Granicus, Association Insights and Internal Tracking"
};
// =====================================================================
// DATE HELPERS (shared by the section pages)
// =====================================================================
function monthOf(dateStr) { const n = dateStr ? Number(String(dateStr).slice(5, 7)) : NaN; return Number.isNaN(n) ? null : n; }
// Year is derived directly from the same date field used for the month check
// (not a separate pre-baked `r.year`) so each metric can be filtered by
// whichever date column it's actually supposed to use. See README.md
// "Data source mapping" for the full list.
function yearOf(dateStr) { const n = dateStr ? Number(String(dateStr).slice(0, 4)) : NaN; return Number.isNaN(n) ? null : n; }
function ytdCutoff(rowsInYear, dateField) {
  const months = rowsInYear.map(r => monthOf(r[dateField])).filter(m => m !== null);
  return months.length ? Math.max(...months) : 12;
}
// "YYYY-MM-DD" -> "MM/DD/YYYY", for the Partner Referrals detail table.
function mdy(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}
function ytdRows(rows, dateField, year, cutoff) {
  return rows.filter(r => yearOf(r[dateField]) === year && monthOf(r[dateField]) !== null && monthOf(r[dateField]) <= cutoff);
}
// =====================================================================
// TEAM KPIs
// =====================================================================
function initTeam() {
  const sel = document.getElementById("team-year");
  const years = getYears(DATA.planningVisits);
  populateYearSelect(sel, years, () => renderTeam(sel.value));
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  sel.value = defaultYear;
  renderTeam(defaultYear);
}
function renderTeam(year) {
  const all = DATA.planningVisits;
  const rows = byYear(all, year);

  // Dynamic date-range subtitle (see rangeLabelFiltered) -- reflects the
  // actual earliest-to-latest populated month for the selected Year filter,
  // skipping the placeholder future-month row that has no real data yet.
  const teamRange = rangeLabelFiltered(rows, "date", ["partnersVisited", "planningVisits", "conventionGroupsServiced", "inHouseGroupsServiced", "clientsServiced"]);

  // YoY % delta on every card -- same YTD-cutoff methodology as the Overview
  // tab's own cards (see ytdYoyMetric), not a full-year comparison. This
  // naturally becomes a full-year comparison on its own whenever the
  // selected/latest year is a complete past year (see that function's
  // comment for why).
  const { prior: teamPrior, latest: teamLatest } = resolveYoyYears(all, year);
  function teamYoy(fieldFn) { return ytdYoyMetric(all, "date", teamLatest, teamPrior, ["planningVisits"], rs => sum(rs, fieldFn)); }
  const dPartnersV = teamYoy(r => r.partnersVisited);
  const dPlanningV = teamYoy(r => r.planningVisits);
  const dConvV = teamYoy(r => r.conventionGroupsServiced);
  const dInHouseV = teamYoy(r => r.inHouseGroupsServiced);
  const dClientsV = teamYoy(r => r.clientsServiced);

  // "Clients Serviced During Planning Visits" -- moved here from the former
  // Repeat ACC Accounts tab (retired Oct 14, 2026) so it sits next to
  // Planning Visits, since this counts the clients who attend each planning
  // visit (a distinct metric from "Clients Serviced" below, which is the
  // planning-visits sheet's own per-visit client count). Pulls from the same
  // repeatingClients dataset (Granicus, Repeating ACC Clients Services),
  // filtered by this tab's own Year selector (on startDate).
  const repRowsForTeam = byYear(DATA.repeatingClients.raw, year);
  const teamClientsServicedDuringVisits = repRowsForTeam.length;
  const { prior: repPriorY, latest: repLatestY } = resolveYoyYears(DATA.repeatingClients.raw, year);
  const dClientsServicedVisits = ytdYoyMetric(DATA.repeatingClients.raw, "startDate", repLatestY, repPriorY, null, rs => rs.length);

  document.getElementById("team-kpiGrid").innerHTML = [
    kpiCard("Partners Visited* <button type=\"button\" class=\"def-hint\" data-def=\"A partner property visited in person during a planning visit.\">?</button>", fmt(sum(rows, r => r.partnersVisited)), ytdDeltaText(dPartnersV, fmt), deltaClass(dPartnersV.d), teamRange),
    kpiCard("Planning Visits", fmt(sum(rows, r => r.planningVisits)), ytdDeltaText(dPlanningV, fmt), deltaClass(dPlanningV.d), teamRange),
    kpiCard("Clients Serviced During Planning Visits <button type=\"button\" class=\"def-hint\" data-def=\"Counts the clients who attend each planning visit.\">?</button>", fmt(teamClientsServicedDuringVisits), ytdDeltaText(dClientsServicedVisits, fmt), deltaClass(dClientsServicedVisits.d), teamRange),
    kpiCard("Convention Groups Serviced", fmt(sum(rows, r => r.conventionGroupsServiced)), ytdDeltaText(dConvV, fmt), deltaClass(dConvV.d), teamRange),
    kpiCard("In House Groups Serviced*", fmt(sum(rows, r => r.inHouseGroupsServiced)), ytdDeltaText(dInHouseV, fmt), deltaClass(dInHouseV.d), teamRange),
    kpiCard("Clients Serviced", fmt(sum(rows, r => r.clientsServiced)), ytdDeltaText(dClientsV, fmt), deltaClass(dClientsV.d), teamRange)
  ].join("");

  const labels = rows.map(r => monthLabel(r.date.slice(0, 7)));
  // Extra top padding on all three charts so a bar's data label never gets
  // clipped by the chart area's edge when that bar is near the tallest on
  // the chart (same fix as the Client Survey "Avg. Rating by DS&E Manager" chart).
  makeChart("team-chart1", {
    data: { labels, datasets: [
      { type: "bar", label: "Partners Visited*", data: rows.map(r => r.partnersVisited), backgroundColor: COLORS.seriesA, borderRadius: 4 },
      { type: "bar", label: "Planning Visits", data: rows.map(r => r.planningVisits), backgroundColor: COLORS.seriesB, borderRadius: 4 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } }
  });
  makeChart("team-chart2", {
    data: { labels, datasets: [
      { type: "bar", label: "Convention Groups Serviced", data: rows.map(r => r.conventionGroupsServiced), backgroundColor: COLORS.seriesB, borderRadius: 4 },
      { type: "bar", label: "In House Groups Serviced*", data: rows.map(r => r.inHouseGroupsServiced), backgroundColor: COLORS.seriesA, borderRadius: 4 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } }
  });
  makeChart("team-chart3", {
    type: "bar",
    data: { labels, datasets: [{ label: "Clients Serviced", data: rows.map(r => r.clientsServiced), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  renderYoyTable("team-yoyTable", all, [
    { label: "Partners Visited*", fn: r => r.partnersVisited },
    { label: "Planning Visits", fn: r => r.planningVisits },
    { label: "Convention Groups Serviced", fn: r => r.conventionGroupsServiced },
    { label: "In House Groups Serviced*", fn: r => r.inHouseGroupsServiced },
    { label: "Clients Serviced", fn: r => r.clientsServiced }
  ], year, "date", ["planningVisits"]);

  bindMonthLink("team", ["team-chart1", "team-chart2", "team-chart3"]);

  // Automated 1-sentence analysis per chart. For the current/latest year (or
  // "All"), this states the latest *populated* month's figures (the sheet
  // pre-creates a placeholder row for the upcoming month before it has real
  // numbers, so this skips back past any trailing null row instead of
  // reporting blanks). For a completed past year, a "latest month" doesn't
  // mean much -- it just states that year's full-year totals instead, so a
  // metric that happens to be entirely null for a stretch of that year
  // (e.g. Partners Visited wasn't tracked at all in 2025) doesn't fall back
  // to "no data available" when the year overall does have real data.
  if (isPastYear(all, year)) {
    document.getElementById("team-analysis1").innerHTML = `In <strong>${year}</strong>, the team logged a total of <strong>${fmt(sum(rows, r => r.partnersVisited))}</strong> partner visits and <strong>${fmt(sum(rows, r => r.planningVisits))}</strong> planning visits.`;
    document.getElementById("team-analysis2").innerHTML = `In <strong>${year}</strong>, the team serviced a total of <strong>${fmt(sum(rows, r => r.conventionGroupsServiced))}</strong> convention groups and <strong>${fmt(sum(rows, r => r.inHouseGroupsServiced))}</strong> in-house groups.`;
    document.getElementById("team-analysis3").innerHTML = `In <strong>${year}</strong>, the team serviced a total of <strong>${fmt(sum(rows, r => r.clientsServiced))}</strong> clients.`;
  } else {
    const latest1 = latestRowWithData(rows, ["partnersVisited", "planningVisits"]);
    const latest2 = latestRowWithData(rows, ["conventionGroupsServiced", "inHouseGroupsServiced"]);
    const latest3 = latestRowWithData(rows, ["clientsServiced"]);
    document.getElementById("team-analysis1").innerHTML = latest1
      ? `In <strong>${monthLabel(latest1.date.slice(0, 7))}</strong>, the team logged <strong>${fmt(latest1.partnersVisited)}</strong> partner visits and <strong>${fmt(latest1.planningVisits)}</strong> planning visits.`
      : "No data available for this period yet.";
    document.getElementById("team-analysis2").innerHTML = latest2
      ? `In <strong>${monthLabel(latest2.date.slice(0, 7))}</strong>, the team serviced <strong>${fmt(latest2.conventionGroupsServiced)}</strong> convention groups and <strong>${fmt(latest2.inHouseGroupsServiced)}</strong> in-house groups.`
      : "No data available for this period yet.";
    document.getElementById("team-analysis3").innerHTML = latest3
      ? `In <strong>${monthLabel(latest3.date.slice(0, 7))}</strong>, the team serviced <strong>${fmt(latest3.clientsServiced)}</strong> clients.`
      : "No data available for this period yet.";
  }

  document.getElementById("team-yoy-analysis").innerHTML = yoyAnalysisSentence(all, [
    { label: "Partners Visited", fn: r => r.partnersVisited },
    { label: "Planning Visits", fn: r => r.planningVisits },
    { label: "Convention Groups Serviced", fn: r => r.conventionGroupsServiced },
    { label: "In House Groups Serviced", fn: r => r.inHouseGroupsServiced },
    { label: "Clients Serviced", fn: r => r.clientsServiced }
  ], year, "date", ["planningVisits"]);

  setReportingPeriod("team", teamRange);
}
// True when a specific, already-completed past year is selected (not "All"
// and not the latest year present in the data) -- used to switch the
// auto-analysis sentences from "latest month" to "full year" phrasing.
function isPastYear(rows, selectedYear) {
  if (!selectedYear || selectedYear === "All") return false;
  const years = getYears(rows);
  const maxYear = years.length ? Math.max(...years) : null;
  return maxYear !== null && Number(selectedYear) < maxYear;
}
// Walks a row list (sorted ascending by dateField) backward to find the
// latest row where every one of the given fields has a real (non-null)
// value -- used dashboard-wide for the "latest month" auto-analysis
// sentences, so a placeholder row for an upcoming month (all metrics still
// null) never gets reported as if it were real data.
function latestRowWithData(rows, fields, dateField = "date") {
  const sorted = [...rows].sort((a, b) => (a[dateField] || "").localeCompare(b[dateField] || ""));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i];
    if (fields.every(f => r[f] !== null && r[f] !== undefined)) return r;
  }
  return null;
}
// Finds the item in `list` with the largest `valFn(item)`, skipping
// null/undefined values -- used for "top staff/manager/event/status" style
// auto-analysis sentences on charts that aren't month-based.
function topEntry(list, valFn) {
  let best = null;
  list.forEach(item => {
    const v = valFn(item);
    if (v !== null && v !== undefined && !Number.isNaN(v) && (best === null || v > best.v)) best = { item, v };
  });
  return best;
}
// Resolves which two years a YoY comparison covers: a specific selected year
// vs. the year immediately before it, or (when the Year filter is "All") the
// two most recent years actually present in the data.
function resolveYoyYears(rows, selectedYear) {
  const years = getYears(rows);
  if (selectedYear && selectedYear !== "All") { const latest = Number(selectedYear); return { prior: latest - 1, latest }; }
  return latestTwoYears(years);
}
// The same year-to-date-cutoff methodology used for the Overview tab's own
// 12 KPI cards, generalized for reuse everywhere else on the dashboard: the
// cutoff month is the latest month with real data in `curYear` (skipping any
// month whose row exists but is still a null placeholder, per
// `cutoffCheckFields`), and `priYear` is compared over that identical
// Jan-1-through-cutoff window rather than its own full 12 months. For a
// *complete* past year, every month has data, so the cutoff naturally
// resolves to December and this becomes an ordinary full-year comparison --
// so this one formula correctly handles both "a finished past year is
// selected" and "the current, still-in-progress year is selected" without
// needing separate logic for each case.
function ytdYoyMetric(allRows, dateField, curYear, priYear, cutoffCheckFields, metricFn) {
  if (curYear === undefined || priYear === undefined) return { curVal: null, priVal: null, d: null, curYear, priYear, cutoff: null };
  const curYearRows = allRows.filter(r => r.year === curYear);
  const cutoffRows = cutoffCheckFields ? curYearRows.filter(r => cutoffCheckFields.some(f => r[f] !== null && r[f] !== undefined)) : curYearRows;
  const cutoff = ytdCutoff(cutoffRows, dateField);
  const curYtd = ytdRows(allRows, dateField, curYear, cutoff);
  const priYtd = ytdRows(allRows, dateField, priYear, cutoff);
  const curVal = metricFn(curYtd);
  const priVal = metricFn(priYtd);
  return { curVal, priVal, d: pctChange(priVal, curVal), curYear, priYear, cutoff };
}
// Renders a ytdYoyMetric result as the same delta-text format Overview's
// cards use: "▲ 12.3% vs. 2025 YTD". (Prior to September 2026 this also
// repeated the prior-year figure and year inline -- e.g. "(45 in 2025) vs
// 2025 YTD" -- which named the comparison year twice and read as confusing/
// duplicated; simplified per direction to state the % change and the single
// comparison-year reference only. fmtFn is kept as a parameter so callers
// don't need to change, even though it's no longer used in the string itself.)
function ytdDeltaText(res, fmtFn) {
  if (!res || res.d === null || res.priYear === undefined) return null;
  return `${deltaArrow(res.d)}${pct(res.d)} vs. ${res.priYear} YTD`;
}
// Same YoY prior/latest-year resolution as renderYoyTable, but returns
// whichever metric moved the most (by absolute % change) -- feeds the
// 1-sentence auto-analysis under each Year-over-Year table. Uses the same
// YTD-cutoff methodology as ytdYoyMetric (dateField/cutoffCheckFields), not a
// full-year comparison.
function yoyBiggestMover(rows, metrics, selectedYear, dateField, cutoffCheckFields) {
  const { prior, latest } = resolveYoyYears(rows, selectedYear);
  if (prior === undefined || latest === undefined) return null;
  let best = null;
  metrics.forEach(m => {
    const metricFn = m.agg || (rs => sum(rs, m.fn));
    const res = ytdYoyMetric(rows, dateField, latest, prior, cutoffCheckFields, metricFn);
    if (res.d !== null && (best === null || Math.abs(res.d) > Math.abs(best.d))) best = { label: m.label, priVal: res.priVal, curVal: res.curVal, d: res.d, prior, latest };
  });
  return best;
}
// Renders the yoyBiggestMover result (if any) as a bolded 1-sentence summary.
function yoyAnalysisSentence(rows, metrics, selectedYear, dateField, cutoffCheckFields) {
  const best = yoyBiggestMover(rows, metrics, selectedYear, dateField, cutoffCheckFields);
  if (!best) return "No prior-year data available for this selection.";
  return `Year over year, <strong>${best.label}</strong> saw the largest change: <strong>${deltaArrow(best.d)}${pct(best.d)}</strong> (<strong>${fmt(best.priVal)}</strong> in ${best.prior} to <strong>${fmt(best.curVal)}</strong> in ${best.latest}).`;
}
// Same YTD-cutoff methodology as ytdYoyMetric/Overview's own cards (not a
// full-year comparison) -- see the long comment on ytdYoyMetric above.
function renderYoyTable(tableId, rows, metrics, selectedYear, dateField, cutoffCheckFields) {
  const { prior, latest } = resolveYoyYears(rows, selectedYear);
  const tbody = document.querySelector(`#${tableId} tbody`);
  const noData = `<tr><td colspan="4">No prior-year data available for this selection.</td></tr>`;
  if (prior === undefined || latest === undefined) { tbody.innerHTML = noData; return; }
  // Always shows every metric passed in, in the order given -- if a metric
  // has no prior-year data at all (e.g. a column the source sheet didn't
  // start tracking until a later year), its % change just shows as "--"
  // rather than the whole row disappearing. Each metric is either a plain
  // sum (m.fn, the original/default) or a custom aggregator (m.agg, for
  // things like a distinct count that a simple sum can't express).
  const html = metrics.map(m => {
    const metricFn = m.agg || (rs => sum(rs, m.fn));
    const res = ytdYoyMetric(rows, dateField, latest, prior, cutoffCheckFields, metricFn);
    return `<tr><td>${m.label}</td><td>${fmt(res.priVal)}</td><td>${fmt(res.curVal)}</td><td class="${deltaClass(res.d)}">${res.d === null ? "&mdash;" : deltaArrow(res.d) + pct(res.d)}</td></tr>`;
  }).join("");
  tbody.innerHTML = html || noData;
}

// =====================================================================
// PARTNER REFERRALS
// =====================================================================
function initReferrals() {
  const sel = document.getElementById("ref-year");
  const mgrSel = document.getElementById("ref-manager");
  function applyFilters() { renderReferrals(sel.value, mgrSel.value); }
  const years = getYears(DATA.partnerReferrals.raw);
  populateYearSelect(sel, years, applyFilters);
  // "Service Manager" filters on the same DS&E staff member field the
  // Referral Detail table's "User" column and the "Partner Referrals by
  // Staff" chart already use (see build_data.py -- the Partner Referrals
  // Details sheet doesn't have its own separate Service Manager column; the
  // "User" on each referral IS the DS&E service manager who logged it, per
  // the old sheet's report title "Partner Referrals by Manager").
  const managers = [...new Set(DATA.partnerReferrals.raw.map(r => r.staff).filter(Boolean))].sort();
  mgrSel.innerHTML = SELECT_ALL_OPTION + managers.map(m => `<option value="${m}">${m}</option>`).join("");
  mgrSel.value = "All";
  mgrSel.onchange = applyFilters;
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  sel.value = defaultYear;
  renderReferrals(defaultYear, "All");
}
function renderReferrals(year, manager) {
  let all = DATA.partnerReferrals.raw;
  if (manager && manager !== "All") all = all.filter(r => r.staff === manager);
  const rows = byYear(all, year);
  const total = sum(rows, r => r.count);
  const byStaff = groupBy(rows, r => r.staff);
  const staffTotals = [...byStaff.entries()].map(([staff, rs]) => ({ staff, total: sum(rs, r => r.count) })).sort((a, b) => b.total - a.total);
  // "Avg. Referrals Per Month" = total referrals divided by the number of
  // distinct calendar months present in the selected period. As of the
  // September 2026 switch to the PartnerReferralsDetail table, the source
  // data is one row per individual referral (not pre-aggregated by
  // date/staff like the old sheet was), so a plain row-level average would
  // always equal 1.00 (every row's count is 1) -- this must divide by month
  // count instead, not row count, to mean anything.
  const monthsInRange = new Set(rows.map(r => monthKey(r.date))).size;
  const avgPerMonth = monthsInRange ? total / monthsInRange : null;
  // Dynamic date-range subtitle -- dynamic with the Year filter via `rows`.
  const refRange = rangeLabel(rows, "date");

  // YoY % delta on every card -- same YTD-cutoff methodology as Overview
  // (see ytdYoyMetric).
  const { prior: refPrior, latest: refLatest } = resolveYoyYears(all, year);
  const dTotalRef = ytdYoyMetric(all, "date", refLatest, refPrior, null, rs => sum(rs, r => r.count));
  const dAvgRef = ytdYoyMetric(all, "date", refLatest, refPrior, null, rs => {
    const months = new Set(rs.map(r => monthKey(r.date))).size;
    return months ? sum(rs, r => r.count) / months : null;
  });

  document.getElementById("ref-kpiGrid").innerHTML = [
    kpiCard("Partner Referrals <button type=\"button\" class=\"def-hint\" data-def=\"A non-physical referral, such as email, phone, or shared contact info.\">?</button>", fmt(total), ytdDeltaText(dTotalRef, fmt), deltaClass(dTotalRef.d), refRange),
    kpiCard("Avg. Referrals Per Month", fmt(avgPerMonth, 2), ytdDeltaText(dAvgRef, v => fmt(v, 2)), deltaClass(dAvgRef.d), refRange)
  ].join("");

  makeChart("ref-chart1", {
    type: "bar",
    data: { labels: staffTotals.map(s => s.staff), datasets: [{ label: "Referrals", data: staffTotals.map(s => s.total), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    // Extra top padding so the tallest bar's data label doesn't get clipped
    // by the chart area's edge (same fix used on other bar charts).
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Continuous-timeline structure (same as the Team KPIs charts): one bar per
  // actual calendar month across the selected period, not grouped by year.
  // Both charts below share these same month keys so they can cross-highlight.
  const byChronoMonth = groupBy(rows, r => monthKey(r.date));
  const chronoMonths = [...byChronoMonth.keys()].sort();
  const chronoLabels = chronoMonths.map(monthLabel);
  makeChart("ref-chart2", {
    type: "bar",
    data: { labels: chronoLabels, datasets: [{ label: "Partner Referrals", data: chronoMonths.map(m => sum(byChronoMonth.get(m), r => r.count)), backgroundColor: COLORS.navy, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  makeChart("ref-chart3", {
    type: "bar",
    data: {
      labels: chronoLabels,
      datasets: staffTotals.map((s, i) => {
        const bg = [COLORS.navy, COLORS.teal, COLORS.tealLight, COLORS.pale][i % 4];
        return {
          label: s.staff,
          data: chronoMonths.map(m => sum((byChronoMonth.get(m) || []).filter(r => r.staff === s.staff), r => r.count)),
          backgroundColor: bg,
          // Zero-value segments have no height to anchor a label against, so
          // they were rendering right on top of the segment next to them --
          // suppressing the "0" labels (the segment simply isn't there, so
          // there's nothing useful to label) removes that crowding.
          datalabels: { color: labelContrast(bg), anchor: "center", align: "center", formatter: (v) => v ? numberLabel(v) : "" }
        };
      })
    },
    // Taller chart box gives each stacked segment more vertical room, further
    // reducing label crowding when several staff each have small monthly counts.
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
  });

  renderYoyTable("ref-yoyTable", all, [{ label: "Partner Referrals", fn: r => r.count }], year, "date", null);
  bindReferralsLink();

  // Auto-analysis sentences (bolded values). Chart 1 (by staff) isn't
  // month-based, so it calls out the top staff member regardless of year.
  // Charts 2 and 3 are month-based: for the current/latest year (or "All")
  // they state the latest populated month; for a completed past year they
  // state that year's full-year totals instead (see isPastYear).
  const topStaff = topEntry(staffTotals, s => s.total);
  document.getElementById("ref-analysis1").innerHTML = topStaff
    ? `<strong>${topStaff.item.staff}</strong> leads all staff with <strong>${fmt(topStaff.v)}</strong> referrals.`
    : "No data available for this period yet.";
  const pastYearRef = isPastYear(all, year);
  if (pastYearRef) {
    document.getElementById("ref-analysis2").innerHTML = `In <strong>${year}</strong>, the team received a total of <strong>${fmt(total)}</strong> partner referrals.`;
  } else {
    const latestMonthKey = chronoMonths.length ? chronoMonths[chronoMonths.length - 1] : null;
    const latestMonthTotal = latestMonthKey ? sum(byChronoMonth.get(latestMonthKey), r => r.count) : null;
    document.getElementById("ref-analysis2").innerHTML = latestMonthKey
      ? `In <strong>${monthLabel(latestMonthKey)}</strong>, the team received <strong>${fmt(latestMonthTotal)}</strong> partner referrals.`
      : "No data available for this period yet.";
  }
  if (pastYearRef) {
    const topStaffFullYear = topEntry(staffTotals, s => s.total);
    document.getElementById("ref-analysis3").innerHTML = topStaffFullYear
      ? `In <strong>${year}</strong>, <strong>${topStaffFullYear.item.staff}</strong> led all staff with <strong>${fmt(topStaffFullYear.v)}</strong> referrals total.`
      : "No data available for this period yet.";
  } else {
    const latestMonthKey = chronoMonths.length ? chronoMonths[chronoMonths.length - 1] : null;
    const latestMonthByStaff = latestMonthKey ? topEntry(staffTotals, s => sum((byChronoMonth.get(latestMonthKey) || []).filter(r => r.staff === s.staff), r => r.count)) : null;
    document.getElementById("ref-analysis3").innerHTML = (latestMonthKey && latestMonthByStaff && latestMonthByStaff.v > 0)
      ? `In <strong>${monthLabel(latestMonthKey)}</strong>, <strong>${latestMonthByStaff.item.staff}</strong> led all staff with <strong>${fmt(latestMonthByStaff.v)}</strong> referrals.`
      : "No data available for this period yet.";
  }
  document.getElementById("ref-yoy-analysis").innerHTML = yoyAnalysisSentence(all, [{ label: "Partner Referrals", fn: r => r.count }], year, "date", null);

  // Referral Detail table -- one row per individual referral from the
  // PartnerReferralsDetail table (sheet "Partner Referrals Details"), added
  // September 2026 when this tab switched to that table as its source.
  // Respects the tab's Year filter like every other visual here; sorted most
  // recent Referral Date first, matching the pattern used by the other
  // detail tables on this dashboard.
  document.querySelector("#ref-detailTable tbody").innerHTML = [...rows]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map(r => `<tr><td>${r.referralId ?? "&mdash;"}</td><td>${mdy(r.date) || "&mdash;"}</td><td>${r.accountName || "&mdash;"}</td><td>${r.functionName || "&mdash;"}</td><td>${mdy(r.leadArrival) || "&mdash;"}</td><td>${mdy(r.leadDeparture) || "&mdash;"}</td><td>${r.user || "&mdash;"}</td></tr>`)
    .join("");
  document.getElementById("ref-analysis4").innerHTML = rows.length
    ? `<strong>${fmt(rows.length)}</strong> individual referrals are listed below for <strong>${year === "All" ? "all years" : year}</strong>, most recent first.`
    : "No data available for this period yet.";

  setReportingPeriod("referrals", refRange);
}

// =====================================================================
// CLIENT SURVEY
// =====================================================================
// ---------- Feedback sentiment (Q7 "Feedback" section) ----------
// Purely client-side, deterministic keyword-lexicon heuristic -- this is a
// static site with no backend, so there's no real NLP/LLM service available
// to call for a true sentiment model. Each testimonial is scored by counting
// positive vs. negative keyword hits (case-insensitive, punctuation
// stripped) and bucketed by the net result. This is a lightweight
// approximation, not a substitute for human judgment on any individual
// comment, but it's consistent and updates live with the tab's Year/Manager
// filters.
const SENTIMENT_POSITIVE_WORDS = [
  "great", "excellent", "amazing", "wonderful", "fantastic", "helpful",
  "friendly", "professional", "smooth", "easy", "perfect", "outstanding",
  "exceptional", "responsive", "attentive", "efficient", "seamless",
  "impressed", "impressive", "pleasure", "recommend", "best", "awesome",
  "love", "loved", "enjoyed", "exceeded", "thank", "thanks", "appreciate",
  "appreciated", "knowledgeable", "supportive", "fabulous", "superb", "kind",
  "patient", "accommodating", "welcoming", "pleasant", "flexible",
  "organized", "prompt", "incredible", "delightful", "invaluable", "top-notch"
];
const SENTIMENT_NEGATIVE_WORDS = [
  "poor", "bad", "terrible", "disappointing", "disappointed", "slow",
  "difficult", "confusing", "unresponsive", "rude", "unprofessional",
  "frustrating", "frustrated", "issue", "issues", "problem", "problems",
  "delay", "delayed", "unclear", "lacking", "worst", "horrible", "awful",
  "unhelpful", "complicated", "concern", "concerns", "mistake", "mistakes",
  "late", "missed", "disorganized", "unacceptable", "disappointment", "fail",
  "failed", "failure", "refused", "negligent", "unacceptably", "silence",
  "silent", "ghosted", "ignored", "overlooked", "neglected", "unheard"
];
// Negators: when one of these appears anywhere in the same clause as a
// positive/negative keyword, that keyword's usual polarity is flipped (e.g.
// "wasn't helpful" counts as negative, "never disappointed" counts as
// positive) -- without this, a plain keyword count misreads a negated
// positive word as praise, which is exactly what was happening with
// responses like "I don't feel like Visit Anaheim is as customer friendly as
// they used to be" (the single keyword hit, "friendly," was scoring
// Positive even though the sentence is a complaint). Clause-level (not just
// a fixed word-distance window) because the negator and the keyword it's
// negating are often several words apart, as in that example.
const SENTIMENT_NEGATORS = [
  "not", "no", "never", "none", "nobody", "nothing", "cannot", "without",
  "hardly", "barely", "rarely", "lack", "lacking", "don't", "doesn't",
  "didn't", "isn't", "wasn't", "aren't", "weren't", "won't", "wouldn't",
  "couldn't", "shouldn't", "can't"
];
function analyzeSentiment(text) {
  if (!text) return "Neutral";
  // Split into clauses on sentence/clause punctuation first (apostrophes
  // kept, so contractions like "don't" survive as one token for the
  // negator list above) -- negation is evaluated per clause, not per whole
  // testimonial, so a negator in one sentence doesn't flip keywords in an
  // unrelated later sentence.
  const clauses = String(text).toLowerCase().split(/[.!?;,]/);
  let score = 0;
  clauses.forEach(clause => {
    const words = clause.replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(Boolean);
    const hasNegator = words.some(w => SENTIMENT_NEGATORS.includes(w));
    words.forEach(w => {
      let polarity = 0;
      if (SENTIMENT_POSITIVE_WORDS.includes(w)) polarity = 1;
      else if (SENTIMENT_NEGATIVE_WORDS.includes(w)) polarity = -1;
      if (polarity === 0) return;
      score += hasNegator ? -polarity : polarity;
    });
  });
  if (score > 0) return "Positive";
  if (score < 0) return "Negative";
  return "Neutral";
}
// Sentiment for a Q7 testimonial row: prefers the "Sentiment" column added
// directly to the ACC Survey sheet (row.sentiment, manually tagged
// Positive/Neutral/Negative by the team -- see build_data.py) over the
// keyword heuristic above. Only falls back to analyzeSentiment(feedback)
// for a row that has feedback text but no Sentiment value filled in yet
// (e.g. an older response from before that column existed), so every
// testimonial still gets a badge either way.
function resolveSentiment(row) {
  const tagged = row.sentiment && String(row.sentiment).trim();
  if (tagged && ["Positive", "Neutral", "Negative"].includes(tagged)) return tagged;
  return analyzeSentiment(row.feedback);
}
function initSurvey() {
  const yearSel = document.getElementById("sur-year");
  const mgrSel = document.getElementById("sur-manager");
  const qSel = document.getElementById("sur-question");
  function applyFilters() { renderSurvey(yearSel.value, mgrSel.value, qSel.value); renderQ2Q7(yearSel.value, mgrSel.value); }
  const years = getYears(DATA.accSurvey.raw);
  populateYearSelect(yearSel, years, applyFilters);
  const managers = [...new Set(DATA.accSurvey.raw.map(r => r.manager).filter(Boolean))].sort();
  mgrSel.innerHTML = SELECT_ALL_OPTION + managers.map(m => `<option value="${m}">${m}</option>`).join("");
  mgrSel.value = "All";
  mgrSel.onchange = applyFilters;
  // Question filter -- every rated question (excludes Q7, the open-ended
  // feedback question, which isn't a rating and belongs to the separate
  // "Feedback" section instead).
  const questionOpts = DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  qSel.innerHTML = SELECT_ALL_OPTION + questionOpts.map(q => `<option value="${q}">${q}</option>`).join("");
  qSel.value = "All";
  qSel.onchange = applyFilters;
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  yearSel.value = defaultYear;
  renderSurvey(defaultYear, "All", "All");
  renderQ2Q7(defaultYear, "All");
}
function renderSurvey(year, manager, question) {
  let all = DATA.accSurvey.raw;
  if (manager && manager !== "All") all = all.filter(r => r.manager === manager);
  const rows = byYear(all, year);
  const q2Text = DATA.accSurvey.q2q7.q2Text;
  // New 8th question added to the ACC Survey sheet -- exact match required.
  const overallText = "The Overall Anaheim Experience";
  const ratedRows = rows.filter(r => r.rating !== null);
  const hasQ = question && question !== "All";
  // Every chart/table below narrows to just the selected question when the
  // Question filter is active; the 2 fixed-question cards (Overall Anaheim
  // Experience, DS&E Manager) keep their own meaning regardless, since their
  // titles already name a specific question -- only "Team Experience Score"
  // (normally the grand mean across all questions) recomputes to the
  // selected question's own average, with its label updated to match.
  const filteredRows = hasQ ? ratedRows.filter(r => r.question === question) : ratedRows;
  const titleSuffix = hasQ ? ` &mdash; ${question}` : "";

  const teamScore = mean(filteredRows, r => r.rating);
  const teamScoreLabel = hasQ ? `${question} Score` : "Visit Anaheim Team Experience Score";
  const overallScore = mean(ratedRows.filter(r => r.question === overallText), r => r.rating);
  const managerScore = mean(ratedRows.filter(r => r.question === q2Text), r => r.rating);
  const respondents = distinctCount(rows, r => r.leadId);
  // Dynamic date-range subtitle -- dynamic with the Year/Manager filters via `rows`.
  const surRange = rangeLabel(rows, "date");
  // "Consists of 6 Questions" only applies while the card is showing the
  // grand mean across all 6 rated questions -- once the Question filter
  // narrows it to a single question, that note no longer applies.
  const teamScoreNote = hasQ ? null : "Consists of 6 Questions";

  // YoY % delta on every card -- same YTD-cutoff methodology as Overview
  // (see ytdYoyMetric), using `all` (Manager-filtered but not Year-filtered).
  const { prior: surPrior, latest: surLatest } = resolveYoyYears(all, year);
  function surYoy(metricFn) { return ytdYoyMetric(all, "date", surLatest, surPrior, ["rating"], metricFn); }
  const dOverallScore = surYoy(rs => mean(rs.filter(r => r.question === overallText && r.rating !== null), r => r.rating));
  const dTeamScore = surYoy(rs => {
    const rated = rs.filter(r => r.rating !== null);
    return mean(hasQ ? rated.filter(r => r.question === question) : rated, r => r.rating);
  });
  const dManagerScore = surYoy(rs => mean(rs.filter(r => r.question === q2Text && r.rating !== null), r => r.rating));
  const dRespondents = surYoy(rs => distinctCount(rs, r => r.leadId));

  document.getElementById("sur-kpiGrid").innerHTML = [
    kpiCard("The Overall Anaheim Experience Score", fmt(overallScore, 2), ytdDeltaText(dOverallScore, v => fmt(v, 2)), deltaClass(dOverallScore.d), surRange),
    kpiCard("DS&amp;E Manager Experience Score", fmt(managerScore, 2), ytdDeltaText(dManagerScore, v => fmt(v, 2)), deltaClass(dManagerScore.d), surRange),
    kpiCard(teamScoreLabel, fmt(teamScore, 2), ytdDeltaText(dTeamScore, v => fmt(v, 2)), deltaClass(dTeamScore.d), surRange, "", teamScoreNote),
    kpiCard("Survey Respondents", fmt(respondents), ytdDeltaText(dRespondents, fmt), deltaClass(dRespondents.d), surRange)
  ].join("");

  document.getElementById("sur-chart1-title").innerHTML = "VA Survey Questions Rating" + titleSuffix;
  document.getElementById("sur-chart2-title").innerHTML = "Avg. Rating by Month" + titleSuffix + ` <span class="tag">Monthly</span>`;
  document.getElementById("sur-chart3-title").innerHTML = "Avg. Rating by DS&amp;E Manager" + titleSuffix;
  document.getElementById("sur-yoyValues-title").innerHTML = "Ratings by Year" + titleSuffix;
  document.getElementById("sur-yoyPct-title").innerHTML = "Year-over-Year % Change" + titleSuffix;
  const sur2DescEl = document.getElementById("sur-chart2-desc");
  if (sur2DescEl) {
    sur2DescEl.textContent = hasQ
      ? `Averaged for "${question}" only, grouped by the date on each response.`
      : "Averaged across all six rated questions, grouped by the date on each response.";
  }
  document.getElementById("sur-chart3-desc").textContent = hasQ
    ? `Averaged for "${question}" only, grouped by the manager named on each response.`
    : "Averaged across all six rated questions, grouped by the manager named on each response.";

  const byQ = groupBy(filteredRows, r => r.question);
  const qLabels = [...byQ.keys()];
  // Reverted per direction: every bar uses the same uniform color again (no
  // more lighter-fill highlight for the Overall Anaheim Experience/DS&E
  // Manager questions, even though those two are also their own KPI cards).
  makeChart("sur-chart1", {
    type: "bar",
    data: { labels: qLabels.map(q => wrapLabel(q)), datasets: [{
      label: "Avg Rating", data: qLabels.map(q => mean(byQ.get(q), r => r.rating)),
      backgroundColor: COLORS.navy, borderRadius: 4,
      // Bold, larger data labels so they're easy to read at a glance.
      datalabels: { font: { size: 13, weight: "700" }, color: COLORS.text }
    }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 10 }, y: { ticks: { font: { weight: "700" } } } } }
  });

  const byMonth = groupBy(filteredRows, r => monthKey(r.date));
  const months = [...byMonth.keys()].sort();
  makeChart("sur-chart2", {
    type: "bar",
    data: { labels: months.map(monthLabel), datasets: [{ label: "Avg Score", data: months.map(m => mean(byMonth.get(m), r => r.rating)), backgroundColor: COLORS.tealLight, borderRadius: 4 }] },
    // Extra top padding so a bar hitting the max (10) still has room to show
    // its data label above it instead of getting clipped by the chart edge.
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } }
  });

  const byMgr = groupBy(filteredRows.filter(r => r.manager), r => r.manager);
  const mgrList = [...byMgr.entries()].map(([m, rs]) => ({ m, avg: mean(rs, r => r.rating) })).sort((a, b) => b.avg - a.avg);
  makeChart("sur-chart3", {
    type: "bar",
    data: { labels: mgrList.map(x => x.m), datasets: [{ label: "Avg Rating", data: mgrList.map(x => x.avg), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    // Extra top padding so a bar hitting the max (10) still has room to show
    // its data label above it instead of getting clipped by the chart edge.
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } }
  });

  // Both YoY tables always show the full multi-year view regardless of the
  // Year filter (but do respect the Services Manager and Question filters
  // via `all`/`question` above). Years come from whatever's actually in the
  // sheet (2023 through the latest year present), not a hardcoded range, so
  // this keeps working as new years of data get added. Each year's average
  // is that year's own full-year average -- not limited to a shared YTD
  // window like the KPI cards' YoY deltas are. A YTD-consistent window makes
  // sense for a single current-vs-prior-year delta, but it doesn't for a
  // multi-year trend table: the Client Survey program didn't start until
  // October 2023, so a window matching 2026's latest populated month
  // (currently through June) excludes 100% of 2023's real Q4 responses,
  // making that whole column blank for no good reason. Full-year averages
  // fix that -- 2023 now shows its real Oct-Dec average, and every other
  // year shows the average of whatever data it actually has (which for the
  // current, still-in-progress year, is simply whatever's been collected
  // so far -- there's no "future" data to wrongly include).
  const YEARS = getYears(DATA.accSurvey.raw);
  const questions = hasQ ? [question] : DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  const yearlyByQ = questions.map(q => {
    const yearly = {};
    YEARS.forEach(y => { yearly[y] = mean(all.filter(r => r.year === y && r.question === q), r => r.rating); });
    return { q, yearly };
  });
  document.querySelector("#sur-yoyValuesTable thead tr").innerHTML =
    `<th>Question</th>` + YEARS.map(y => `<th>${y}</th>`).join("");
  document.querySelector("#sur-yoyValuesTable tbody").innerHTML = yearlyByQ.map(({ q, yearly }) =>
    `<tr><td>${q}</td>${YEARS.map(y => `<td>${fmt(yearly[y], 2)}</td>`).join("")}</tr>`
  ).join("");
  document.querySelector("#sur-yoyPctTable thead tr").innerHTML =
    `<th>Question</th>` + YEARS.slice(0, -1).map((y, i) => `<th>${String(y).slice(2)}&rarr;${String(YEARS[i + 1]).slice(2)}</th>`).join("");
  document.querySelector("#sur-yoyPctTable tbody").innerHTML = yearlyByQ.map(({ q, yearly }) => {
    const cells = YEARS.slice(0, -1).map((y, i) => {
      const d = pctChange(yearly[y], yearly[YEARS[i + 1]]);
      return `<td class="${deltaClass(d)}">${d === null ? "&mdash;" : pct(d, 1)}</td>`;
    });
    return `<tr><td>${q}</td>${cells.join("")}</tr>`;
  }).join("");

  // Auto-analysis sentences (bolded values). Chart 1 (by question) and
  // Chart 3 (by manager) aren't month-based, so they call out the
  // highest/top entry instead of a "latest month" figure; Chart 2 is
  // month-based and follows the same "latest month with data" pattern used
  // dashboard-wide.
  const qAvgs = qLabels.map(q => ({ q, avg: mean(byQ.get(q), r => r.rating) }));
  const topQ = topEntry(qAvgs, x => x.avg);
  document.getElementById("sur-analysis1").innerHTML = topQ
    ? `<strong>${topQ.item.q}</strong> has the highest average rating at <strong>${fmt(topQ.v, 2)}</strong>.`
    : "No data available for this period yet.";
  if (isPastYear(all, year)) {
    document.getElementById("sur-analysis2").innerHTML = `In <strong>${year}</strong>, the average score was <strong>${fmt(mean(filteredRows, r => r.rating), 2)}</strong>.`;
  } else {
    const latestSurveyRow = latestRowWithData(filteredRows, ["rating"], "date");
    const latestMonthAvg = latestSurveyRow ? mean(byMonth.get(monthKey(latestSurveyRow.date)), r => r.rating) : null;
    document.getElementById("sur-analysis2").innerHTML = latestSurveyRow
      ? `In <strong>${monthLabel(latestSurveyRow.date.slice(0, 7))}</strong>, the average score was <strong>${fmt(latestMonthAvg, 2)}</strong>.`
      : "No data available for this period yet.";
  }
  const topMgrRating = topEntry(mgrList, x => x.avg);
  document.getElementById("sur-analysis3").innerHTML = topMgrRating
    ? `<strong>${topMgrRating.item.m}</strong> has the highest average rating at <strong>${fmt(topMgrRating.v, 2)}</strong>.`
    : "No data available for this period yet.";
  // Uses the same full-year averages (yearlyByQ) computed for the "Ratings
  // by Year" table directly above this sentence, rather than the dashboard-
  // wide YTD-cutoff yoyAnalysisSentence() helper -- so the prior/latest
  // values named here always match that table's own numbers exactly instead
  // of potentially differing (a YTD-windowed comparison vs. this table's
  // full-year one).
  {
    const { prior: surYoyPrior, latest: surYoyLatest } = resolveYoyYears(all, year);
    let bestQ = null;
    if (surYoyPrior !== undefined && surYoyLatest !== undefined) {
      yearlyByQ.forEach(({ q, yearly }) => {
        const d = pctChange(yearly[surYoyPrior], yearly[surYoyLatest]);
        if (d !== null && (bestQ === null || Math.abs(d) > Math.abs(bestQ.d))) {
          bestQ = { q, priorVal: yearly[surYoyPrior], curVal: yearly[surYoyLatest], d };
        }
      });
    }
    document.getElementById("sur-yoy-analysis").innerHTML = bestQ
      ? `Year over year, <strong>${bestQ.q}</strong> saw the largest change: <strong>${deltaArrow(bestQ.d)}${pct(bestQ.d)}</strong> (<strong>${fmt(bestQ.priorVal, 2)}</strong> in ${surYoyPrior} to <strong>${fmt(bestQ.curVal, 2)}</strong> in ${surYoyLatest}).`
      : "No prior-year data available for this selection.";
  }

  setReportingPeriod("survey", surRange);
}
// Feedback testimonial modal (see #feedbackModalOverlay in index.html):
// opened by clicking a testimonial card whose comment was truncated (>220
// characters, see renderQ2Q7), so the full text is readable without
// stretching the card grid. Close handlers (button, clicking outside the
// box, Escape) are wired once via initFeedbackModal(), called from main().
function openFeedbackModal(item) {
  const overlay = document.getElementById("feedbackModalOverlay");
  if (!overlay) return;
  document.getElementById("feedbackModalYear").textContent = item.year;
  const sentimentEl = document.getElementById("feedbackModalSentiment");
  sentimentEl.textContent = item.sentiment;
  sentimentEl.className = "sentiment-badge " + item.sentiment.toLowerCase();
  document.getElementById("feedbackModalText").textContent = item.feedback;
  overlay.classList.add("open");
}
function closeFeedbackModal() {
  const overlay = document.getElementById("feedbackModalOverlay");
  if (overlay) overlay.classList.remove("open");
}
function initFeedbackModal() {
  const overlay = document.getElementById("feedbackModalOverlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeFeedbackModal(); });
  document.getElementById("feedbackModalClose")?.addEventListener("click", closeFeedbackModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFeedbackModal(); });
}

// Definition hints ("?" badges on Partners Visited/Partner Referrals/Clients
// Serviced During Planning Visits cards, Overview + Team KPIs + Partner
// Referrals tabs). Each badge is a real <button> carrying its definition in
// data-def -- clicking it opens a small popover with that text. This is a
// single delegated listener (works across every tab's KPI grid regardless of
// how often those grids get re-rendered by filters) registered in the
// CAPTURING phase specifically so it runs, and can stopPropagation(), before
// the click ever reaches an ancestor .kpi-card's own bubble-phase click
// handler (Overview cards are clickable to select/filter the summary table --
// without capture-phase stopPropagation, clicking "?" would also trigger
// that selection instead of just showing the definition).
let DEF_POPOVER_OPEN_HINT = null;
function initDefHints() {
  const pop = document.createElement("div");
  pop.className = "def-popover";
  pop.setAttribute("role", "tooltip");
  document.body.appendChild(pop);

  function hidePopover() {
    pop.classList.remove("open");
    DEF_POPOVER_OPEN_HINT = null;
  }
  function showPopoverFor(hint) {
    pop.textContent = hint.dataset.def || "";
    pop.classList.add("open");
    const rect = hint.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    // Keep the popover from running off the right edge of the viewport.
    const maxLeft = window.scrollX + document.documentElement.clientWidth - popRect.width - 12;
    if (left > maxLeft) left = Math.max(12, maxLeft);
    pop.style.left = left + "px";
    pop.style.top = (rect.bottom + window.scrollY + 8) + "px";
    DEF_POPOVER_OPEN_HINT = hint;
  }

  document.addEventListener("click", (e) => {
    const hint = e.target.closest(".def-hint");
    if (hint) {
      e.preventDefault();
      e.stopPropagation();
      if (DEF_POPOVER_OPEN_HINT === hint) { hidePopover(); return; }
      showPopoverFor(hint);
      return;
    }
    if (!e.target.closest(".def-popover")) hidePopover();
  }, true);
  window.addEventListener("scroll", hidePopover, true);
  window.addEventListener("resize", hidePopover);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePopover(); });
}
function renderQ2Q7(year, manager) {
  const spot = DATA.accSurvey.q2q7;
  let raw = DATA.accSurvey.raw;
  if (manager && manager !== "All") raw = raw.filter(r => r.manager === manager);

  document.getElementById("q2q7Desc").innerHTML =
    `Visit Anaheim Team Experience Feedback` +
    (manager && manager !== "All" ? ` Filtered to responses naming <strong>${manager}</strong> as the Services Manager.` : "");

  // Years respect the page's Year filter, same as every other card/chart on
  // this tab -- "All" shows every year present in the sheet, a specific year
  // shows just that one card.
  const YEARS = (year && year !== "All") ? [Number(year)] : getYears(DATA.accSurvey.raw);

  // Each testimonial card is titled with its year, up to 20 comments per year
  // (fewer if that year doesn't have 20 feedback responses).
  const testimonialsByYear = {};
  YEARS.forEach(y => {
    testimonialsByYear[y] = raw.filter(r => r.question === spot.q7Text && r.year === y && r.feedback).slice(0, 20);
  });
  // Each card's sentiment word (see resolveSentiment) sits next to its year,
  // on the same row -- pulled directly from the "Sentiment" column on the
  // ACC Survey sheet for each response. Cards whose comment got truncated
  // (>220 characters) are clickable, opening a modal with the full text
  // (see openFeedbackModal below) -- flatCardItems tracks the full,
  // untruncated data for each rendered card in DOM order so the click
  // handlers attached after innerHTML is set can look it back up without
  // needing to round-trip it through an HTML attribute.
  const flatCardItems = [];
  const cols = document.getElementById("testimonialCols");
  cols.innerHTML = YEARS.map(y => {
    const items = testimonialsByYear[y] || [];
    return items.map(it => {
      const sentiment = resolveSentiment(it);
      const truncated = it.feedback.length > 220;
      const displayText = truncated ? it.feedback.slice(0, 220) + "&hellip;" : it.feedback;
      flatCardItems.push({ year: y, sentiment, feedback: it.feedback, truncated });
      return `<div class="testimonial${truncated ? " clickable" : ""}"><div class="yr"><span>${y}</span><span class="sentiment-badge ${sentiment.toLowerCase()}">${sentiment}</span></div>&ldquo;${displayText}&rdquo;${truncated ? `<span class="read-more">Read full comment</span>` : ""}</div>`;
    }).join("");
  }).join("");
  [...cols.querySelectorAll(".testimonial")].forEach((el, i) => {
    const item = flatCardItems[i];
    if (!item || !item.truncated) return;
    el.addEventListener("click", () => openFeedbackModal(item));
  });

  // Aggregate sentiment breakdown next to the section title, on a
  // red-to-green scale -- computed across ALL Q7 feedback matching the
  // current Year/Manager filters (not just the up-to-20-per-year subset
  // shown as cards above), so it's a true overall picture.
  const allFeedback = raw.filter(r => r.question === spot.q7Text && r.feedback && (!year || year === "All" || r.year === Number(year)));
  const scaleEl = document.getElementById("q2q7SentimentScale");
  if (scaleEl) {
    const total = allFeedback.length;
    if (!total) {
      scaleEl.innerHTML = "";
    } else {
      const counts = { Positive: 0, Neutral: 0, Negative: 0 };
      allFeedback.forEach(r => { counts[resolveSentiment(r)]++; });
      const pctOf = n => Math.round((n / total) * 100);
      const negPct = pctOf(counts.Negative), neuPct = pctOf(counts.Neutral), posPct = pctOf(counts.Positive);
      scaleEl.innerHTML =
        `<span>${negPct}% negative, ${neuPct}% neutral, ${posPct}% positive</span>` +
        `<span class="bar"><span class="seg-negative" style="width:${negPct}%"></span><span class="seg-neutral" style="width:${neuPct}%"></span><span class="seg-positive" style="width:${posPct}%"></span></span>`;
    }
  }
}

/* ===================================================================
   Restyle adapter layer (restyle only -- no formula changes).
   Everything above this line is production app.js, copied verbatim
   (its own main()/tab bootstrap is not called; boot() below does the fetch). The functions below override only
   presentation concerns: card markup, lazy chart creation for hidden
   pages, the per-page reporting-period badge, and a small built-in
   value-label plugin (replaces chartjs-plugin-datalabels so the approved
   restyle renders identically; only Chart.js is loaded).
   =================================================================== */
const DL_DEFAULT = { color: COLORS.text, anchor: "end", font: { size: 10, weight: "700" }, formatter: numberLabel };
Chart.defaults.layout.padding = { right: 18 };
Chart.register({
  id: "vaDataLabels",
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const horiz = chart.options.indexAxis === "y";
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (!chart.isDatasetVisible(di)) return;
      const cfg = Object.assign({}, DL_DEFAULT, ds.datalabels || {});
      if (cfg.display === false) return;
      const font = Object.assign({}, DL_DEFAULT.font, cfg.font || {});
      meta.data.forEach((el, i) => {
        const raw = ds.data[i];
        const c = { dataset: ds, dataIndex: i, chart };
        let txt = cfg.formatter(raw, c);
        if (txt === "" || txt === null || txt === undefined) return;
        const color = typeof cfg.color === "function" ? cfg.color(c) : cfg.color;
        let x, y;
        ctx.save();
        ctx.font = `${font.weight} ${font.size}px ${Chart.defaults.font.family}`;
        ctx.fillStyle = color || COLORS.text;
        if (meta.type === "doughnut" || meta.type === "pie") {
          if (!el.circumference) { ctx.restore(); return; }
          const p = el.tooltipPosition();
          x = p.x; y = p.y; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        } else {
          if (el.x === undefined || el.base === undefined || Number.isNaN(el.x)) { ctx.restore(); return; }
          const center = cfg.anchor === "center";
          if (horiz) {
            y = el.y; ctx.textBaseline = "middle";
            if (center) { x = (el.x + el.base) / 2; ctx.textAlign = "center"; } else { x = el.x + 4; ctx.textAlign = "left"; }
          } else {
            x = el.x; ctx.textAlign = "center";
            if (center) { y = (el.y + el.base) / 2; ctx.textBaseline = "middle"; } else { y = el.y - 3; ctx.textBaseline = "bottom"; }
          }
        }
        ctx.fillText(String(txt), x, y);
        ctx.restore();
      });
    });
  }
});

// Charts are only created while their page is visible (Chart.js cannot size
// a canvas inside display:none); each page re-renders when it is opened.
function makeChart(id, config) {
  const el = document.getElementById(id);
  if (!el) return;
  destroyChart(id);
  if (!el.closest(".page.active")) return;
  CHARTS[id] = new Chart(el, config);
}

let KPI_SRC = "", KPI_KICKER = "KPI";
// Tile overline = the tab's name (Social Media Dashboard ".sc-s" pattern).
const TAB_TITLES = { team: "Team KPIs", referrals: "Partner Referrals", survey: "Client Survey", q2q7: "Client Survey" };
function kpiCard(label, value, deltaText, deltaCls, dateRange, cardClass, note, extraAttrs) {
  return `<div class="kpi-card${cardClass ? " " + cardClass : ""}"${extraAttrs ? " " + extraAttrs : ""}>` +
    `<div class="kicker">${KPI_KICKER}</div><div class="label">${label}</div><div class="value">${value}</div>` +
    `${deltaText ? `<div class="delta ${deltaCls || ""}">${deltaText}</div>` : ""}` +
    `${note ? `<div class="daterange">${note}</div>` : ""}` +
    `${dateRange ? `<div class="daterange">${dateRange}</div>` : ""}` +
    `${KPI_SRC ? `<div class="src">Source: ${KPI_SRC}</div>` : ""}</div>`;
}

function setReportingPeriod(tabName, rangeText) {
  const el = document.getElementById(tabName + "-period");
  if (el) el.innerHTML = "Reporting period: " + (rangeText || "&mdash;");
}

// Remember each section's latest filter arguments so the page can be
// re-rendered (with charts) whenever it is opened.
const LAST_ARGS = {};
function remember(name, fn, src) {
  return function (...args) { LAST_ARGS[name] = args; KPI_SRC = src; KPI_KICKER = TAB_TITLES[name] || "KPI"; return fn.apply(this, args); };
}
renderTeam = remember("team", renderTeam, TAB_SOURCES.team);
renderReferrals = remember("referrals", renderReferrals, TAB_SOURCES.referrals);
renderSurvey = remember("survey", renderSurvey, TAB_SOURCES.survey);
renderQ2Q7 = remember("q2q7", renderQ2Q7, TAB_SOURCES.survey);

const SECTION_RENDER = {
  team: () => renderTeam(...LAST_ARGS.team),
  referrals: () => renderReferrals(...LAST_ARGS.referrals),
  survey: () => { renderSurvey(...LAST_ARGS.survey); renderQ2Q7(...LAST_ARGS.q2q7); }
};
window.onSectionShow = function (id) {
  const foot = document.getElementById("footSource");
  if (foot) foot.textContent = "Sources: " + (TAB_SOURCES[id] || TAB_SOURCES.overview) + ".";
  if (SECTION_RENDER[id] && LAST_ARGS[id === "survey" ? "survey" : id]) SECTION_RENDER[id]();
};


  return {
    start(data) {
      DATA = data;
      initFeedbackModal();
      initDefHints();
      initTeam();
      initReferrals();
      initSurvey();
    }
  };
})();

/* =====================================================================
   Bootstrap: load data.json at runtime (never embedded), then render.
   ===================================================================== */
async function boot() {
  let data;
  try {
    const res = await fetch("data.json");
    if (res && res.ok === false) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (err) {
    console.error("Could not load data.json", err);
    const msg = '<div class="box">The dashboard data (data.json) could not be loaded. Please refresh the page or contact the Business Intelligence team.</div>';
    { const g = document.getElementById("ov-kpiGrid"); if (g) g.innerHTML = msg; }
    return;
  }
  Sections.start(data);
  OV.init(data);
}
boot();
