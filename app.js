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
function kpiCard(label, value, deltaText, deltaCls, dateRange, cardClass) {
  return `<div class="kpi-card${cardClass ? " " + cardClass : ""}"><div class="label">${label}</div><div class="value">${value}</div>${deltaText ? `<div class="delta ${deltaCls || ""}">${deltaText}</div>` : ""}${dateRange ? `<div class="daterange">${dateRange}</div>` : ""}</div>`;
}
// "Jan 1, 2026 – May 31, 2026" -- the exact YTD window a card's number covers.
function ytdRangeLabel(year, cutoffMonth) {
  if (!cutoffMonth) return "";
  const start = new Date(year, 0, 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const end = new Date(year, cutoffMonth, 0).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${start} &ndash; ${end}`;
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
function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
  const footSource = document.getElementById("footSource");
  if (footSource && TAB_SOURCES[name]) footSource.textContent = TAB_SOURCES[name];
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
    categories.map(c => cardWithDelta(c.label, c.fmtFn(c.cur), c.cur, c.pri, c.priYear, c.fmtFn(c.pri), ytdRangeLabel(c.curYear, c.cutoff), c.team === "events" ? "events-team" : "")).join("");

  document.getElementById("ov-desc").innerHTML = `The above data cards reflect totals from January 1, 2026 through ${endOfMonthLabel(CUR, pvCutoff)}.`;

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
  document.getElementById("ov-insights").innerHTML = paras.join("");
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

  document.getElementById("team-kpiGrid").innerHTML = [
    kpiCard("Partners Visited*", fmt(sum(rows, r => r.partnersVisited))),
    kpiCard("Planning Visits", fmt(sum(rows, r => r.planningVisits))),
    kpiCard("Convention Groups Serviced", fmt(sum(rows, r => r.conventionGroupsServiced))),
    kpiCard("In House Groups Serviced*", fmt(sum(rows, r => r.inHouseGroupsServiced))),
    kpiCard("Clients Serviced", fmt(sum(rows, r => r.clientsServiced)))
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
  ], year);

  bindMonthLink("team", ["team-chart1", "team-chart2", "team-chart3"]);

  // Automated 1-sentence analysis per chart -- just states the latest
  // available month's figures, so it updates on its own every time the
  // workbook is refreshed and rebuilt (no manual editing needed).
  const latest = rows.length ? rows[rows.length - 1] : null;
  const latestMonthTxt = latest ? monthLabel(latest.date.slice(0, 7)) : null;
  document.getElementById("team-analysis1").textContent = latest
    ? `In ${latestMonthTxt}, the team logged ${fmt(latest.partnersVisited)} partner visits and ${fmt(latest.planningVisits)} planning visits.`
    : "No data available for this period yet.";
  document.getElementById("team-analysis2").textContent = latest
    ? `In ${latestMonthTxt}, the team serviced ${fmt(latest.conventionGroupsServiced)} convention groups and ${fmt(latest.inHouseGroupsServiced)} in-house groups.`
    : "No data available for this period yet.";
  document.getElementById("team-analysis3").textContent = latest
    ? `In ${latestMonthTxt}, the team serviced ${fmt(latest.clientsServiced)} clients.`
    : "No data available for this period yet.";
}
function renderYoyTable(tableId, rows, metrics, selectedYear) {
  const years = getYears(rows);
  let prior, latest;
  if (selectedYear && selectedYear !== "All") {
    latest = Number(selectedYear);
    prior = latest - 1;
  } else {
    ({ prior, latest } = latestTwoYears(years));
  }
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
    const priRows = rows.filter(r => r.year === prior);
    const curRows = rows.filter(r => r.year === latest);
    const priVal = m.agg ? m.agg(priRows) : sum(priRows, m.fn);
    const curVal = m.agg ? m.agg(curRows) : sum(curRows, m.fn);
    const d = pctChange(priVal, curVal);
    return `<tr><td>${m.label}</td><td>${fmt(priVal)}</td><td>${fmt(curVal)}</td><td class="${deltaClass(d)}">${deltaArrow(d)}${pct(d)}</td></tr>`;
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
  // Renamed from "Avg. Referrals per Entry" to "Avg. Referrals Per Month" --
  // recalculated to match: total referrals divided by the number of distinct
  // calendar months present in the selected data (not the row count, which
  // is one row per staff/date/count entry, not one row per month).
  const monthsPresent = new Set(rows.map(r => monthKey(r.date))).size;
  const avgPerMonth = monthsPresent ? total / monthsPresent : null;

  document.getElementById("ref-kpiGrid").innerHTML = [
    kpiCard("Partner Referrals", fmt(total)),
    kpiCard("Avg. Referrals Per Month", fmt(avgPerMonth, 1))
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

  renderYoyTable("ref-yoyTable", all, [{ label: "Partner Referrals", fn: r => r.count }], year);
  bindReferralsLink();
}

// =====================================================================
// REPEAT CLIENTS
// =====================================================================
function initRepeat() {
  const yearSel = document.getElementById("rep-year");
  const acctSel = document.getElementById("rep-account");
  const mgrSel = document.getElementById("rep-manager");
  function applyFilters() { renderRepeat(yearSel.value, acctSel.value, mgrSel.value); }
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
  // Defaults to 2026 (falls back to "All" if 2026 isn't in the data yet).
  const defaultYear = years.includes(2026) ? "2026" : "All";
  yearSel.value = defaultYear;
  renderRepeat(defaultYear, "All", "All");
}
function renderRepeat(year, accountName, manager) {
  let rows = byYear(DATA.repeatingClients.raw, year);
  if (accountName && accountName !== "All") rows = rows.filter(r => r.accountName === accountName);
  if (manager && manager !== "All") rows = rows.filter(r => r.servicesManager === manager);
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

  document.getElementById("rep-kpiGrid").innerHTML = [
    kpiCard("Total Clients Serviced", fmt(totalClientsServiced)),
    kpiCard("Total Accounts Serviced", fmt(accountsServiced)),
    kpiCard("Repeat Accounts", fmt(repeatYes)),
    kpiCard("Repeat Account Percentage", pct(rate)),
    kpiCard("Accounts w/ Repeat Bookings", fmt(accountsWithRepeatBookings))
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
  document.querySelector("#rep-clientsTable tbody").innerHTML = withBookings.map(r =>
    `<tr><td>${r.accountName}</td><td>${fmt(r.attendance)}</td><td>${fmt(r.peakRoom)}</td><td>${r.repeat}</td><td>${r.bookings}</td><td>${r.servicesManager}</td></tr>`
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
  renderYoyTable("rep-yoyTable", yoyRows, [
    { label: "Clients", agg: rs => rs.filter(r => r.leadId !== null && r.leadId !== undefined).length },
    { label: "Accounts", agg: rs => distinctCount(rs, r => r.accountId) }
  ], year);
}

// =====================================================================
// CLIENT SURVEY
// =====================================================================
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

  document.getElementById("sur-kpiGrid").innerHTML = [
    kpiCard("The Overall Anaheim Experience Score", fmt(overallScore, 2)),
    kpiCard(teamScoreLabel, fmt(teamScore, 2)),
    kpiCard("DS&amp;E Manager Experience Score", fmt(managerScore, 2)),
    kpiCard("Survey Respondents", fmt(respondents))
  ].join("");

  document.getElementById("sur-chart1-title").innerHTML = "VA Survey Questions Rating" + titleSuffix;
  document.getElementById("sur-chart2-title").innerHTML = "VA Team Experience Avg. Score by Month" + titleSuffix;
  document.getElementById("sur-chart3-title").innerHTML = "Avg. Rating by DS&amp;E Manager" + titleSuffix;
  document.getElementById("sur-yoyValues-title").innerHTML = "Ratings by Year" + titleSuffix;
  document.getElementById("sur-yoyPct-title").innerHTML = "Year-over-Year % Change" + titleSuffix;
  document.getElementById("sur-chart3-desc").textContent = hasQ
    ? `Averaged for "${question}" only, grouped by the manager named on each response.`
    : "Averaged across all six rated questions, grouped by the manager named on each response.";

  const byQ = groupBy(filteredRows, r => r.question);
  const qLabels = [...byQ.keys()];
  // The Overall Anaheim Experience and DS&E Manager questions are
  // highlighted (a lighter fill) since they're also called out as their own
  // KPI cards above.
  const highlightQs = new Set([q2Text, overallText]);
  makeChart("sur-chart1", {
    type: "bar",
    data: { labels: qLabels.map(q => wrapLabel(q)), datasets: [{
      label: "Avg Rating", data: qLabels.map(q => mean(byQ.get(q), r => r.rating)),
      backgroundColor: qLabels.map(q => highlightQs.has(q) ? COLORS.tealLight : COLORS.navy), borderRadius: 4,
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
  // this keeps working as new years of data get added.
  const YEARS = getYears(DATA.accSurvey.raw);
  const questions = hasQ ? [question] : DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  const yearlyByQ = questions.map(q => {
    const yearly = {};
    YEARS.forEach(y => { yearly[y] = mean(all.filter(r => r.question === q && r.year === y), r => r.rating); });
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
}
function renderQ2Q7(year, manager) {
  const spot = DATA.accSurvey.q2q7;
  let raw = DATA.accSurvey.raw;
  if (manager && manager !== "All") raw = raw.filter(r => r.manager === manager);

  document.getElementById("q2q7Desc").innerHTML =
    `Client feedback from Question 7 (&ldquo;${spot.q7Text}&rdquo;), grouped by year.` +
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
  const cols = document.getElementById("testimonialCols");
  cols.innerHTML = YEARS.map(y => {
    const items = testimonialsByYear[y] || [];
    return items.map(it => `<div class="testimonial"><div class="yr">${y}</div>&ldquo;${it.feedback.length > 220 ? it.feedback.slice(0, 220) + "&hellip;" : it.feedback}&rdquo;</div>`).join("");
  }).join("");
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

  document.getElementById("hev-kpiGrid").innerHTML = [
    kpiCard("Total Events", fmt(totalEvents)),
    kpiCard("Attendee Events", fmt(distinctCount(attendeeRows, r => r.eventId))),
    kpiCard("Partner Events", fmt(distinctCount(partnerRows, r => r.eventId))),
    kpiCard("Survey Respondents", fmt(respondents)),
    kpiCard("Avg. Satisfaction Score", pct(avgSatisfaction))
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
}

// Cross-reference: eventSurveys and bookedBusiness share the same eventId
// namespace (names differ between the two sheets, e.g. "Ducks vs. Stars" in
// Event Surveys is "2025 March Ducks vs. Dallas Stars" in Booked Business).
// Uses the same unique-lead-per-event convention as the rest of this tab
// (dedupeBy leadId) -- a handful of leads span more than one event in the
// source data and get attributed to whichever event they list first, so this
// shows 5 of the 6 ID-matching events (the 6th's leads all attribute
// elsewhere). This is always the full, unfiltered picture.
function renderHevBookedLink() {
  const es = DATA.eventSurveys.raw;
  const bb = dedupeBy(DATA.bookedBusiness.raw, r => r.leadId);
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
  renderHevBookedLink(); // fixed cross-reference, independent of the filters above (moved here from the Hosted Events tab)
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
  const esRows = year === "All" ? DATA.eventSurveys.raw : DATA.eventSurveys.raw.filter(r => r.year === Number(year));
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

  document.getElementById("bb-kpiGrid").innerHTML = [
    kpiCard("Total Events", fmt(totalEvents)),
    kpiCard("Events That Generated Leads", fmt(distinctEvents)),
    kpiCard("Leads Generated", fmt(leadsGenerated)),
    kpiCard("Definite Leads", fmt(definiteLeads)),
    kpiCard("Definite Leads Percentage", pct(definiteRate)),
    kpiCard("Avg. Conversion Window", convWindowText)
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
}

main();
