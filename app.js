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
function kpiCard(label, value, deltaText, deltaCls) {
  return `<div class="kpi-card"><div class="label">${label}</div><div class="value">${value}</div>${deltaText ? `<div class="delta ${deltaCls || ""}">${deltaText}</div>` : ""}</div>`;
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

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
}

// =====================================================================
// OVERVIEW
// =====================================================================
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthOf(dateStr) { const n = dateStr ? Number(String(dateStr).slice(5, 7)) : NaN; return Number.isNaN(n) ? null : n; }
function ytdCutoff(rowsInYear, dateField) {
  const months = rowsInYear.map(r => monthOf(r[dateField])).filter(m => m !== null);
  return months.length ? Math.max(...months) : 12;
}
function ytdRows(rows, dateField, year, cutoff) {
  return rows.filter(r => r.year === year && monthOf(r[dateField]) !== null && monthOf(r[dateField]) <= cutoff);
}
function renderOverview() {
  const pv = DATA.planningVisits;
  const referrals = DATA.partnerReferrals.raw;
  const repeat = DATA.repeatingClients.raw;
  const survey = DATA.accSurvey.raw;
  const q2Text = DATA.accSurvey.q2q7.q2Text;
  const evSurveys = DATA.eventSurveys.raw;
  const booked = DATA.bookedBusiness.raw;
  const events = DATA.events.raw;

  // ---- KPI cards: 2026 year-to-date only, each with a YoY delta vs the same
  // year-to-date window in 2025 (cutoff month is whatever's latest in each
  // sheet's own 2026 data, so the comparison stays apples-to-apples). ----
  const CUR = 2026, PRI = 2025;
  const pvCutoff = ytdCutoff(pv.filter(r => r.year === CUR), "date");
  const refCutoff = ytdCutoff(referrals.filter(r => r.year === CUR), "date");
  const repCutoff = ytdCutoff(repeat.filter(r => r.year === CUR), "startDate");
  const surCutoff = ytdCutoff(survey.filter(r => r.year === CUR), "date");
  const evsCutoff = ytdCutoff(evSurveys.filter(r => r.year === CUR), "date");
  const bbCutoff = ytdCutoff(booked.filter(r => r.year === CUR), "eventStartDate");

  const pvCurR = ytdRows(pv, "date", CUR, pvCutoff), pvPriR = ytdRows(pv, "date", PRI, pvCutoff);
  const refCurR = ytdRows(referrals, "date", CUR, refCutoff), refPriR = ytdRows(referrals, "date", PRI, refCutoff);
  const repCurR = ytdRows(repeat, "startDate", CUR, repCutoff), repPriR = ytdRows(repeat, "startDate", PRI, repCutoff);
  const surCurR = ytdRows(survey, "date", CUR, surCutoff), surPriR = ytdRows(survey, "date", PRI, surCutoff);
  const evsCurR = ytdRows(evSurveys, "date", CUR, evsCutoff), evsPriR = ytdRows(evSurveys, "date", PRI, evsCutoff);
  const bbCurR = ytdRows(booked, "eventStartDate", CUR, bbCutoff), bbPriR = ytdRows(booked, "eventStartDate", PRI, bbCutoff);

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

  function cardWithDelta(label, valueText, cur, pri) {
    const d = pctChange(pri, cur);
    const text = d === null ? null : `${deltaArrow(d)}${pct(d)} vs 2025 YTD`;
    return kpiCard(label, valueText, text, deltaClass(d));
  }
  const cards = [
    cardWithDelta("Planning Visits", fmt(visitsCur), visitsCur, visitsPri),
    cardWithDelta("Clients Serviced", fmt(clientsCur), clientsCur, clientsPri),
    cardWithDelta("Partners Visited", fmt(partnersCur), partnersCur, partnersPri),
    cardWithDelta("Convention Groups Serviced", fmt(convCur), convCur, convPri),
    cardWithDelta("In House Groups Serviced", fmt(inHouseCur), inHouseCur, inHousePri),
    cardWithDelta("Partner Referrals", fmt(totalReferralsCur), totalReferralsCur, totalReferralsPri),
    cardWithDelta("Repeat Client %", pct(rateCur), rateCur, ratePri),
    cardWithDelta("VA Team Experience Rating", fmt(teamScoreCur, 2) + " / 10", teamScoreCur, teamScorePri),
    cardWithDelta("VA Hosted Events", fmt(hostedEventsCur), hostedEventsCur, hostedEventsPri),
    cardWithDelta("VA Event Satisfaction Score", pct(eventSatCur), eventSatCur, eventSatPri),
    cardWithDelta("Leads Generated From VA Events", fmt(leadsCurYtd), leadsCurYtd, leadsPriYtd),
    cardWithDelta("Avg. Lead Conversion Window", fmt(convWinCur) + " days", convWinCur, convWinPri)
  ];
  document.getElementById("ov-kpiGrid").innerHTML = cards.join("");

  const cutoffMonthName = MONTH_NAMES[pvCutoff - 1] || "June";
  document.getElementById("ov-desc").innerHTML = `The above data cards reflect totals from January 1, 2026 through ${cutoffMonthName}, the last month of data.`;

  // ---- narrative insight (So What / Why / Now What, in plain prose) ----
  // Uses the most recent year with substantial (5+ months) data, compared to
  // the year before it -- independent of the fixed 2026-YTD cards above.
  const years = getYears(pv);
  const monthsWithData = y => pv.filter(r => r.year === y && r.planningVisits !== null).length;
  const candidates = years.filter(y => monthsWithData(y) >= 5);
  const currentYear = candidates.length ? candidates[candidates.length - 1] : years[years.length - 1];
  const priorYear = currentYear - 1;
  const partialYear = monthsWithData(currentYear) < 11;

  const pvCur = pv.filter(r => r.year === currentYear), pvPri = pv.filter(r => r.year === priorYear);
  const nVisitsCur = sum(pvCur, r => r.planningVisits), nVisitsPri = sum(pvPri, r => r.planningVisits);
  const nClientsCur = sum(pvCur, r => r.clientsServiced), nClientsPri = sum(pvPri, r => r.clientsServiced);
  const nConvCur = sum(pvCur, r => r.conventionGroupsServiced), nConvPri = sum(pvPri, r => r.conventionGroupsServiced);
  const nRefCur = sum(byYear(referrals, currentYear), r => r.count), nRefPri = sum(byYear(referrals, priorYear), r => r.count);
  const nRepCur = byYear(repeat, currentYear), nRepPri = byYear(repeat, priorYear);
  const nRateCur = nRepCur.length ? nRepCur.filter(r => r.repeat === "Yes").length / nRepCur.length : null;
  const nRatePri = nRepPri.length ? nRepPri.filter(r => r.repeat === "Yes").length / nRepPri.length : null;
  const nEventsCur = events.filter(r => r.year === currentYear).length, nEventsPri = events.filter(r => r.year === priorYear).length;
  const nQ2Cur = mean(byYear(survey, currentYear).filter(r => r.question === q2Text), r => r.rating);
  const nQ2Pri = mean(byYear(survey, priorYear).filter(r => r.question === q2Text), r => r.rating);
  const nEsCur = mean(byYear(evSurveys, currentYear), r => r.overall), nEsPri = mean(byYear(evSurveys, priorYear), r => r.overall);
  const nLeadsCur = distinctCount(byYear(booked, currentYear), r => r.leadId), nLeadsPri = distinctCount(byYear(booked, priorYear), r => r.leadId);

  const dVisits = pctChange(nVisitsPri, nVisitsCur), dClients = pctChange(nClientsPri, nClientsCur), dConv = pctChange(nConvPri, nConvCur);
  const dRef = pctChange(nRefPri, nRefCur), dRate = pctChange(nRatePri, nRateCur), dEvents = pctChange(nEventsPri, nEventsCur);
  const dQ2 = pctChange(nQ2Pri, nQ2Cur), dEs = pctChange(nEsPri, nEsCur), dLeads = pctChange(nLeadsPri, nLeadsCur);

  const paras = [];
  paras.push(`<p>In ${currentYear}${partialYear ? " so far" : ""}, the team logged <strong>${fmt(nVisitsCur)}</strong> planning visits${deltaSpan(dVisits)} vs ${priorYear}, servicing <strong>${fmt(nClientsCur)}</strong> clients${deltaSpan(dClients)} and <strong>${fmt(nConvCur)}</strong> convention groups${deltaSpan(dConv)}. ${dVisits !== null && dVisits < 0 && dClients !== null && dClients > 0 ? "Fewer visits but more clients served points to the team converting outreach more efficiently &mdash; worth understanding what's driving that lift so it can be repeated." : "Read these together with staffing levels for the period to judge whether the team is stretched or has room to take on more."}</p>`);
  paras.push(`<p>Partner referrals reached <strong>${fmt(nRefCur)}</strong>${deltaSpan(dRef)}, and client loyalty stands at <strong>${pct(nRateCur)}</strong> repeat business${deltaSpan(dRate)}. ${dRate !== null && dRate > 0 ? "A rising repeat rate is a strong signal that recent client experience investments are paying off in retention, not just acquisition." : "If repeat business is flat or declining, it's worth pairing this with the Client Survey tab to see whether satisfaction scores explain it."}</p>`);
  paras.push(`<p>The DS&amp;E Manager experience rating is <strong>${fmt(nQ2Cur, 2)}/10</strong>${deltaSpan(dQ2)}, and hosted-event satisfaction is <strong>${fmt(nEsCur, 2)}/5</strong>${deltaSpan(dEs)}, while the team supported <strong>${fmt(nEventsCur)}</strong> events${deltaSpan(dEvents)} and generated <strong>${fmt(nLeadsCur)}</strong> distinct leads${deltaSpan(dLeads)}. ${dQ2 !== null && dQ2 < 0 ? "The manager-experience dip is worth a closer read &mdash; see the Q2/Q7 spotlight below for the client testimonials behind the number." : "Sustained or improving manager ratings alongside steady lead generation suggest the client-facing motion is healthy; the next step is tying these scores to specific renewal/booking outcomes."}</p>`);
  document.getElementById("ov-insights").innerHTML = paras.join("");
}

