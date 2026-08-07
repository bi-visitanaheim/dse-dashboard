/* Destination Services & Events Dashboard
   Structure mirrors the live Power BI "Destination Services & Events KPIs"
   report (7 tabs: Overview, Team KPIs, Partner Referrals, Repeat Clients,
   Client Survey, Hosted Events, Booked Business). KPI formulas were
   reverse-engineered by comparing computed values against the numbers
   shown live in that report. Reads data.json (built by build_data.py). */

// Visit Anaheim "ReBrand Teal" palette, pulled directly from the
// department's own Power BI theme file (RebrandTheme.json).
// Restricted to the six approved brand colors only (navy, teal, teal-light,
// pale, near-black text, off-white bg). Grid/muted are opacity tints of
// those same colors, not new hues.
const COLORS = {
  navy: "#125C60", teal: "#43A3A3", tealLight: "#77C7C9", pale: "#B4D9E3",
  text: "#231F20", bg: "#F9F9F2",
  grid: "rgba(18,92,96,.14)", muted: "rgba(35,31,32,.55)",
  seriesA: "#43A3A3", seriesB: "#125C60", seriesC: "#77C7C9", seriesD: "#B4D9E3"
};
const YEAR_PALETTE = { 2023: "#B4D9E3", 2024: "#77C7C9", 2025: "#43A3A3", 2026: "#125C60" };