// =====================================================================
// TEAM KPIs
// =====================================================================
function initTeam() {
  const sel = document.getElementById("team-year");
  populateYearSelect(sel, getYears(DATA.planningVisits), () => renderTeam(sel.value));
  renderTeam("All");
}
function renderTeam(year) {
  const all = DATA.planningVisits;
  const rows = byYear(all, year);

  document.getElementById("team-kpiGrid").innerHTML = [
    kpiCard("Planning Visits", fmt(sum(rows, r => r.planningVisits))),
    kpiCard("Clients Serviced", fmt(sum(rows, r => r.clientsServiced))),
    kpiCard("Partners Visited", fmt(sum(rows, r => r.partnersVisited))),
    kpiCard("Convention Groups Serviced", fmt(sum(rows, r => r.conventionGroupsServiced))),
    kpiCard("In House Groups Serviced", fmt(sum(rows, r => r.inHouseGroupsServiced)))
  ].join("");

  const labels = rows.map(r => monthLabel(r.date.slice(0, 7)));
  makeChart("team-chart1", {
    data: { labels, datasets: [
      { type: "bar", label: "Partners Visited", data: rows.map(r => r.partnersVisited), backgroundColor: COLORS.seriesA, borderRadius: 4 },
      { type: "bar", label: "Planning Visits", data: rows.map(r => r.planningVisits), backgroundColor: COLORS.seriesB, borderRadius: 4 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } }
  });
  makeChart("team-chart2", {
    data: { labels, datasets: [
      { type: "bar", label: "Convention Groups Serviced", data: rows.map(r => r.conventionGroupsServiced), backgroundColor: COLORS.seriesB, borderRadius: 4 },
      { type: "bar", label: "In House Groups Serviced", data: rows.map(r => r.inHouseGroupsServiced), backgroundColor: COLORS.seriesA, borderRadius: 4 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } }
  });
  makeChart("team-chart3", {
    type: "bar",
    data: { labels, datasets: [{ label: "Clients Serviced", data: rows.map(r => r.clientsServiced), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  renderYoyTable("team-yoyTable", all, [
    { label: "Clients Serviced", fn: r => r.clientsServiced },
    { label: "Convention Groups Serviced", fn: r => r.conventionGroupsServiced },
    { label: "Planning Visits", fn: r => r.planningVisits },
    { label: "Partners Visited", fn: r => r.partnersVisited },
    { label: "In House Groups Serviced", fn: r => r.inHouseGroupsServiced }
  ], year);

  bindMonthLink("team", ["team-chart1", "team-chart2", "team-chart3"]);
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
  const html = metrics.map(m => {
    const priVal = sum(rows.filter(r => r.year === prior), m.fn);
    const curVal = sum(rows.filter(r => r.year === latest), m.fn);
    if (priVal === 0) return "";
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
  populateYearSelect(sel, getYears(DATA.partnerReferrals.raw), () => renderReferrals(sel.value));
  renderReferrals("All");
}
function renderReferrals(year) {
  const all = DATA.partnerReferrals.raw;
  const rows = byYear(all, year);
  const total = sum(rows, r => r.count);
  const byStaff = groupBy(rows, r => r.staff);
  const staffTotals = [...byStaff.entries()].map(([staff, rs]) => ({ staff, total: sum(rs, r => r.count) })).sort((a, b) => b.total - a.total);
  const avgPerEntry = rows.length ? total / rows.length : null;

  document.getElementById("ref-kpiGrid").innerHTML = [
    kpiCard("Partner Referrals", fmt(total)),
    kpiCard("Avg. Referrals per Entry", fmt(avgPerEntry, 1))
  ].join("");

  makeChart("ref-chart1", {
    type: "bar",
    data: { labels: staffTotals.map(s => s.staff), datasets: [{ label: "Referrals", data: staffTotals.map(s => s.total), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
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
          datalabels: { color: labelContrast(bg), anchor: "center", align: "center" }
        };
      })
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
  });

  renderYoyTable("ref-yoyTable", all, [{ label: "Partner Referrals", fn: r => r.count }], year);
  bindMonthLink("referrals", ["ref-chart2", "ref-chart3"]);
}

// =====================================================================
// REPEAT CLIENTS
// =====================================================================
function initRepeat() {
  const yearSel = document.getElementById("rep-year");
  const acctSel = document.getElementById("rep-account");
  function applyFilters() { renderRepeat(yearSel.value, acctSel.value); }
  populateYearSelect(yearSel, getYears(DATA.repeatingClients.raw), applyFilters);
  const accounts = [...new Set(DATA.repeatingClients.raw.map(r => r.accountName).filter(Boolean))].sort();
  acctSel.innerHTML = `<option value="All">All</option>` + accounts.map(a => `<option value="${a}">${a}</option>`).join("");
  acctSel.value = "All";
  acctSel.onchange = applyFilters;
  applyFilters();
}
function renderRepeat(year, accountName) {
  let rows = byYear(DATA.repeatingClients.raw, year);
  if (accountName && accountName !== "All") rows = rows.filter(r => r.accountName === accountName);
  const total = rows.length;
  const repeatYes = rows.filter(r => r.repeat === "Yes").length;
  const rate = total ? repeatYes / total : null;
  const accountsServiced = distinctCount(rows, r => r.accountId);
  const acctCounts = groupBy(rows, r => r.accountId);
  const accountsWithRepeatBookings = [...acctCounts.values()].filter(v => v.length > 1).length;

  document.getElementById("rep-kpiGrid").innerHTML = [
    kpiCard("Total Clients Serviced", fmt(total)),
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
        { label: "Repeat", data: mgrs.map(m => byMgr.get(m).filter(r => r.repeat === "Yes").length), backgroundColor: COLORS.navy, borderRadius: 4, datalabels: { color: "#ffffff", anchor: "center", align: "center" } },
        { label: "New", data: mgrs.map(m => byMgr.get(m).filter(r => r.repeat !== "Yes").length), backgroundColor: COLORS.teal, borderRadius: 4, datalabels: { color: "#ffffff", anchor: "center", align: "center" } }
      ]
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } }
  });
  const repeatAccountIds = new Set(rows.filter(r => r.repeat === "Yes").map(r => r.accountId));
  const repeatAccountsCount = repeatAccountIds.size;
  makeChart("rep-chart2", {
    type: "doughnut",
    data: {
      labels: ["Repeat", "New"],
      datasets: [
        { label: "Accounts", data: [repeatAccountsCount, accountsServiced - repeatAccountsCount], backgroundColor: [COLORS.navy, COLORS.pale], datalabels: { color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) } },
        { label: "Clients", data: [repeatYes, total - repeatYes], backgroundColor: [COLORS.teal, COLORS.tealLight], datalabels: { color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) } }
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
}

// =====================================================================
// CLIENT SURVEY
// =====================================================================
function initSurvey() {
  const yearSel = document.getElementById("sur-year");
  const mgrSel = document.getElementById("sur-manager");
  function applyFilters() { renderSurvey(yearSel.value, mgrSel.value); renderQ2Q7(mgrSel.value); }
  populateYearSelect(yearSel, getYears(DATA.accSurvey.raw), applyFilters);
  const managers = [...new Set(DATA.accSurvey.raw.map(r => r.manager).filter(Boolean))].sort();
  mgrSel.innerHTML = `<option value="All">All</option>` + managers.map(m => `<option value="${m}">${m}</option>`).join("");
  mgrSel.value = "All";
  mgrSel.onchange = applyFilters;
  applyFilters();
}
function renderSurvey(year, manager) {
  let all = DATA.accSurvey.raw;
  if (manager && manager !== "All") all = all.filter(r => r.manager === manager);
  const rows = byYear(all, year);
  const q2Text = DATA.accSurvey.q2q7.q2Text;
  const q5Text = DATA.accSurvey.questions[4];
  const ratedRows = rows.filter(r => r.rating !== null);

  const teamScore = mean(ratedRows, r => r.rating);
  const metObjectivesScore = mean(ratedRows.filter(r => r.question === q5Text), r => r.rating);
  const managerScore = mean(ratedRows.filter(r => r.question === q2Text), r => r.rating);
  const respondents = distinctCount(rows, r => r.leadId);

  document.getElementById("sur-kpiGrid").innerHTML = [
    kpiCard("Visit Anaheim Team Experience Score", fmt(teamScore, 2)),
    kpiCard("Visit Anaheim Met Event Objectives Score", fmt(metObjectivesScore, 2)),
    kpiCard("DS&amp;E Manager Experience Score", fmt(managerScore, 2)),
    kpiCard("Survey Respondents", fmt(respondents))
  ].join("");

  const byQ = groupBy(ratedRows, r => r.question);
  const qLabels = [...byQ.keys()];
  makeChart("sur-chart1", {
    type: "bar",
    data: { labels: qLabels.map(q => wrapLabel(q)), datasets: [{ label: "Avg Rating", data: qLabels.map(q => mean(byQ.get(q), r => r.rating)), backgroundColor: COLORS.navy, borderRadius: 4 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 10 } } }
  });

  const byMonth = groupBy(ratedRows, r => monthKey(r.date));
  const months = [...byMonth.keys()].sort();
  makeChart("sur-chart2", {
    type: "bar",
    data: { labels: months.map(monthLabel), datasets: [{ label: "Avg Score", data: months.map(m => mean(byMonth.get(m), r => r.rating)), backgroundColor: COLORS.tealLight, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } }
  });

  const byMgr = groupBy(ratedRows.filter(r => r.manager), r => r.manager);
  const mgrList = [...byMgr.entries()].map(([m, rs]) => ({ m, avg: mean(rs, r => r.rating) })).sort((a, b) => b.avg - a.avg);
  makeChart("sur-chart3", {
    type: "bar",
    data: { labels: mgrList.map(x => x.m), datasets: [{ label: "Avg Rating", data: mgrList.map(x => x.avg), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } }
  });

  // Both YoY tables always show the full multi-year view regardless of the
  // Year filter (but do respect the Services Manager filter via `all` above).
  const YEARS = [2023, 2024, 2025, 2026];
  const questions = DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  const yearlyByQ = questions.map(q => {
    const yearly = {};
    YEARS.forEach(y => { yearly[y] = mean(all.filter(r => r.question === q && r.year === y), r => r.rating); });
    return { q, yearly };
  });
  document.querySelector("#sur-yoyValuesTable tbody").innerHTML = yearlyByQ.map(({ q, yearly }) =>
    `<tr><td>${q}</td>${YEARS.map(y => `<td>${fmt(yearly[y], 2)}</td>`).join("")}</tr>`
  ).join("");
  document.querySelector("#sur-yoyPctTable tbody").innerHTML = yearlyByQ.map(({ q, yearly }) => {
    const cells = YEARS.slice(0, -1).map((y, i) => {
      const d = pctChange(yearly[y], yearly[YEARS[i + 1]]);
      return `<td class="${deltaClass(d)}">${d === null ? "&mdash;" : pct(d, 1)}</td>`;
    });
    return `<tr><td>${q}</td>${cells.join("")}</tr>`;
  }).join("");
}
function renderQ2Q7(manager) {
  const spot = DATA.accSurvey.q2q7;
  let raw = DATA.accSurvey.raw;
  if (manager && manager !== "All") raw = raw.filter(r => r.manager === manager);

  document.getElementById("q2q7Desc").innerHTML =
    `Question 2 (&ldquo;${spot.q2Text}&rdquo;) is the numeric rating clients give their Destination Service &amp; Events Manager. ` +
    `Question 7 (&ldquo;${spot.q7Text}&rdquo;) is open-ended feedback from the same respondents. This section isn't in the source Power BI report ` +
    `&mdash; it's added here per the DS&amp;E dashboard brief to read the rating trend alongside <em>why</em> it moved.` +
    (manager && manager !== "All" ? ` Filtered to responses naming <strong>${manager}</strong> as the Services Manager.` : "");

  const YEARS = [2023, 2024, 2025, 2026];
  const q2Yearly = {};
  YEARS.forEach(y => { q2Yearly[y] = mean(raw.filter(r => r.question === spot.q2Text && r.year === y), r => r.rating); });
  makeChart("chartQ2", {
    type: "line",
    data: { labels: YEARS, datasets: [{ label: "Q2 Rating", data: YEARS.map(y => q2Yearly[y]), borderColor: COLORS.tealLight, backgroundColor: "rgba(119,199,201,.22)", fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: COLORS.tealLight }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { color: "#ffffff" } }, scales: { y: { min: 0, max: 10, ticks: { color: "#cfe6e6" }, grid: { color: "rgba(255,255,255,.08)" } }, x: { ticks: { color: "#cfe6e6" }, grid: { display: false } } } }
  });

  const testimonialsByYear = {};
  YEARS.forEach(y => {
    testimonialsByYear[y] = raw.filter(r => r.question === spot.q7Text && r.year === y && r.feedback).slice(0, 3);
  });
  const cols = document.getElementById("testimonialCols");
  cols.innerHTML = YEARS.map(y => {
    const items = testimonialsByYear[y] || [];
    return items.map(it => `<div class="testimonial"><span class="yr">${y}</span><br/>&ldquo;${it.feedback.length > 220 ? it.feedback.slice(0, 220) + "&hellip;" : it.feedback}&rdquo;</div>`).join("");
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
  populateYearSelect(yearSel, getYears(DATA.eventSurveys.raw), applyFilters);
  const cats = [...new Set(DATA.eventSurveys.raw.map(r => r.category).filter(Boolean))].sort();
  catSel.innerHTML = `<option value="All">All</option>` + cats.map(c => `<option value="${c}">${c}</option>`).join("");
  catSel.value = "All";
  catSel.onchange = applyFilters;
  const evts = [...new Set(DATA.eventSurveys.raw.map(r => r.event).filter(Boolean))].sort();
  evtSel.innerHTML = `<option value="All">All</option>` + evts.map(e => `<option value="${e}">${e}</option>`).join("");
  evtSel.value = "All";
  evtSel.onchange = applyFilters;
  applyFilters();
  renderHevBookedLink(); // fixed cross-reference, independent of the filters above
}
function renderEvents(year, category, eventName) {
  let rows = byYear(DATA.eventSurveys.raw, year);
  if (category !== "All") rows = rows.filter(r => r.category === category);
  if (eventName && eventName !== "All") rows = rows.filter(r => r.event === eventName);

  const totalEvents = distinctCount(rows, r => r.eventId);
  const attendeeRows = rows.filter(r => r.surveyType === "Attendee");
  const partnerRows = rows.filter(r => r.surveyType === "Partner");
  const respondents = rows.length;
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  const years = year === "All" ? getYears(DATA.eventSurveys.raw) : [Number(year)];
  makeChart("hev-chart2", {
    type: "bar",
    data: {
      labels: years.map(String),
      datasets: [
        { label: "Overall Experience", data: years.map(y => mean(rows.filter(r => r.year === y), r => r.overall)), backgroundColor: COLORS.seriesA },
        { label: "Recommend Future Events", data: years.map(y => mean(rows.filter(r => r.year === y), r => r.recommend)), backgroundColor: COLORS.seriesB },
        { label: "Registration Experience", data: years.map(y => mean(rows.filter(r => r.year === y), r => r.registration)), backgroundColor: COLORS.seriesC },
        // satisfaction is stored 0-1 (e.g. 0.8 = 4/5); *5 puts it on the same
        // 0-5 scale as the other three so it's directly comparable here.
        { label: "Satisfaction", data: years.map(y => { const v = mean(rows.filter(r => r.year === y), r => r.satisfaction); return v === null ? null : v * 5; }), backgroundColor: COLORS.seriesD }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { min: 0, max: 5 } } }
  });

  const qDef = [
    { label: "Overall Experience", fn: r => r.overall },
    { label: "Recommend Future Events", fn: r => r.recommend },
    { label: "Registration and Arrival Process", fn: r => r.registration },
    { label: "Satisfaction", fn: r => (r.satisfaction === null || r.satisfaction === undefined) ? null : r.satisfaction * 5 }
  ];
  document.querySelector("#hev-byQuestionTable tbody").innerHTML = qDef.map(q =>
    `<tr><td>${q.label}</td><td>${fmt(mean(attendeeRows, q.fn), 2)}</td><td>${fmt(mean(partnerRows, q.fn), 2)}</td><td><strong>${fmt(mean(rows, q.fn), 2)}</strong></td></tr>`
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
    .map(r => `<tr><td>${r.event}</td><td>${r.surveyType}</td><td>${r.date || "&mdash;"}</td><td>${r.category || "&mdash;"}</td></tr>`)
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
}

// =====================================================================
// BOOKED BUSINESS
// =====================================================================
function initBooked() {
  const yearSel = document.getElementById("bb-year");
  const statusSel = document.getElementById("bb-status");
  const evtSel = document.getElementById("bb-event");
  function applyFilters() { renderBooked(yearSel.value, statusSel.value, evtSel.value); }
  populateYearSelect(yearSel, getYears(DATA.bookedBusiness.raw), applyFilters);
  const statuses = [...new Set(DATA.bookedBusiness.raw.map(r => r.leadStatus).filter(Boolean))].sort();
  statusSel.innerHTML = `<option value="All">All</option>` + statuses.map(s => `<option value="${s}">${s}</option>`).join("");
  statusSel.value = "All";
  statusSel.onchange = applyFilters;
  const evts = [...new Set(DATA.bookedBusiness.raw.map(r => r.eventName).filter(Boolean))].sort();
  evtSel.innerHTML = `<option value="All">All</option>` + evts.map(e => `<option value="${e}">${e}</option>`).join("");
  evtSel.value = "All";
  evtSel.onchange = applyFilters;
  applyFilters();
}
function renderBooked(year, status, eventName) {
  let rows = byYear(DATA.bookedBusiness.raw, year);
  if (status !== "All") rows = rows.filter(r => r.leadStatus === status);
  if (eventName && eventName !== "All") rows = rows.filter(r => r.eventName === eventName);

  const distinctEvents = distinctCount(rows, r => r.eventId);
  const leadsGenerated = distinctCount(rows, r => r.leadId);
  const uniqueLeadRows = dedupeBy(rows, r => r.leadId);
  const definiteLeads = uniqueLeadRows.filter(r => r.leadStatus === "Definite").length;
  const definiteRate = leadsGenerated ? definiteLeads / leadsGenerated : null;
  // Averaged at the same grain as the source report (per lead-attendee row,
  // not deduped by lead) -- confirmed by matching the live Power BI value.
  const avgConversionWindow = mean(rows, r => r.daysFromLeadCreatedToEvent);

  document.getElementById("bb-kpiGrid").innerHTML = [
    kpiCard("Distinct Events with Leads", fmt(distinctEvents)),
    kpiCard("Leads Generated", fmt(leadsGenerated)),
    kpiCard("Definite Leads", fmt(definiteLeads)),
    kpiCard("Definite Rate", pct(definiteRate)),
    kpiCard("Avg. Conversion Window", fmt(avgConversionWindow) + " days")
  ].join("");

  const byEvent = groupBy(uniqueLeadRows, r => r.eventName);
  const eventTotals = [...byEvent.entries()].map(([name, rs]) => ({ name, count: rs.length })).sort((a, b) => b.count - a.count).slice(0, 10);
  makeChart("bb-chart1", {
    type: "bar",
    data: { labels: eventTotals.map(e => e.name), datasets: [{ label: "Leads", data: eventTotals.map(e => e.count), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
  });

  const byStatus = groupBy(uniqueLeadRows, r => r.leadStatus || "Unknown");
  const statusLabels = [...byStatus.keys()];
  makeChart("bb-chart2", {
    type: "doughnut",
    data: { labels: statusLabels, datasets: [{ data: statusLabels.map(s => byStatus.get(s).length), backgroundColor: [COLORS.teal, COLORS.navy, COLORS.tealLight, COLORS.pale], datalabels: { color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) } }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });

  const buckets = [[0, 30], [31, 90], [91, 180], [181, 365], [366, Infinity]];
  const bucketNames = ["0–30d", "31–90d", "91–180d", "181–365d", "365d+"];
  const perEventCounts = [...byEvent.entries()].map(([name, rs]) => ({
    name,
    counts: buckets.map(([lo, hi]) => rs.filter(r => r.daysFromLeadCreatedToEvent !== null && r.daysFromLeadCreatedToEvent >= lo && r.daysFromLeadCreatedToEvent <= hi).length)
  }));
  document.querySelector("#bb-conversionTable tbody").innerHTML = perEventCounts.map(e =>
    `<tr><td>${e.name}</td>${e.counts.map(c => `<td>${c || ""}</td>`).join("")}</tr>`
  ).join("");
  const bucketTotals = buckets.map((_, i) => perEventCounts.reduce((s, e) => s + e.counts[i], 0));
  document.querySelector("#bb-conversionTable tfoot").innerHTML =
    `<tr><td>Total</td>${bucketTotals.map(t => `<td>${t || 0}</td>`).join("")}</tr>`;

  // Same data as % of each event's leads -- easier for leadership to scan for
  // "mostly fast" vs "mostly slow" converting events than the raw-count table.
  const pctByEvent = perEventCounts
    .map(e => ({ name: e.name, total: e.counts.reduce((a, b) => a + b, 0), counts: e.counts }))
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  makeChart("bb-chart3", {
    type: "bar",
    data: {
      labels: pctByEvent.map(e => e.name),
      datasets: buckets.map((_, i) => {
        const bg = [COLORS.navy, COLORS.teal, COLORS.tealLight, COLORS.pale][i % 4];
        return {
          label: bucketNames[i],
          data: pctByEvent.map(e => Math.round((e.counts[i] / e.total) * 1000) / 10),
          backgroundColor: bg,
          datalabels: { color: labelContrast(bg), anchor: "center", align: "center", formatter: (v) => v ? v + "%" : "" }
        };
      })
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" } }, y: { stacked: true } }
    }
  });

  document.querySelector("#bb-detailTable tbody").innerHTML = [...uniqueLeadRows]
    .sort((a, b) => (b.eventStartDate || "").localeCompare(a.eventStartDate || ""))
    .map(r => `<tr><td>${r.eventName}</td><td>${r.accountName}</td><td>${r.eventStartDate || "&mdash;"}</td><td>${r.leadCreatedDate || "&mdash;"}</td></tr>`)
    .join("");
}

main();