Chart.defaults.font.family = "'Sharp Sans Disp No2','Sharp Sans Display No2','Segoe UI',Arial,sans-serif";
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
function dedupeBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  arr.forEach(r => { const k = keyFn(r); if (k !== null && k !== undefined && !seen.has(k)) { seen.add(k); out.push(r); } });
  return out;
}
function monthKey(iso) { return iso.slice(0, 7); }
function monthLabel(m) { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }
function kpiCard(label, value, deltaText, deltaCls, dateRange, cardClass, note, extraAttrs) {
  return `<div class="kpi-card${cardClass ? " " + cardClass : ""}"${extraAttrs ? " " + extraAttrs : ""}><div class="label">${label}</div><div class="value">${value}</div>${deltaText ? `<div class="delta ${deltaCls || ""}">${deltaText}</div>` : ""}${note ? `<div class="daterange">${note}</div>` : ""}${dateRange ? `<div class="daterange">${dateRange}</div>` : ""}</div>`;
}
// "Jan 1, 2026 – May 31, 2026" -- the exact YTD window a card's number covers.
function ytdRangeLabel(year, cutoffMonth) {
  if (!cutoffMonth) return "";
  const start = new Date(year, 0, 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const end = new Date(year, cutoffMonth, 0).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${start} &ndash; ${end}`;
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
function populateYearSelect(sel, years, onChange) {
  sel.innerHTML = `<option value="All">All</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
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
// Wraps a percentage-change fragment in a bold, colored inline span for the
// Overview narrative (and anywhere else prose needs an inline delta).
function deltaSpan(d) {
  if (d === null || d === undefined) return "";
  const cls = deltaClass(d);
  const dir = d > 0.001 ? "up" : d < -0.001 ? "down" : "flat";
  return ` (<span class="delta-inline ${cls}">${dir} ${Math.abs(d * 100).toFixed(1)}%</span>)`;
}
// ---------- Overview: clickable KPI cards filter the summary table AND narrative ----------
let OV_SELECTED_INDEX = null;
let OV_CATEGORY_SENTENCES = [];
let OV_FULL_NARRATIVE = "";
function applyOverviewSelection() {
  document.querySelectorAll("#ov-kpiGrid .kpi-card").forEach((el, i) => {
    el.classList.toggle("selected", OV_SELECTED_INDEX === i);
  });
  document.querySelectorAll("#ov-summaryTable tbody tr").forEach((tr, i) => {
    tr.style.display = (OV_SELECTED_INDEX === null || OV_SELECTED_INDEX === i) ? "" : "none";
  });
  const insights = document.getElementById("ov-insights");
  if (insights) {
    insights.innerHTML = OV_SELECTED_INDEX === null ? OV_FULL_NARRATIVE : (OV_CATEGORY_SENTENCES[OV_SELECTED_INDEX] || OV_FULL_NARRATIVE);
  }
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

// =====================================================================
// Bootstrap
// =====================================================================
async function main() {
  const res = await fetch("data.json");
  DATA = await res.json();
  document.getElementById("updatedAt").textContent = DATA.generatedAt;

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  renderOverview();
  initTeam();
  initReferrals();
  initRepeat();
  initSurvey();
  initEvents();
  initBooked();
}

// Each tab pulls from a different mix of source systems, so the footer's
// "Source:" line updates to match whichever tab is currently active.
const TAB_SOURCES = {
  overview: "Granicus, Association Insights, and Internal Tracking",
  team: "Granicus and Internal Tracking",
  referrals: "Granicus",
  repeat: "Granicus",
  survey: "Association Insights",
  events: "Internal Tracking",
  booked: "Granicus"
};
// The header's "Reporting period" pill is dynamic per tab: each render*
// function below calls setReportingPeriod() with its own tab's currently-
// filtered date range (the exact same range shown on that tab's own KPI
// cards). That helper both stores the value (for switchTab to restore when
// coming back to a tab later) AND, if that tab is the one currently on
// screen, writes straight to the header DOM element immediately -- so the
// pill also updates live when a Year/Manager/etc. filter changes without
// switching tabs, not just when switching tabs.
const TAB_REPORTING_PERIODS = {};
let ACTIVE_TAB = "overview";
function setReportingPeriod(tabName, rangeText) {
  TAB_REPORTING_PERIODS[tabName] = rangeText || "&mdash;";
  if (ACTIVE_TAB === tabName) {
    const el = document.getElementById("headerReportingPeriod");
    if (el) el.innerHTML = TAB_REPORTING_PERIODS[tabName];
  }
}
function switchTab(name) {
  ACTIVE_TAB = name;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
  const footSource = document.getElementById("footSource");
  if (footSource && TAB_SOURCES[name]) footSource.textContent = TAB_SOURCES[name];
  const periodEl = document.getElementById("headerReportingPeriod");
  if (periodEl && TAB_REPORTING_PERIODS[name]) periodEl.innerHTML = TAB_REPORTING_PERIODS[name];
  // Print-only heading (see #printTabTitle in index.html) names whichever
  // tab is active, since the tab nav itself is hidden when printing/
  // exporting -- otherwise an exported page wouldn't say which report it is.
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  const printTitleEl = document.getElementById("printTabTitle");
  if (printTitleEl && btn) printTitleEl.textContent = btn.textContent;
}

// =====================================================================
// OVERVIEW
// =====================================================================
function monthOf(dateStr) { const n = dateStr ? Number(String(dateStr).slice(5, 7)) : NaN; return Number.isNaN(n) ? null : n; }
// Year is derived directly from the same date field used for the month check
// (not a separate pre-baked `r.year`) so each Overview KPI can be filtered by
// whichever date column it's actually supposed to use -- e.g. the "VA Team
// Experience Rating" card uses ACC Survey's "startDate" (Start Date, column
// A) while the rest of the Client Survey tab still uses "date" (Recorded
// Date, column D). See README.md "Data source mapping" for the full list.
function yearOf(dateStr) { const n = dateStr ? Number(String(dateStr).slice(0, 4)) : NaN; return Number.isNaN(n) ? null : n; }
function ytdCutoff(rowsInYear, dateField) {
  const months = rowsInYear.map(r => monthOf(r[dateField])).filter(m => m !== null);
  return months.length ? Math.max(...months) : 12;
}
// The full calendar date through which a category's data is complete (the
// last day of its cutoff month) -- e.g. "May 31, 2026" -- for the Department
// at a Glance summary table's "Data Through" column.
function endOfMonthLabel(year, month) {
  if (!month) return "&mdash;";
  const d = new Date(year, month, 0); // day 0 of next month = last day of `month`
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
// "YYYY-MM-DD" -> "MM/DD/YYYY", for the Booked Business detail table.
function mdy(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}
function ytdRows(rows, dateField, year, cutoff) {
  return rows.filter(r => yearOf(r[dateField]) === year && monthOf(r[dateField]) !== null && monthOf(r[dateField]) <= cutoff);
}
function monthOnlyRows(rows, dateField, month) {
  return rows.filter(r => monthOf(r[dateField]) === month);
}
function renderOverview() {
  const pv = DATA.planningVisits;
  const referrals = DATA.partnerReferrals.raw;
  const repeat = DATA.repeatingClients.raw;
  const survey = DATA.accSurvey.raw;
  const evSurveys = DATA.eventSurveys.raw;
  const booked = DATA.bookedBusiness.raw;

  // ---- KPI cards: year-to-date only, each with a YoY delta vs the same
  // year-to-date window in the prior year (cutoff month is whatever's latest
  // in each sheet's own current-year data, so the comparison stays
  // apples-to-apples). "Current year" is 2026 for every sheet except Booked
  // Business, which as of this build only has 2025 event dates -- so its two
  // cards ("Leads Generated From VA Events", "Avg. Lead Conversion Window")
  // automatically use the latest year actually present in that sheet instead
  // of a hardcoded 2026, and will shift to 2026 on their own once 2026
  // events start appearing there. ----
  const CUR = 2026, PRI = 2025;
  const bbYears = getYears(booked);
  const BB_CUR = bbYears.length ? Math.max(...bbYears) : CUR;
  const BB_PRI = BB_CUR - 1;
  // Planning Visits pre-creates a placeholder row for the upcoming month
  // before it has real numbers (all fields null) -- exclude that row when
  // finding the latest *populated* month so the cutoff doesn't jump ahead to
  // a month with no data yet.
  const pvCutoff = ytdCutoff(pv.filter(r => r.year === CUR && r.planningVisits !== null && r.planningVisits !== undefined), "date");
  const refCutoff = ytdCutoff(referrals.filter(r => r.year === CUR), "date");
  const repCutoff = ytdCutoff(repeat.filter(r => r.year === CUR), "startDate");
  // ACC Survey's "date"/"year" are Start Date (see build_data.py) -- used
  // uniformly here and across the whole Client Survey tab.
  const surCutoff = ytdCutoff(survey.filter(r => r.year === CUR), "date");
  const evsCutoff = ytdCutoff(evSurveys.filter(r => r.year === CUR), "date");
  const bbCutoff = ytdCutoff(booked.filter(r => r.year === BB_CUR), "eventStartDate");

  const pvCurR = ytdRows(pv, "date", CUR, pvCutoff), pvPriR = ytdRows(pv, "date", PRI, pvCutoff);
  const refCurR = ytdRows(referrals, "date", CUR, refCutoff), refPriR = ytdRows(referrals, "date", PRI, refCutoff);
  const repCurR = ytdRows(repeat, "startDate", CUR, repCutoff), repPriR = ytdRows(repeat, "startDate", PRI, repCutoff);
  const surCurR = ytdRows(survey, "date", CUR, surCutoff), surPriR = ytdRows(survey, "date", PRI, surCutoff);
  const evsCurR = ytdRows(evSurveys, "date", CUR, evsCutoff), evsPriR = ytdRows(evSurveys, "date", PRI, evsCutoff);
  const bbCurR = ytdRows(booked, "eventStartDate", BB_CUR, bbCutoff), bbPriR = ytdRows(booked, "eventStartDate", BB_PRI, bbCutoff);

  // Single-month ("previous month") slices for the Department at a Glance
  // summary table -- each category's own latest available month, same cutoff
  // used for the YTD comparison above.
  const pvMonthR = monthOnlyRows(pvCurR, "date", pvCutoff);
  const refMonthR = monthOnlyRows(refCurR, "date", refCutoff);
  const repMonthR = monthOnlyRows(repCurR, "startDate", repCutoff);
  const surMonthR = monthOnlyRows(surCurR, "date", surCutoff);
  const evsMonthR = monthOnlyRows(evsCurR, "date", evsCutoff);
  const bbMonthR = monthOnlyRows(bbCurR, "eventStartDate", bbCutoff);

  const visitsCur = sum(pvCurR, r => r.planningVisits), visitsPri = sum(pvPriR, r => r.planningVisits);
  const clientsCur = sum(pvCurR, r => r.clientsServiced), clientsPri = sum(pvPriR, r => r.clientsServiced);
  const partnersCur = sum(pvCurR, r => r.partnersVisited), partnersPri = sum(pvPriR, r => r.partnersVisited);
  const convCur = sum(pvCurR, r => r.conventionGroupsServiced), convPri = sum(pvPriR, r => r.conventionGroupsServiced);
  const inHouseCur = sum(pvCurR, r => r.inHouseGroupsServiced), inHousePri = sum(pvPriR, r => r.inHouseGroupsServiced);
  const totalReferralsCur = sum(refCurR, r => r.count), totalReferralsPri = sum(refPriR, r => r.count);
  const rateCur = repCurR.length ? repCurR.filter(r => r.repeat === "Yes").length / repCurR.length : null;
  const ratePri = repPriR.length ? repPriR.filter(r => r.repeat === "Yes").length / repPriR.length : null;
  const teamScoreCur = mean(surCurR, r => r.rating), teamScorePri = mean(surPriR, r => r.rating);
  const hostedEventsCur = distinctCount(evsCurR, r => r.eventId), hostedEventsPri = distinctCount(evsPriR, r => r.eventId);
  const eventSatCur = mean(evsCurR, r => r.satisfaction), eventSatPri = mean(evsPriR, r => r.satisfaction);
  const leadsCurYtd = distinctCount(bbCurR, r => r.leadId), leadsPriYtd = distinctCount(bbPriR, r => r.leadId);
  const convWinCur = mean(bbCurR, r => r.daysFromLeadCreatedToEvent), convWinPri = mean(bbPriR, r => r.daysFromLeadCreatedToEvent);

  // Previous-month-only values (same single latest month as each category's
  // own YTD cutoff above) -- feeds the Department at a Glance summary table.
  const visitsMonth = sum(pvMonthR, r => r.planningVisits);
  const clientsMonth = sum(pvMonthR, r => r.clientsServiced);
  const partnersMonth = sum(pvMonthR, r => r.partnersVisited);
  const convMonth = sum(pvMonthR, r => r.conventionGroupsServiced);
  const inHouseMonth = sum(pvMonthR, r => r.inHouseGroupsServiced);
  const totalReferralsMonth = sum(refMonthR, r => r.count);
  const rateMonth = repMonthR.length ? repMonthR.filter(r => r.repeat === "Yes").length / repMonthR.length : null;
  const teamScoreMonth = mean(surMonthR, r => r.rating);
  const hostedEventsMonth = distinctCount(evsMonthR, r => r.eventId);
  const eventSatMonth = mean(evsMonthR, r => r.satisfaction);
  const leadsMonth = distinctCount(bbMonthR, r => r.leadId);
  const convWinMonth = mean(bbMonthR, r => r.daysFromLeadCreatedToEvent);

  // priValueText is the same prior-year YTD figure shown in the "Year-to-Date"
  // column of the Department at a Glance table below, just surfaced inline
  // on the card too so the % change is never shown without the number behind it.
  // dateRange/cardClass are optional -- dateRange shows the exact YTD window
  // the card's number covers, cardClass adds the "events-team" blue accent
  // for the 4 cards driven by the events team's data.
  function cardWithDelta(label, valueText, cur, pri, priYear, priValueText, dateRange, cardClass) {
    const d = pctChange(pri, cur);
    const text = d === null ? null : `${deltaArrow(d)}${pct(d)} (${priValueText} in ${priYear}) vs ${priYear} YTD`;
    return kpiCard(label, valueText, text, deltaClass(d), dateRange, cardClass);
  }
  // Once the average lead conversion window passes 90 days, months reads
  // more naturally than a large day count (matches the Booked Business tab).
  const convWinFmt = v => (v === null ? "&mdash;" : v > 90 ? fmt(v / 30, 1) + " months" : fmt(v) + " days");

  // Single source of truth for both the 12 KPI cards above and the
  // Department at a Glance summary table below -- see README.md
  // "Data source mapping" for the exact table/column/date-field each of
  // these pulls from. curYear/priYear default to 2026/2025 except the two
  // Booked-Business-driven categories, which track BB_CUR/BB_PRI (see note
  // above -- that sheet doesn't have 2026 event dates yet). "team" marks the
  // 4 categories driven by the events team's own data (vs. the services
  // team's data for everything else), used for the card color-coding below.
  const categories = [
    { label: "Partners Visited", cur: partnersCur, pri: partnersPri, month: partnersMonth, cutoff: pvCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "services" },
    { label: "Planning Visits", cur: visitsCur, pri: visitsPri, month: visitsMonth, cutoff: pvCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "services" },
    { label: "Convention Groups Serviced", cur: convCur, pri: convPri, month: convMonth, cutoff: pvCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "services" },
    { label: "In House Groups Serviced", cur: inHouseCur, pri: inHousePri, month: inHouseMonth, cutoff: pvCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "services" },
    { label: "Clients Serviced", cur: clientsCur, pri: clientsPri, month: clientsMonth, cutoff: pvCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "services" },
    { label: "Partner Referrals", cur: totalReferralsCur, pri: totalReferralsPri, month: totalReferralsMonth, cutoff: refCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "services" },
    { label: "Repeat Account %", cur: rateCur, pri: ratePri, month: rateMonth, cutoff: repCutoff, curYear: CUR, priYear: PRI, fmtFn: v => pct(v), team: "services" },
    { label: "VA Team Experience Rating", cur: teamScoreCur, pri: teamScorePri, month: teamScoreMonth, cutoff: surCutoff, curYear: CUR, priYear: PRI, fmtFn: v => (v === null ? "&mdash;" : fmt(v, 2) + " / 10"), team: "services" },
    { label: "VA Hosted Events", cur: hostedEventsCur, pri: hostedEventsPri, month: hostedEventsMonth, cutoff: evsCutoff, curYear: CUR, priYear: PRI, fmtFn: v => fmt(v), team: "events" },
    { label: "VA Event Satisfaction Score", cur: eventSatCur, pri: eventSatPri, month: eventSatMonth, cutoff: evsCutoff, curYear: CUR, priYear: PRI, fmtFn: v => pct(v), team: "events" },
    { label: `${BB_CUR} Leads Generated From VA Events`, cur: leadsCurYtd, pri: leadsPriYtd, month: leadsMonth, cutoff: bbCutoff, curYear: BB_CUR, priYear: BB_PRI, fmtFn: v => fmt(v), team: "events" },
    { label: `${BB_CUR} Avg. Lead Conversion Window`, cur: convWinCur, pri: convWinPri, month: convWinMonth, cutoff: bbCutoff, curYear: BB_CUR, priYear: BB_PRI, fmtFn: convWinFmt, team: "events" }
  ];

  document.getElementById("ov-kpiGrid").innerHTML =
    categories.map((c, i) => {
      const d = pctChange(c.pri, c.cur);
      const text = d === null ? null : `${deltaArrow(d)}${pct(d)} (${c.fmtFn(c.pri)} in ${c.priYear}) vs ${c.priYear} YTD`;
      const cardClass = `selectable${c.team === "events" ? " events-team" : ""}`;
      return kpiCard(c.label, c.fmtFn(c.cur), text, deltaClass(d), ytdRangeLabel(c.curYear, c.cutoff), cardClass, null, `data-cat-index="${i}"`);
    }).join("");

  // Per-category 1-sentence version of the narrative below -- shown instead
  // of the full 3-paragraph narrative whenever that category's card is
  // selected (see applyOverviewSelection). Same YTD cur/pri/cutoff figures
  // as everything else on this tab, so it never disagrees with the card or
  // the (now single, filtered) Department at a Glance row.
  OV_CATEGORY_SENTENCES = categories.map(c => {
    const d = pctChange(c.pri, c.cur);
    return `<p>Year to date through ${endOfMonthLabel(c.curYear, c.cutoff)}, <strong>${c.label}</strong> reached <strong>${c.fmtFn(c.cur)}</strong>${deltaSpan(d)}.</p>`;
  });

  // Every card is clickable: selecting one highlights it (light shade),
  // narrows the Department at a Glance table below to just that category's
  // row, AND swaps the narrative above the table for that one category's own
  // 1-sentence version (see OV_CATEGORY_SENTENCES/OV_FULL_NARRATIVE and
  // applyOverviewSelection). Clicking the same card again (or reloading)
  // clears the selection and restores the full 12-category view everywhere.
  // Reset on every render so a stale selection never points at a row that's
  // no longer there.
  OV_SELECTED_INDEX = null;
  document.querySelectorAll("#ov-kpiGrid .kpi-card").forEach((el, i) => {
    el.addEventListener("click", () => {
      OV_SELECTED_INDEX = OV_SELECTED_INDEX === i ? null : i;
      applyOverviewSelection();
    });
  });

  // The per-card date range (see ytdRangeLabel above) now shows each card's
  // own YTD window directly on the card, so this section no longer needs a
  // separate summary sentence stating the same thing.
  document.getElementById("ov-desc").innerHTML = "";

  // ---- Department at a Glance: automated monthly summary table covering
  // all 12 categories (previous month, year-to-date, YoY %). Regenerates
  // itself from data.json every time the workbook is updated and rebuilt --
  // no manual editing needed month to month. ----
  document.querySelector("#ov-summaryTable tbody").innerHTML = categories.map(c => {
    const d = pctChange(c.pri, c.cur);
    return `<tr><td>${c.label}</td><td>${endOfMonthLabel(c.curYear, c.cutoff)}</td><td>${c.fmtFn(c.month)}</td><td>${c.fmtFn(c.cur)}</td><td class="${deltaClass(d)}">${d === null ? "&mdash;" : deltaArrow(d) + pct(d)}</td></tr>`;
  }).join("");

  // ---- narrative insight: summarizes all 12 KPI categories in prose,
  // reusing the exact same YTD cur/pri figures computed above for the cards
  // and the Department at a Glance table -- so the numbers here always match
  // what's shown above them (no separate/independent year logic). ----
  const dVisits = pctChange(visitsPri, visitsCur), dClients = pctChange(clientsPri, clientsCur), dPartners = pctChange(partnersPri, partnersCur);
  const dConv = pctChange(convPri, convCur), dInHouse = pctChange(inHousePri, inHouseCur);
  const dRef = pctChange(totalReferralsPri, totalReferralsCur), dRate = pctChange(ratePri, rateCur), dTeamScore = pctChange(teamScorePri, teamScoreCur);
  const dHostedEvents = pctChange(hostedEventsPri, hostedEventsCur), dEventSat = pctChange(eventSatPri, eventSatCur);
  const dLeads = pctChange(leadsPriYtd, leadsCurYtd), dConvWin = pctChange(convWinPri, convWinCur);

  // Strictly factual: states each of the 12 KPI categories' YTD figure and
  // YoY delta, grouped by theme for readability. No interpretation,
  // explanations, or suggested next steps -- just the numbers.
  const paras = [];
  paras.push(`<p>Year to date through ${endOfMonthLabel(CUR, pvCutoff)}, the team logged <strong>${fmt(partnersCur)}</strong> partner visits${deltaSpan(dPartners)}, <strong>${fmt(visitsCur)}</strong> planning visits${deltaSpan(dVisits)}, <strong>${fmt(convCur)}</strong> convention groups serviced${deltaSpan(dConv)}, <strong>${fmt(inHouseCur)}</strong> in-house groups serviced${deltaSpan(dInHouse)}, and <strong>${fmt(clientsCur)}</strong> clients serviced${deltaSpan(dClients)}.</p>`);
  paras.push(`<p>Partner referrals reached <strong>${fmt(totalReferralsCur)}</strong>${deltaSpan(dRef)}, the repeat account rate is <strong>${pct(rateCur)}</strong>${deltaSpan(dRate)}, and the Visit Anaheim team experience rating is <strong>${fmt(teamScoreCur, 2)}/10</strong>${deltaSpan(dTeamScore)}.</p>`);
  paras.push(`<p>The team hosted <strong>${fmt(hostedEventsCur)}</strong> surveyed VA events${deltaSpan(dHostedEvents)} at an average <strong>${pct(eventSatCur)}</strong> satisfaction score${deltaSpan(dEventSat)}, generating <strong>${fmt(leadsCurYtd)}</strong> leads${deltaSpan(dLeads)} with an average lead conversion window of <strong>${convWinFmt(convWinCur)}</strong>${deltaSpan(dConvWin)}.</p>`);
  OV_FULL_NARRATIVE = paras.join("");
  document.getElementById("ov-insights").innerHTML = OV_FULL_NARRATIVE;

  // Header "Reporting period" pill (see TAB_REPORTING_PERIODS/switchTab):
  // Overview's 12 cards each cover their own category's YTD window, so the
  // header uses the same Jan-1-through-cutoff window as the Planning Visits
  // cards (the tab's primary/first-shown metrics) as the representative
  // period for the tab as a whole.
  setReportingPeriod("overview", ytdRangeLabel(CUR, pvCutoff));
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

  document.getElementById("team-kpiGrid").innerHTML = [
    kpiCard("Partners Visited*", fmt(sum(rows, r => r.partnersVisited)), ytdDeltaText(dPartnersV, fmt), deltaClass(dPartnersV.d), teamRange),
    kpiCard("Planning Visits", fmt(sum(rows, r => r.planningVisits)), ytdDeltaText(dPlanningV, fmt), deltaClass(dPlanningV.d), teamRange),
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
// cards use: "▲ 12.3% (45 in 2025) vs 2025 YTD".
function ytdDeltaText(res, fmtFn) {
  if (!res || res.d === null || res.priYear === undefined) return null;
  return `${deltaArrow(res.d)}${pct(res.d)} (${fmtFn(res.priVal)} in ${res.priYear}) vs ${res.priYear} YTD`;
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
  const years = getYears(DATA.partnerReferrals.raw);
  populateYearSelect(sel, years, () => renderReferrals(sel.value));
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  sel.value = defaultYear;
  renderReferrals(defaultYear);
}
function renderReferrals(year) {
  const all = DATA.partnerReferrals.raw;
  const rows = byYear(all, year);
  const total = sum(rows, r => r.count);
  const byStaff = groupBy(rows, r => r.staff);
  const staffTotals = [...byStaff.entries()].map(([staff, rs]) => ({ staff, total: sum(rs, r => r.count) })).sort((a, b) => b.total - a.total);
  // "Avg. Referrals Per Month" (renamed from "Avg. Referrals per Entry") is a
  // plain AVERAGE() of the "Partner Referrals" count column for the selected
  // year, matching the live value (3.45 for 2026) -- confirmed this is a
  // straight row-level average, not first summed-by-month. Dynamic with the
  // Year filter via `rows` above.
  const avgPerMonth = rows.length ? total / rows.length : null;
  // Dynamic date-range subtitle -- dynamic with the Year filter via `rows`.
  const refRange = rangeLabel(rows, "date");

  // YoY % delta on every card -- same YTD-cutoff methodology as Overview
  // (see ytdYoyMetric).
  const { prior: refPrior, latest: refLatest } = resolveYoyYears(all, year);
  const dTotalRef = ytdYoyMetric(all, "date", refLatest, refPrior, null, rs => sum(rs, r => r.count));
  const dAvgRef = ytdYoyMetric(all, "date", refLatest, refPrior, null, rs => rs.length ? sum(rs, r => r.count) / rs.length : null);

  document.getElementById("ref-kpiGrid").innerHTML = [
    kpiCard("Partner Referrals", fmt(total), ytdDeltaText(dTotalRef, fmt), deltaClass(dTotalRef.d), refRange),
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

  setReportingPeriod("referrals", refRange);
}

// =====================================================================
// REPEAT CLIENTS
// =====================================================================
function initRepeat() {
  const yearSel = document.getElementById("rep-year");
  const acctSel = document.getElementById("rep-account");
  const mgrSel = document.getElementById("rep-manager");
  const repeatSel = document.getElementById("rep-repeat");
  function applyFilters() { renderRepeat(yearSel.value, acctSel.value, mgrSel.value, repeatSel.value); }
  const years = getYears(DATA.repeatingClients.raw);
  populateYearSelect(yearSel, years, applyFilters);
  const accounts = [...new Set(DATA.repeatingClients.raw.map(r => r.accountName).filter(Boolean))].sort();
  acctSel.innerHTML = `<option value="All">All</option>` + accounts.map(a => `<option value="${a}">${a}</option>`).join("");
  acctSel.value = "All";
  acctSel.onchange = applyFilters;
  const managers = [...new Set(DATA.repeatingClients.raw.map(r => r.servicesManager).filter(Boolean))].sort();
  mgrSel.innerHTML = `<option value="All">All</option>` + managers.map(m => `<option value="${m}">${m}</option>`).join("");
  mgrSel.value = "All";
  mgrSel.onchange = applyFilters;
  // "Repeat" filter on the Repeat Business Yes/No column.
  repeatSel.innerHTML = `<option value="All">All</option><option value="Yes">Yes</option><option value="No">No</option>`;
  repeatSel.value = "All";
  repeatSel.onchange = applyFilters;
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  yearSel.value = defaultYear;
  renderRepeat(defaultYear, "All", "All", "All");
}
function renderRepeat(year, accountName, manager, repeatFilter) {
  let rows = byYear(DATA.repeatingClients.raw, year);
  if (accountName && accountName !== "All") rows = rows.filter(r => r.accountName === accountName);
  if (manager && manager !== "All") rows = rows.filter(r => r.servicesManager === manager);
  if (repeatFilter && repeatFilter !== "All") rows = rows.filter(r => r.repeat === repeatFilter);
  // "Total Clients Serviced" = distinct count of Lead ID (not raw row count) --
  // matches the sheet's grain 1:1 today (no duplicate Lead IDs), but this is
  // the correct, future-proof formula per spec.
  const totalRows = rows.length;
  const totalClientsServiced = distinctCount(rows, r => r.leadId);
  // Repeat Clients Count = CALCULATE(COUNTROWS('RepeatingBusiness'), KEEPFILTERS('RepeatingBusiness'[Repeat Business] = "Yes"))
  const repeatYes = rows.filter(r => r.repeat === "Yes").length;
  // Repeat Client % = DIVIDE(Repeat Clients Count, COUNTROWS('RepeatingBusiness'), 0)
  const rate = totalRows ? repeatYes / totalRows : null;
  const accountsServiced = distinctCount(rows, r => r.accountId);
  const acctCounts = groupBy(rows, r => r.accountId);
  // Repeat Accounts Count = COUNTROWS(FILTER(VALUES('RepeatingBusiness'[Account ID]), CALCULATE(COUNTROWS('RepeatingBusiness')) > 1))
  const accountsWithRepeatBookings = [...acctCounts.values()].filter(v => v.length > 1).length;

  // Dynamic date-range subtitle -- dynamic with the Year/Account/Manager filters via `rows`.
  const repRange = rangeLabel(rows, "startDate");

  // YoY % delta on every card -- same YTD-cutoff methodology as Overview
  // (see ytdYoyMetric). Uses the same Account Name/Services Manager/Repeat
  // filtered base (`repYoyBase`, defined below near the Year-over-Year
  // table) so the delta always reflects whatever's currently filtered.
  const repYoyBase = DATA.repeatingClients.raw
    .filter(r => !accountName || accountName === "All" || r.accountName === accountName)
    .filter(r => !manager || manager === "All" || r.servicesManager === manager)
    .filter(r => !repeatFilter || repeatFilter === "All" || r.repeat === repeatFilter);
  const { prior: repPrior, latest: repLatest } = resolveYoyYears(repYoyBase, year);
  function repYoy(metricFn) { return ytdYoyMetric(repYoyBase, "startDate", repLatest, repPrior, null, metricFn); }
  const dTotalClients = repYoy(rs => distinctCount(rs, r => r.leadId));
  const dTotalAccounts = repYoy(rs => distinctCount(rs, r => r.accountId));
  const dRepeatAccounts = repYoy(rs => rs.filter(r => r.repeat === "Yes").length);
  const dRepeatRate = repYoy(rs => rs.length ? rs.filter(r => r.repeat === "Yes").length / rs.length : null);
  const dAcctsRepeatBookings = repYoy(rs => { const ac = groupBy(rs, r => r.accountId); return [...ac.values()].filter(v => v.length > 1).length; });

  document.getElementById("rep-kpiGrid").innerHTML = [
    kpiCard("Total Clients Serviced", fmt(totalClientsServiced), ytdDeltaText(dTotalClients, fmt), deltaClass(dTotalClients.d), repRange),
    kpiCard("Total Accounts Serviced", fmt(accountsServiced), ytdDeltaText(dTotalAccounts, fmt), deltaClass(dTotalAccounts.d), repRange),
    kpiCard("Repeat Accounts", fmt(repeatYes), ytdDeltaText(dRepeatAccounts, fmt), deltaClass(dRepeatAccounts.d), repRange),
    kpiCard("Repeat Account Percentage", pct(rate), ytdDeltaText(dRepeatRate, pct), deltaClass(dRepeatRate.d), repRange),
    kpiCard("Accounts w/ Repeat Bookings", fmt(accountsWithRepeatBookings), ytdDeltaText(dAcctsRepeatBookings, fmt), deltaClass(dAcctsRepeatBookings.d), repRange)
  ].join("");

  const byMgr = groupBy(rows, r => r.servicesManager);
  const mgrs = [...byMgr.keys()];
  makeChart("rep-chart1", {
    type: "bar",
    data: {
      labels: mgrs,
      datasets: [
        // Zero-count segments are suppressed (formatter) so a "0" label
        // never floats on top of a zero-width bar next to a real segment.
        { label: "Repeat", data: mgrs.map(m => byMgr.get(m).filter(r => r.repeat === "Yes").length), backgroundColor: COLORS.navy, borderRadius: 4, datalabels: { color: "#ffffff", anchor: "center", align: "center", formatter: (v) => v ? v : "" } },
        { label: "New", data: mgrs.map(m => byMgr.get(m).filter(r => r.repeat !== "Yes").length), backgroundColor: COLORS.teal, borderRadius: 4, datalabels: { color: "#ffffff", anchor: "center", align: "center", formatter: (v) => v ? v : "" } }
      ]
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } }
  });
  const repeatAccountIds = new Set(rows.filter(r => r.repeat === "Yes").map(r => r.accountId));
  const repeatAccountsCount = repeatAccountIds.size;
  // "Clients" ring = distinct Lead ID split by Repeat Business Yes/No (not
  // raw row counts) -- matches today's data 1:1 since Lead ID is already
  // unique per row, but this is the correct formula per spec.
  const repeatClientLeadIds = new Set(rows.filter(r => r.repeat === "Yes").map(r => r.leadId));
  const repeatClientsCount = repeatClientLeadIds.size;
  makeChart("rep-chart2", {
    type: "doughnut",
    data: {
      labels: ["Repeat", "New"],
      datasets: [
        { label: "Accounts", data: [repeatAccountsCount, accountsServiced - repeatAccountsCount], backgroundColor: [COLORS.navy, COLORS.pale], datalabels: { display: true, anchor: "center", align: "center", color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) } },
        { label: "Clients", data: [repeatClientsCount, totalClientsServiced - repeatClientsCount], backgroundColor: [COLORS.teal, COLORS.tealLight], datalabels: { display: true, anchor: "center", align: "center", color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) } }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "35%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} - ${ctx.label}: ${ctx.parsed}` } }
      }
    }
  });

  const withBookings = rows.map(r => ({ ...r, bookings: acctCounts.get(r.accountId).length }))
    .sort((a, b) => b.bookings - a.bookings || (b.attendance || 0) - (a.attendance || 0))
    .slice(0, 30);
  // "Lead" (Lead Name), "Start Date"/"End Date" (Meeting Dates Preferred
  // Start/End -- startDate/endDate, see build_data.py) inserted before
  // Attendance, per direction.
  document.querySelector("#rep-clientsTable tbody").innerHTML = withBookings.map(r =>
    `<tr><td>${r.accountName}</td><td>${r.leadName || "&mdash;"}</td><td>${mdy(r.startDate) || "&mdash;"}</td><td>${mdy(r.endDate) || "&mdash;"}</td><td>${fmt(r.attendance)}</td><td>${fmt(r.peakRoom)}</td><td>${r.repeat}</td><td>${r.bookings}</td><td>${r.servicesManager}</td></tr>`
  ).join("");

  // Year over Year table (same pattern as Partner Referrals' YoY table):
  // respects the Account Name / Services Manager filters above, but not the
  // Year filter itself, since the table derives its own prior/selected-year
  // comparison from `year`. "Clients" = a plain COUNT of Lead ID; "Accounts"
  // = a DISTINCT COUNT of Account ID (both from the Repeating ACC Clients
  // Services / "RepeatingBusiness" sheet).
  let yoyRows = DATA.repeatingClients.raw;
  if (accountName && accountName !== "All") yoyRows = yoyRows.filter(r => r.accountName === accountName);
  if (manager && manager !== "All") yoyRows = yoyRows.filter(r => r.servicesManager === manager);
  if (repeatFilter && repeatFilter !== "All") yoyRows = yoyRows.filter(r => r.repeat === repeatFilter);
  const yoyMetrics = [
    { label: "Clients", agg: rs => rs.filter(r => r.leadId !== null && r.leadId !== undefined).length },
    { label: "Accounts", agg: rs => distinctCount(rs, r => r.accountId) }
  ];
  renderYoyTable("rep-yoyTable", yoyRows, yoyMetrics, year, "startDate", null);

  document.getElementById("rep-yoy-analysis").innerHTML = yoyAnalysisSentence(yoyRows, yoyMetrics, year, "startDate", null);

  // Auto-analysis sentences (bolded values) -- per direction, every visual on
  // this tab states the latest available month of data (not a year-to-date/
  // whole-period aggregate) for the current/latest year (or "All"). But once
  // a *completed past* year is selected in the Year filter, "latest month"
  // would just mean that year's last month, which reads oddly compared to
  // how every other tab (Team KPIs, Partner Referrals, Client Survey, Hosted
  // Events) instead states that year's full-year totals via isPastYear --
  // so this tab now follows the exact same isPastYear pattern for
  // consistency. Uses `repYoyBase` (Account/Manager/Repeat-filtered, but not
  // Year-filtered) to decide past-vs-current, same convention used
  // everywhere else on the dashboard.
  if (isPastYear(repYoyBase, year)) {
    const topMgrYear = topEntry(
      [...groupBy(rows, r => r.servicesManager).entries()].map(([m, rs]) => ({ m, total: rs.length })),
      x => x.total
    );
    document.getElementById("rep-analysis1").innerHTML = topMgrYear
      ? `In <strong>${year}</strong>, <strong>${topMgrYear.item.m}</strong> serviced the most clients, with <strong>${fmt(topMgrYear.v)}</strong> total (repeat + new).`
      : "No data available for this period yet.";

    const yearTotalClients = distinctCount(rows, r => r.leadId);
    const yearRepeatClients = new Set(rows.filter(r => r.repeat === "Yes").map(r => r.leadId)).size;
    document.getElementById("rep-analysis2").innerHTML = `In <strong>${year}</strong>, of the <strong>${fmt(yearTotalClients)}</strong> clients serviced, <strong>${fmt(yearRepeatClients)}</strong> were repeat clients (<strong>${pct(yearTotalClients ? yearRepeatClients / yearTotalClients : null)}</strong>).`;

    // Accounts table: the account with the most bookings across the whole
    // selected year (acctCounts is already this tab's full filtered set).
    const topAccountYear = topEntry(
      [...acctCounts.entries()].map(([id, rs]) => ({ name: rs[0].accountName, count: rs.length })),
      x => x.count
    );
    document.getElementById("rep-analysis3").innerHTML = topAccountYear
      ? `In <strong>${year}</strong>, <strong>${topAccountYear.item.name}</strong> had the most bookings, with <strong>${fmt(topAccountYear.v)}</strong>.`
      : "No data available for this period yet.";
  } else {
    const repMonths = [...new Set(rows.map(r => monthKey(r.startDate)))].sort();
    const repLatestMonth = repMonths.length ? repMonths[repMonths.length - 1] : null;
    const repLatestRows = repLatestMonth ? rows.filter(r => monthKey(r.startDate) === repLatestMonth) : [];

    const topMgrMonth = topEntry(
      [...groupBy(repLatestRows, r => r.servicesManager).entries()].map(([m, rs]) => ({ m, total: rs.length })),
      x => x.total
    );
    document.getElementById("rep-analysis1").innerHTML = (repLatestMonth && topMgrMonth)
      ? `In <strong>${monthLabel(repLatestMonth)}</strong>, <strong>${topMgrMonth.item.m}</strong> serviced the most clients, with <strong>${fmt(topMgrMonth.v)}</strong> total (repeat + new).`
      : "No data available for this period yet.";

    const monthTotalClients = distinctCount(repLatestRows, r => r.leadId);
    const monthRepeatClients = new Set(repLatestRows.filter(r => r.repeat === "Yes").map(r => r.leadId)).size;
    document.getElementById("rep-analysis2").innerHTML = repLatestMonth
      ? `In <strong>${monthLabel(repLatestMonth)}</strong>, of the <strong>${fmt(monthTotalClients)}</strong> clients serviced, <strong>${fmt(monthRepeatClients)}</strong> were repeat clients (<strong>${pct(monthTotalClients ? monthRepeatClients / monthTotalClients : null)}</strong>).`
      : "No data available for this period yet.";

    // Accounts table: the account with the most bookings recorded in the
    // latest month specifically (row count for that account within that
    // month), not its all-time/whole-period bookings total.
    const monthAcctCounts = groupBy(repLatestRows, r => r.accountId);
    const topAccountMonth = topEntry(
      [...monthAcctCounts.entries()].map(([id, rs]) => ({ name: rs[0].accountName, count: rs.length })),
      x => x.count
    );
    document.getElementById("rep-analysis3").innerHTML = (repLatestMonth && topAccountMonth)
      ? `In <strong>${monthLabel(repLatestMonth)}</strong>, <strong>${topAccountMonth.item.name}</strong> had the most bookings, with <strong>${fmt(topAccountMonth.v)}</strong>.`
      : "No data available for this period yet.";
  }

  setReportingPeriod("repeat", repRange);
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
  mgrSel.innerHTML = `<option value="All">All</option>` + managers.map(m => `<option value="${m}">${m}</option>`).join("");
  mgrSel.value = "All";
  mgrSel.onchange = applyFilters;
  // Question filter -- every rated question (excludes Q7, the open-ended
  // feedback question, which isn't a rating and belongs to the separate
  // "Feedback" section instead).
  const questionOpts = DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  qSel.innerHTML = `<option value="All">All</option>` + questionOpts.map(q => `<option value="${q}">${q}</option>`).join("");
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
    kpiCard(teamScoreLabel, fmt(teamScore, 2), ytdDeltaText(dTeamScore, v => fmt(v, 2)), deltaClass(dTeamScore.d), surRange, "", teamScoreNote),
    kpiCard("DS&amp;E Manager Experience Score", fmt(managerScore, 2), ytdDeltaText(dManagerScore, v => fmt(v, 2)), deltaClass(dManagerScore.d), surRange),
    kpiCard("Survey Respondents", fmt(respondents), ytdDeltaText(dRespondents, fmt), deltaClass(dRespondents.d), surRange)
  ].join("");

  document.getElementById("sur-chart1-title").innerHTML = "VA Survey Questions Rating" + titleSuffix;
  document.getElementById("sur-chart2-title").innerHTML = "VA Team Experience Avg. Score by Month" + titleSuffix + ` <span class="tag">Monthly</span>`;
  document.getElementById("sur-chart3-title").innerHTML = "Avg. Rating by DS&amp;E Manager" + titleSuffix;
  document.getElementById("sur-yoyValues-title").innerHTML = "Ratings by Year" + titleSuffix;
  document.getElementById("sur-yoyPct-title").innerHTML = "Year-over-Year % Change" + titleSuffix;
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
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 10 } } }
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
  // is limited to the same Jan-1-through-cutoff window of months (the
  // cutoff being the latest month with real data in the most recent year),
  // so every year column is an apples-to-apples YTD comparison rather than
  // mixing complete past years against a partial current year.
  const YEARS = getYears(DATA.accSurvey.raw);
  const surYearlyCutoff = ytdCutoff(all.filter(r => r.year === Math.max(...YEARS) && r.rating !== null), "date");
  const questions = hasQ ? [question] : DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  const yearlyByQ = questions.map(q => {
    const yearly = {};
    YEARS.forEach(y => { yearly[y] = mean(ytdRows(all, "date", y, surYearlyCutoff).filter(r => r.question === q), r => r.rating); });
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
  document.getElementById("sur-yoy-analysis").innerHTML = yoyAnalysisSentence(
    all.filter(r => questions.includes(r.question)),
    questions.map(q => ({ label: q, agg: rs => mean(rs.filter(r => r.question === q), r => r.rating) })),
    year, "date", ["rating"]
  );

  setReportingPeriod("survey", surRange);
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
  // ACC Survey sheet for each response.
  const cols = document.getElementById("testimonialCols");
  cols.innerHTML = YEARS.map(y => {
    const items = testimonialsByYear[y] || [];
    return items.map(it => {
      const sentiment = resolveSentiment(it);
      return `<div class="testimonial"><div class="yr"><span>${y}</span><span class="sentiment-badge ${sentiment.toLowerCase()}">${sentiment}</span></div>&ldquo;${it.feedback.length > 220 ? it.feedback.slice(0, 220) + "&hellip;" : it.feedback}&rdquo;</div>`;
    }).join("");
  }).join("");

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

// =====================================================================
// HOSTED EVENTS
// =====================================================================
function initEvents() {
  const yearSel = document.getElementById("hev-year");
  const catSel = document.getElementById("hev-category");
  const evtSel = document.getElementById("hev-event");
  function applyFilters() { renderEvents(yearSel.value, catSel.value, evtSel.value); }
  const years = getYears(DATA.eventSurveys.raw);
  populateYearSelect(yearSel, years, applyFilters);
  const cats = [...new Set(DATA.eventSurveys.raw.map(r => r.category).filter(Boolean))].sort();
  catSel.innerHTML = `<option value="All">All</option>` + cats.map(c => `<option value="${c}">${c}</option>`).join("");
  catSel.value = "All";
  catSel.onchange = applyFilters;
  const evts = [...new Set(DATA.eventSurveys.raw.map(r => r.event).filter(Boolean))].sort();
  evtSel.innerHTML = `<option value="All">All</option>` + evts.map(e => `<option value="${e}">${e}</option>`).join("");
  evtSel.value = "All";
  evtSel.onchange = applyFilters;
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  yearSel.value = defaultYear;
  applyFilters();
}
function renderEvents(year, category, eventName) {
  let rows = byYear(DATA.eventSurveys.raw, year);
  if (category !== "All") rows = rows.filter(r => r.category === category);
  if (eventName && eventName !== "All") rows = rows.filter(r => r.event === eventName);

  const totalEvents = distinctCount(rows, r => r.eventId);
  const attendeeRows = rows.filter(r => r.surveyType === "Attendee");
  const partnerRows = rows.filter(r => r.surveyType === "Partner");
  // "Survey Respondents" is a plain COUNT of the Event ID column (every row
  // is one response, so this is the same as counting rows) -- not a distinct
  // count, unlike "Total Events" above.
  const respondents = rows.filter(r => r.eventId !== null && r.eventId !== undefined).length;
  const avgSatisfaction = mean(rows, r => r.satisfaction);
  // Dynamic date-range subtitle -- dynamic with the Year/Category/Event filters via `rows`.
  const hevRange = rangeLabel(rows, "date");

  // YoY % delta on every card -- same YTD-cutoff methodology as Overview
  // (see ytdYoyMetric), using the Category/Event-Name-filtered base (but not
  // Year-filtered) so the delta always reflects whatever's currently filtered.
  let hevYoyBase = DATA.eventSurveys.raw;
  if (category !== "All") hevYoyBase = hevYoyBase.filter(r => r.category === category);
  if (eventName && eventName !== "All") hevYoyBase = hevYoyBase.filter(r => r.event === eventName);
  const { prior: hevPrior, latest: hevLatest } = resolveYoyYears(hevYoyBase, year);
  function hevYoy(metricFn) { return ytdYoyMetric(hevYoyBase, "date", hevLatest, hevPrior, null, metricFn); }
  const dTotalEvents = hevYoy(rs => distinctCount(rs, r => r.eventId));
  const dAttendeeEvents = hevYoy(rs => distinctCount(rs.filter(r => r.surveyType === "Attendee"), r => r.eventId));
  const dPartnerEvents = hevYoy(rs => distinctCount(rs.filter(r => r.surveyType === "Partner"), r => r.eventId));
  const dRespondents2 = hevYoy(rs => rs.filter(r => r.eventId !== null && r.eventId !== undefined).length);
  const dAvgSat = hevYoy(rs => mean(rs, r => r.satisfaction));

  // Hosted Events and Booked Business both represent the events team's own
  // data, so every card on these two tabs gets the same pale-blue
  // "events-team" accent used for the 4 events-team cards on the Overview tab.
  document.getElementById("hev-kpiGrid").innerHTML = [
    kpiCard("Total Events", fmt(totalEvents), ytdDeltaText(dTotalEvents, fmt), deltaClass(dTotalEvents.d), hevRange, "events-team"),
    kpiCard("Attendee Events", fmt(distinctCount(attendeeRows, r => r.eventId)), ytdDeltaText(dAttendeeEvents, fmt), deltaClass(dAttendeeEvents.d), hevRange, "events-team"),
    kpiCard("Partner Events", fmt(distinctCount(partnerRows, r => r.eventId)), ytdDeltaText(dPartnerEvents, fmt), deltaClass(dPartnerEvents.d), hevRange, "events-team"),
    kpiCard("Survey Respondents", fmt(respondents), ytdDeltaText(dRespondents2, fmt), deltaClass(dRespondents2.d), hevRange, "events-team"),
    kpiCard("Avg. Satisfaction Score", pct(avgSatisfaction), ytdDeltaText(dAvgSat, pct), deltaClass(dAvgSat.d), hevRange, "events-team")
  ].join("");

  const byMonth = groupBy(rows, r => monthKey(r.date));
  const months = [...byMonth.keys()].sort();
  makeChart("hev-chart1", {
    type: "bar",
    data: { labels: months.map(monthLabel), datasets: [{ label: "Events", data: months.map(m => distinctCount(byMonth.get(m), r => r.eventId)), backgroundColor: COLORS.navy, borderRadius: 4 }] },
    // Extra top padding so a bar hitting the top of the scale still has room
    // for its data label instead of getting clipped by the chart edge.
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Question Ratings: x-axis is Event Date by month (same grain as "Events
  // by Month"), one series per question, each averaged within that month.
  const byMonthQ = groupBy(rows, r => monthKey(r.date));
  const monthsQ = [...byMonthQ.keys()].sort();
  makeChart("hev-chart2", {
    type: "bar",
    data: {
      labels: monthsQ.map(monthLabel),
      datasets: [
        { label: "Overall Experience", data: monthsQ.map(m => mean(byMonthQ.get(m), r => r.overall)), backgroundColor: COLORS.seriesA },
        { label: "Recommend Future Events", data: monthsQ.map(m => mean(byMonthQ.get(m), r => r.recommend)), backgroundColor: COLORS.seriesB },
        { label: "Arrival and Registration", data: monthsQ.map(m => mean(byMonthQ.get(m), r => r.registration)), backgroundColor: COLORS.seriesC },
        // satisfaction is stored 0-1 (e.g. 0.8 = 4/5); *5 puts it on the same
        // 0-5 scale as the other three so it's directly comparable here.
        { label: "Satisfaction Score", data: monthsQ.map(m => { const v = mean(byMonthQ.get(m), r => r.satisfaction); return v === null ? null : v * 5; }), backgroundColor: COLORS.seriesD }
      ]
    },
    // Extra top padding so a bar hitting the max (5) still has room for its
    // data label instead of getting clipped by the chart edge.
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { position: "bottom" } }, scales: { y: { min: 0, max: 5 } } }
  });

  const qDef = [
    { label: "Overall Experience", fn: r => r.overall, format: (v) => fmt(v, 2) },
    { label: "Recommend Future Events", fn: r => r.recommend, format: (v) => fmt(v, 2) },
    { label: "Arrival and Registration", fn: r => r.registration, format: (v) => fmt(v, 2) },
    { label: "Satisfaction Score", fn: r => r.satisfaction, format: (v) => pct(v) }
  ];
  document.querySelector("#hev-byQuestionTable tbody").innerHTML = qDef.map(q =>
    `<tr><td>${q.label}</td><td>${q.format(mean(attendeeRows, q.fn))}</td><td>${q.format(mean(partnerRows, q.fn))}</td><td><strong>${q.format(mean(rows, q.fn))}</strong></td></tr>`
  ).join("");

  const byCat = groupBy(rows, r => r.category);
  document.querySelector("#hev-byCategoryTable tbody").innerHTML = [...byCat.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, rs]) => `<tr><td>${cat}</td><td>${rs.length}</td><td>${pct(mean(rs, r => r.satisfaction))}</td><td>${fmt(mean(rs, r => r.overall), 2)}</td><td>${fmt(mean(rs, r => r.registration), 2)}</td><td>${fmt(mean(rs, r => r.recommend), 2)}</td></tr>`)
    .join("");

  // One row per event/survey-type combination (not one per respondent).
  const seenEventType = new Set();
  const detailRows = [];
  rows.forEach(r => {
    const key = r.eventId + "|" + r.surveyType;
    if (!seenEventType.has(key)) { seenEventType.add(key); detailRows.push(r); }
  });
  document.querySelector("#hev-detailTable tbody").innerHTML = detailRows
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map(r => `<tr><td>${r.event}</td><td>${r.surveyType}</td><td>${r.category || "&mdash;"}</td><td>${r.date || "&mdash;"}</td></tr>`)
    .join("");

  // Auto-analysis sentences (bolded values). Both charts on this tab are
  // month-based: for the current/latest year (or "All") they state the
  // latest populated month; for a completed past year they state that
  // year's full-year figures instead (see isPastYear).
  const pastYearHev = isPastYear(hevYoyBase, year);
  if (pastYearHev) {
    document.getElementById("hev-analysis1").innerHTML = `In <strong>${year}</strong>, the team hosted a total of <strong>${fmt(totalEvents)}</strong> events.`;
  } else {
    const latestMonthKeyEv = months.length ? months[months.length - 1] : null;
    document.getElementById("hev-analysis1").innerHTML = latestMonthKeyEv
      ? `In <strong>${monthLabel(latestMonthKeyEv)}</strong>, the team hosted <strong>${fmt(distinctCount(byMonth.get(latestMonthKeyEv), r => r.eventId))}</strong> events.`
      : "No data available for this period yet.";
  }
  if (pastYearHev) {
    document.getElementById("hev-analysis2").innerHTML = `In <strong>${year}</strong>, Overall Experience averaged <strong>${fmt(mean(rows, r => r.overall), 2)}</strong> and Satisfaction Score averaged <strong>${pct(avgSatisfaction)}</strong> overall.`;
  } else {
    const latestMonthKeyQ = monthsQ.length ? monthsQ[monthsQ.length - 1] : null;
    document.getElementById("hev-analysis2").innerHTML = latestMonthKeyQ
      ? (() => {
          const rs = byMonthQ.get(latestMonthKeyQ);
          const satV = mean(rs, r => r.satisfaction);
          return `In <strong>${monthLabel(latestMonthKeyQ)}</strong>, Overall Experience averaged <strong>${fmt(mean(rs, r => r.overall), 2)}</strong> and Satisfaction Score averaged <strong>${pct(satV)}</strong>.`;
        })()
      : "No data available for this period yet.";
  }

  // Table auto-analysis sentences.
  const qOverallTotal = mean(rows, r => r.overall);
  document.getElementById("hev-analysis3").innerHTML = qOverallTotal !== null
    ? `Overall, respondents rated "Overall Experience" <strong>${fmt(qOverallTotal, 2)}</strong> out of 5 on average.`
    : "No data available for this period yet.";
  const topCat = topEntry([...byCat.entries()].map(([cat, rs]) => ({ cat, rs })), x => x.rs.length);
  document.getElementById("hev-analysis4").innerHTML = topCat
    ? `<strong>${topCat.item.cat}</strong> has the most respondents, with <strong>${fmt(topCat.v)}</strong> and an average satisfaction score of <strong>${pct(mean(topCat.item.rs, r => r.satisfaction))}</strong>.`
    : "No data available for this period yet.";
  // Event Survey Detail auto-analysis: names the event with the most
  // survey-type coverage (Attendee + Partner, where both exist) instead of
  // just stating a generic row/event count -- matches the "named top entity"
  // style used by Repeat Clients' Accounts analysis (rep-analysis3) and
  // Booked Business' Events That Generated Leads Detail analysis (bb-analysis4).
  const detailByEvent = groupBy(detailRows, r => r.event);
  const topDetailEvent = topEntry(
    [...detailByEvent.entries()].map(([name, rs]) => ({ name, count: rs.length })),
    x => x.count
  );
  document.getElementById("hev-analysis5").innerHTML = (detailRows.length && topDetailEvent)
    ? `<strong>${topDetailEvent.item.name}</strong> has the most survey-type coverage, with <strong>${fmt(topDetailEvent.v)}</strong> survey type${topDetailEvent.v === 1 ? "" : "s"} recorded, across <strong>${fmt(totalEvents)}</strong> distinct events total.`
    : "No data available for this period yet.";

  setReportingPeriod("events", hevRange);
}

// Cross-reference: eventSurveys and bookedBusiness share the same eventId
// namespace (names differ between the two sheets, e.g. "Ducks vs. Stars" in
// Event Surveys is "2025 March Ducks vs. Dallas Stars" in Booked Business).
// Uses the same unique-lead-per-event convention as the rest of this tab
// (dedupeBy leadId) -- a handful of leads span more than one event in the
// source data and get attributed to whichever event they list first, so this
// shows 5 of the 6 ID-matching events (the 6th's leads all attribute
// elsewhere). Now dynamic with the Booked Business tab's Year/Lead
// Status/Event Name filters (previously always showed all years).
function renderHevBookedLink(year, status, eventName) {
  // Same "All" scoping fix as the Total Events card: when Year = All, the
  // Event Surveys side only counts years that actually exist in the Booked
  // Business sheet (currently just 2025), not every year Event Surveys has
  // on file, so this cross-reference's "total events" figure always agrees
  // with the Total Events KPI card above it.
  const bbYearsPresent = getYears(DATA.bookedBusiness.raw);
  let es = DATA.eventSurveys.raw;
  es = (year && year !== "All") ? es.filter(r => r.year === Number(year)) : es.filter(r => bbYearsPresent.includes(r.year));
  const totalEventsForYear = distinctCount(es, r => r.eventId);

  let bbRaw = DATA.bookedBusiness.raw;
  if (year && year !== "All") bbRaw = bbRaw.filter(r => r.year === Number(year));
  if (status && status !== "All") bbRaw = bbRaw.filter(r => r.leadStatus === status);
  if (eventName && eventName !== "All") bbRaw = bbRaw.filter(r => r.eventName === eventName);
  const bb = dedupeBy(bbRaw, r => r.leadId);

  const esByEvent = groupBy(es, r => r.eventId);
  const bbByEvent = groupBy(bb, r => r.eventId);
  const rows = [...esByEvent.keys()]
    .filter(id => bbByEvent.has(id))
    .map(id => {
      const esRows = esByEvent.get(id);
      return {
        name: esRows[0].event,
        respondents: esRows.length,
        satisfaction: mean(esRows, r => r.satisfaction),
        leads: bbByEvent.get(id).length
      };
    })
    .sort((a, b) => b.leads - a.leads);

  makeChart("hev-bbChart", {
    type: "bar",
    data: {
      labels: rows.map(r => r.name),
      datasets: [
        { label: "Survey Respondents", data: rows.map(r => r.respondents), backgroundColor: COLORS.tealLight },
        { label: "Leads Generated", data: rows.map(r => r.leads), backgroundColor: COLORS.navy }
      ]
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { beginAtZero: true } } }
  });
  document.querySelector("#hev-bbTable tbody").innerHTML = rows.map(r =>
    `<tr><td>${r.name}</td><td>${fmt(r.respondents)}</td><td>${pct(r.satisfaction)}</td><td>${fmt(r.leads)}</td></tr>`
  ).join("");
  // Totals row: Event = count of events; Survey Respondents/Leads Generated
  // = sum; Avg. Satisfaction Score = average.
  document.querySelector("#hev-bbTable tfoot").innerHTML =
    `<tr><td>Total (${fmt(rows.length)} events)</td><td>${fmt(sum(rows, r => r.respondents))}</td><td>${pct(mean(rows, r => r.satisfaction))}</td><td>${fmt(sum(rows, r => r.leads))}</td></tr>`;

  const yearLabel = (year && year !== "All") ? year : (bbYearsPresent.length ? bbYearsPresent.join("/") : "all years");
  // Subtitle sentence removed per direction -- the auto-analysis sentence
  // below the table now covers this same information dynamically.
  document.getElementById("hev-bbDesc").innerHTML = "";
  const totalLeads = sum(rows, r => r.leads);
  document.getElementById("hev-bb-analysis").innerHTML = rows.length
    ? `Out of the <strong>${fmt(totalEventsForYear)}</strong> events in <strong>${yearLabel}</strong>, <strong>${fmt(rows.length)}</strong> events generated <strong>${fmt(totalLeads)}</strong> leads, based on matching Event ID between Event Surveys and Booked Business.`
    : "No data available for this selection yet.";
}

// =====================================================================
// BOOKED BUSINESS
// =====================================================================
function initBooked() {
  const yearSel = document.getElementById("bb-year");
  const statusSel = document.getElementById("bb-status");
  const evtSel = document.getElementById("bb-event");
  function applyFilters() { renderBooked(yearSel.value, statusSel.value, evtSel.value); }
  const years = getYears(DATA.bookedBusiness.raw);
  populateYearSelect(yearSel, years, applyFilters);
  const statuses = [...new Set(DATA.bookedBusiness.raw.map(r => r.leadStatus).filter(Boolean))].sort();
  statusSel.innerHTML = `<option value="All">All</option>` + statuses.map(s => `<option value="${s}">${s}</option>`).join("");
  statusSel.value = "All";
  statusSel.onchange = applyFilters;
  const evts = [...new Set(DATA.bookedBusiness.raw.map(r => r.eventName).filter(Boolean))].sort();
  evtSel.innerHTML = `<option value="All">All</option>` + evts.map(e => `<option value="${e}">${e}</option>`).join("");
  evtSel.value = "All";
  evtSel.onchange = applyFilters;
  // Defaults to the latest year of data actually present in the Booked
  // Business sheet (rather than a hardcoded 2026), since this sheet tends to
  // lag behind the others.
  const defaultYear = years.length ? String(Math.max(...years)) : "All";
  yearSel.value = defaultYear;
  applyFilters();
}
function renderBooked(year, status, eventName) {
  let rows = byYear(DATA.bookedBusiness.raw, year);
  if (status !== "All") rows = rows.filter(r => r.leadStatus === status);
  if (eventName && eventName !== "All") rows = rows.filter(r => r.eventName === eventName);

  // "Total Events" is brought over from the Hosted Events tab's card of the
  // same name -- it reads the separate "Event Surveys" sheet, so it only
  // follows this tab's Year filter (matched on that sheet's own Event Date
  // year) and not Lead Status or Event Name, since those are Booked
  // Business-specific and the two sheets don't share an event-name
  // vocabulary (see the Hosted Events <-> Booked Business cross-reference
  // notes in the README for why event names differ between the two sheets).
  // When Year = All, this only counts years actually present in the Booked
  // Business sheet itself (currently just 2025) rather than every year the
  // separate Event Surveys sheet happens to have on file -- otherwise "All"
  // pulled in Event Surveys years (e.g. 2026) that Booked Business doesn't
  // have data for yet, inflating this card past what "All" should mean on
  // this tab (35 vs. the correct 28).
  const bbYearsPresent = getYears(DATA.bookedBusiness.raw);
  const esRows = year === "All"
    ? DATA.eventSurveys.raw.filter(r => bbYearsPresent.includes(r.year))
    : DATA.eventSurveys.raw.filter(r => r.year === Number(year));
  const totalEvents = distinctCount(esRows, r => r.eventId);

  const distinctEvents = distinctCount(rows, r => r.eventId);
  const leadsGenerated = distinctCount(rows, r => r.leadId);
  const uniqueLeadRows = dedupeBy(rows, r => r.leadId);
  const definiteLeads = uniqueLeadRows.filter(r => r.leadStatus === "Definite").length;
  const definiteRate = leadsGenerated ? definiteLeads / leadsGenerated : null;
  // Averaged at the same grain as the source report (per lead-attendee row,
  // not deduped by lead) -- confirmed by matching the live Power BI value.
  const avgConversionWindow = mean(rows, r => r.daysFromLeadCreatedToEvent);
  // Once the average window passes 90 days, showing it in months reads more
  // naturally than a large day count (e.g. "4.2 months" vs. "127 days").
  const convWindowText = avgConversionWindow === null ? "&mdash;"
    : avgConversionWindow > 90 ? fmt(avgConversionWindow / 30, 1) + " months"
    : fmt(avgConversionWindow) + " days";

  // Dynamic date-range subtitle -- dynamic with the Year/Status/Event filters via `rows`.
  const bbRange = rangeLabel(rows, "eventStartDate");

  // YoY % delta on every card -- same YTD-cutoff methodology as Overview
  // (see ytdYoyMetric). "Total Events" is cross-sheet (Event Surveys), so it
  // resolves curYear/priYear the same "All" = scoped-to-Booked-Business-years
  // way as the fixed Total Events card above; the other 5 cards use the
  // Status/Event-Name-filtered Booked Business rows (but not Year-filtered).
  let bbCurYear, bbPriYear;
  if (year !== "All") { bbCurYear = Number(year); bbPriYear = bbCurYear - 1; }
  else { const lt = latestTwoYears(bbYearsPresent); bbCurYear = lt.latest; bbPriYear = lt.prior; }
  const dTotalEventsBB = ytdYoyMetric(DATA.eventSurveys.raw, "date", bbCurYear, bbPriYear, null, rs => distinctCount(rs, r => r.eventId));
  let bbYoyBase = DATA.bookedBusiness.raw;
  if (status !== "All") bbYoyBase = bbYoyBase.filter(r => r.leadStatus === status);
  if (eventName && eventName !== "All") bbYoyBase = bbYoyBase.filter(r => r.eventName === eventName);
  function bbYoy(metricFn) { return ytdYoyMetric(bbYoyBase, "eventStartDate", bbCurYear, bbPriYear, null, metricFn); }
  const dDistinctEvents = bbYoy(rs => distinctCount(rs, r => r.eventId));
  const dLeadsGen = bbYoy(rs => distinctCount(rs, r => r.leadId));
  const dDefiniteLeads = bbYoy(rs => dedupeBy(rs, r => r.leadId).filter(r => r.leadStatus === "Definite").length);
  const dDefiniteRate = bbYoy(rs => { const uniq = dedupeBy(rs, r => r.leadId); const leads = distinctCount(rs, r => r.leadId); return leads ? uniq.filter(r => r.leadStatus === "Definite").length / leads : null; });
  const dConvWindow = bbYoy(rs => mean(rs, r => r.daysFromLeadCreatedToEvent));
  const convWinFmtBB = v => (v === null ? "&mdash;" : v > 90 ? fmt(v / 30, 1) + " months" : fmt(v) + " days");

  // Hosted Events and Booked Business both represent the events team's own
  // data, so every card on these two tabs gets the same pale-blue
  // "events-team" accent used for the 4 events-team cards on the Overview tab.
  document.getElementById("bb-kpiGrid").innerHTML = [
    kpiCard("Total Events", fmt(totalEvents), ytdDeltaText(dTotalEventsBB, fmt), deltaClass(dTotalEventsBB.d), bbRange, "events-team"),
    kpiCard("Events That Generated Leads", fmt(distinctEvents), ytdDeltaText(dDistinctEvents, fmt), deltaClass(dDistinctEvents.d), bbRange, "events-team"),
    kpiCard("Leads Generated", fmt(leadsGenerated), ytdDeltaText(dLeadsGen, fmt), deltaClass(dLeadsGen.d), bbRange, "events-team"),
    kpiCard("Definite Leads", fmt(definiteLeads), ytdDeltaText(dDefiniteLeads, fmt), deltaClass(dDefiniteLeads.d), bbRange, "events-team"),
    kpiCard("Definite Leads Percentage", pct(definiteRate), ytdDeltaText(dDefiniteRate, pct), deltaClass(dDefiniteRate.d), bbRange, "events-team"),
    kpiCard("Avg. Conversion Window", convWindowText, ytdDeltaText(dConvWindow, convWinFmtBB), deltaClass(dConvWindow.d), bbRange, "events-team")
  ].join("");

  // Grouped from the full (non-deduped) rows, not uniqueLeadRows -- a lead
  // that touches more than one event would otherwise get attributed to just
  // whichever event lists it first (the same dedup-across-events quirk noted
  // on the Hosted Events <-> Booked Business cross-reference), which was
  // silently dropping events that only had "shared" leads from this chart
  // and the conversion table below. Grouping first and taking a distinct
  // Lead ID count *within* each event's own rows fixes that -- every event
  // that has leads now shows up, and a lead who touches 2 events is counted
  // once for each of them (this can add up to more than the tab-wide "Leads
  // Generated" total above, which is deduped globally on purpose).
  const byEvent = groupBy(rows, r => r.eventName);
  const eventTotals = [...byEvent.entries()].map(([name, rs]) => ({ name, count: distinctCount(rs, r => r.leadId) })).sort((a, b) => b.count - a.count).slice(0, 10);
  makeChart("bb-chart1", {
    type: "bar",
    data: { labels: eventTotals.map(e => e.name), datasets: [{ label: "Leads", data: eventTotals.map(e => e.count), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
  });

  const byStatus = groupBy(uniqueLeadRows, r => r.leadStatus || "Unknown");
  const statusLabels = [...byStatus.keys()];
  makeChart("bb-chart2", {
    type: "doughnut",
    data: {
      labels: statusLabels,
      datasets: [{
        data: statusLabels.map(s => byStatus.get(s).length), backgroundColor: [COLORS.teal, COLORS.navy, COLORS.tealLight, COLORS.pale],
        // "center" anchor/align is the reliable setting for pie/doughnut arcs
        // -- the dashboard-wide default (anchor:"end", meant for bars) was
        // pushing labels toward the outer rim, where they clipped or
        // vanished for larger slices.
        datalabels: { display: true, anchor: "center", align: "center", color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) }
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });

  // Conversion-window brackets, per this DAX measure (repeated for each
  // bracket, only the day range and label change):
  //   NewLeads30 = CALCULATE(
  //     DISTINCTCOUNT(Master[Lead ID]),
  //     FILTER(
  //       VALUES(Master[Lead ID]),
  //       VAR dmin = CALCULATE(MIN(Master[Days of Lead Created from Event]))
  //       RETURN NOT ISBLANK(dmin) && dmin >= 0 && dmin <= 30
  //     )
  //   )
  // "1 Month" = 0-30 days (the measure above); "2-3 Months" = 31-90 days;
  // "4-6 Months" = 91-180 days; "7-12 Months" = 181-365 days; "Over 12+
  // Months" = 366+ days.
  const buckets = [[0, 30], [31, 90], [91, 180], [181, 365], [366, Infinity]];
  // Per the measure: for each Lead ID, take the MIN "Days of Lead Created
  // from Event" across its rows, then count the lead once toward whichever
  // bracket that minimum falls into -- a distinct-lead count, not a row
  // count (a lead can have several attendee rows under the same event).
  function distinctLeadsInBracket(rs, lo, hi) {
    const byLead = groupBy(rs, r => r.leadId);
    let count = 0;
    byLead.forEach(leadRows => {
      const vals = leadRows.map(r => r.daysFromLeadCreatedToEvent).filter(v => v !== null && v !== undefined);
      if (!vals.length) return;
      const dmin = Math.min(...vals);
      if (dmin >= lo && dmin <= hi) count++;
    });
    return count;
  }
  const perEventCounts = [...byEvent.entries()].map(([name, rs]) => ({
    name,
    counts: buckets.map(([lo, hi]) => distinctLeadsInBracket(rs, lo, hi))
  }));
  document.querySelector("#bb-conversionTable tbody").innerHTML = perEventCounts.map(e =>
    `<tr><td>${e.name}</td>${e.counts.map(c => `<td>${c || ""}</td>`).join("")}</tr>`
  ).join("");
  const bucketTotals = buckets.map((_, i) => perEventCounts.reduce((s, e) => s + e.counts[i], 0));
  document.querySelector("#bb-conversionTable tfoot").innerHTML =
    `<tr><td>Total</td>${bucketTotals.map(t => `<td>${t || 0}</td>`).join("")}</tr>`;

  document.querySelector("#bb-detailTable tbody").innerHTML = [...uniqueLeadRows]
    .sort((a, b) => (b.eventStartDate || "").localeCompare(a.eventStartDate || ""))
    .map(r => `<tr><td>${r.eventName}</td><td>${r.accountName}</td><td>${r.leadName}</td><td>${mdy(r.eventStartDate) || "&mdash;"}</td><td>${mdy(r.leadCreatedDate) || "&mdash;"}</td></tr>`)
    .join("");

  // Auto-analysis sentences (bolded values) -- neither chart on this tab is
  // month-based, so they call out the top event/status instead of a "latest
  // month" figure.
  const topEvent = topEntry(eventTotals, e => e.count);
  document.getElementById("bb-analysis1").innerHTML = topEvent
    ? `<strong>${topEvent.item.name}</strong> generated the most leads, with <strong>${fmt(topEvent.v)}</strong>.`
    : "No data available for this period yet.";
  const topStatus = topEntry(statusLabels.map(s => ({ s, count: byStatus.get(s).length })), x => x.count);
  document.getElementById("bb-analysis2").innerHTML = topStatus
    ? `<strong>${topStatus.item.s}</strong> is the most common lead status, with <strong>${fmt(topStatus.v)}</strong> leads.`
    : "No data available for this period yet.";

  // Conversion Window by Event table auto-analysis: which bracket has the
  // most leads overall.
  const bucketLabels = ["1 Month", "2-3 Months", "4-6 Months", "7-12 Months", "Over 12+ Months"];
  const topBucket = topEntry(bucketLabels.map((label, i) => ({ label, total: bucketTotals[i] })), x => x.total);
  document.getElementById("bb-analysis3").innerHTML = topBucket && topBucket.v > 0
    ? `<strong>${topBucket.item.label}</strong> is the most common conversion window, with <strong>${fmt(topBucket.v)}</strong> leads.`
    : "No data available for this period yet.";

  // Events That Generated Leads Detail table auto-analysis.
  document.getElementById("bb-analysis4").innerHTML = uniqueLeadRows.length
    ? `<strong>${fmt(uniqueLeadRows.length)}</strong> unique leads are shown across <strong>${fmt(distinctEvents)}</strong> events.`
    : "No data available for this period yet.";

  renderHevBookedLink(year, status, eventName);

  setReportingPeriod("booked", bbRange);
}

main();
