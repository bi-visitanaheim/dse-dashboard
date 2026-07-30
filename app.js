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
function renderOverview() {
  const pv = DATA.planningVisits;
  const referrals = DATA.partnerReferrals.raw;
  const repeat = DATA.repeatingClients.raw;
  const survey = DATA.accSurvey.raw;
  const q2Text = DATA.accSurvey.q2q7.q2Text;
  const evSurveys = DATA.eventSurveys.raw;
  const booked = DATA.bookedBusiness.raw;
  const events = DATA.events.raw;

  const totalVisits = sum(pv, r => r.planningVisits);
  const totalClients = sum(pv, r => r.clientsServiced);
  const totalPartners = sum(pv, r => r.partnersVisited);
  const totalConvGroups = sum(pv, r => r.conventionGroupsServiced);
  const totalInHouse = sum(pv, r => r.inHouseGroupsServiced);
  const totalReferrals = sum(referrals, r => r.count);
  const repeatRate = repeat.length ? repeat.filter(r => r.repeat === "Yes").length / repeat.length : null;
  const teamExperienceScore = mean(survey, r => r.rating);
  const hostedEvents = distinctCount(evSurveys, r => r.eventId);
  const eventSatisfaction = mean(evSurveys, r => r.satisfaction);
  const leadsGenerated = distinctCount(booked, r => r.leadId);
  const avgConversionWindow = mean(booked, r => r.daysFromLeadCreatedToEvent);

  const cards = [
    kpiCard("Planning Visits (all-time)", fmt(totalVisits)),
    kpiCard("Clients Serviced", fmt(totalClients)),
    kpiCard("Partners Visited", fmt(totalPartners)),
    kpiCard("Convention Groups Serviced", fmt(totalConvGroups)),
    kpiCard("In House Groups Serviced", fmt(totalInHouse)),
    kpiCard("Partner Referrals", fmt(totalReferrals)),
    kpiCard("Repeat Client %", pct(repeatRate)),
    kpiCard("VA Team Experience Rating", fmt(teamExperienceScore, 2) + " / 10"),
    kpiCard("VA Hosted Events", fmt(hostedEvents)),
    kpiCard("VA Event Satisfaction Score", pct(eventSatisfaction)),
    kpiCard("Leads Generated From VA Events", fmt(leadsGenerated)),
    kpiCard("Avg. Lead Conversion Window", fmt(avgConversionWindow) + " days")
  ];
  document.getElementById("ov-kpiGrid").innerHTML = cards.join("");

  // ---- narrative insight (So What / Why / Now What, in plain prose) ----
  const years = getYears(pv);
  const monthsWithData = y => pv.filter(r => r.year === y && r.planningVisits !== null).length;
  const candidates = years.filter(y => monthsWithData(y) >= 5);
  const currentYear = candidates.length ? candidates[candidates.length - 1] : years[years.length - 1];
  const priorYear = currentYear - 1;
  const partialYear = monthsWithData(currentYear) < 11;

  const pvCur = pv.filter(r => r.year === currentYear), pvPri = pv.filter(r => r.year === priorYear);
  const visitsCur = sum(pvCur, r => r.planningVisits), visitsPri = sum(pvPri, r => r.planningVisits);
  const clientsCur = sum(pvCur, r => r.clientsServiced), clientsPri = sum(pvPri, r => r.clientsServiced);
  const convCur = sum(pvCur, r => r.conventionGroupsServiced), convPri = sum(pvPri, r => r.conventionGroupsServiced);
  const refCur = sum(byYear(referrals, currentYear), r => r.count), refPri = sum(byYear(referrals, priorYear), r => r.count);
  const repCur = byYear(repeat, currentYear), repPri = byYear(repeat, priorYear);
  const rateCur = repCur.length ? repCur.filter(r => r.repeat === "Yes").length / repCur.length : null;
  const ratePri = repPri.length ? repPri.filter(r => r.repeat === "Yes").length / repPri.length : null;
  const eventsCur = events.filter(r => r.year === currentYear).length, eventsPri = events.filter(r => r.year === priorYear).length;
  const q2Cur = mean(byYear(survey, currentYear).filter(r => r.question === q2Text), r => r.rating);
  const q2Pri = mean(byYear(survey, priorYear).filter(r => r.question === q2Text), r => r.rating);
  const esCur = mean(byYear(evSurveys, currentYear), r => r.overall), esPri = mean(byYear(evSurveys, priorYear), r => r.overall);
  const leadsCur = distinctCount(byYear(booked, currentYear), r => r.leadId), leadsPri = distinctCount(byYear(booked, priorYear), r => r.leadId);

  const dVisits = pctChange(visitsPri, visitsCur), dClients = pctChange(clientsPri, clientsCur), dConv = pctChange(convPri, convCur);
  const dRef = pctChange(refPri, refCur), dRate = pctChange(ratePri, rateCur), dEvents = pctChange(eventsPri, eventsCur);
  const dQ2 = pctChange(q2Pri, q2Cur), dEs = pctChange(esPri, esCur), dLeads = pctChange(leadsPri, leadsCur);

  const dir = d => d === null ? "held steady" : d > 0.001 ? "up" : d < -0.001 ? "down" : "flat";
  const p = (d) => d === null ? "" : ` (${dir(d)} ${Math.abs(d * 100).toFixed(1)}%)`;

  const paras = [];
  paras.push(`<p>In ${currentYear}${partialYear ? " so far" : ""}, the team logged <strong>${fmt(visitsCur)}</strong> planning visits${p(dVisits)} vs ${priorYear}, servicing <strong>${fmt(clientsCur)}</strong> clients${p(dClients)} and <strong>${fmt(convCur)}</strong> convention groups${p(dConv)}. ${dVisits !== null && dVisits < 0 && dClients !== null && dClients > 0 ? "Fewer visits but more clients served points to the team converting outreach more efficiently &mdash; worth understanding what's driving that lift so it can be repeated." : "Read these together with staffing levels for the period to judge whether the team is stretched or has room to take on more."}</p>`);
  paras.push(`<p>Partner referrals reached <strong>${fmt(refCur)}</strong>${p(dRef)}, and client loyalty stands at <strong>${pct(rateCur)}</strong> repeat business${p(dRate)}. ${dRate !== null && dRate > 0 ? "A rising repeat rate is a strong signal that recent client experience investments are paying off in retention, not just acquisition." : "If repeat business is flat or declining, it's worth pairing this with the Client Survey tab to see whether satisfaction scores explain it."}</p>`);
  paras.push(`<p>The DS&amp;E Manager experience rating is <strong>${fmt(q2Cur, 2)}/10</strong>${p(dQ2)}, and hosted-event satisfaction is <strong>${fmt(esCur, 2)}/5</strong>${p(dEs)}, while the team supported <strong>${fmt(eventsCur)}</strong> events${p(dEvents)} and generated <strong>${fmt(leadsCur)}</strong> distinct leads${p(dLeads)}. ${dQ2 !== null && dQ2 < 0 ? "The manager-experience dip is worth a closer read &mdash; see the Q2/Q7 spotlight below for the client testimonials behind the number." : "Sustained or improving manager ratings alongside steady lead generation suggest the client-facing motion is healthy; the next step is tying these scores to specific renewal/booking outcomes."}</p>`);
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
  const topReferrer = staffTotals[0] ? staffTotals[0].staff : "&mdash;";
  const avgPerEntry = rows.length ? total / rows.length : null;

  document.getElementById("ref-kpiGrid").innerHTML = [
    kpiCard("Partner Referrals", fmt(total)),
    kpiCard("Top Referrer", topReferrer),
    kpiCard("Avg. Referrals per Entry", fmt(avgPerEntry, 1))
  ].join("");

  makeChart("ref-chart1", {
    type: "bar",
    data: { labels: staffTotals.map(s => s.staff), datasets: [{ label: "Referrals", data: staffTotals.map(s => s.total), backgroundColor: COLORS.teal, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  const years = year === "All" ? getYears(all) : [Number(year)];
  const months = [...new Set(rows.map(r => r.date.slice(5, 7)))].sort();
  const monthLabels = months.map(m => new Date(2000, Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short" }));

  // Same continuous-timeline structure as the Team KPIs "Groups Serviced" chart:
  // one bar per actual calendar month across the selected period, not grouped by year.
  const byChronoMonth = groupBy(rows, r => monthKey(r.date));
  const chronoMonths = [...byChronoMonth.keys()].sort();
  makeChart("ref-chart2", {
    type: "bar",
    data: { labels: chronoMonths.map(monthLabel), datasets: [{ label: "Partner Referrals", data: chronoMonths.map(m => sum(byChronoMonth.get(m), r => r.count)), backgroundColor: COLORS.navy, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  makeChart("ref-chart3", {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: staffTotals.map((s, i) => {
        const bg = [COLORS.navy, COLORS.teal, COLORS.tealLight, COLORS.pale][i % 4];
        return {
          label: s.staff,
          data: months.map(m => sum(rows.filter(r => r.staff === s.staff && r.date.slice(5, 7) === m), r => r.count)),
          backgroundColor: bg,
          datalabels: { color: labelContrast(bg), anchor: "center", align: "center" }
        };
      })
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
  });

  renderYoyTable("ref-yoyTable", all, [{ label: "Partner Referrals", fn: r => r.count }]);
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
  const avgAttendance = mean(rows, r => r.attendance);

  document.getElementById("rep-kpiGrid").innerHTML = [
    kpiCard("Total Clients Serviced", fmt(total)),
    kpiCard("Repeat Clients", fmt(repeatYes)),
    kpiCard("Repeat Client %", pct(rate)),
    kpiCard("Accounts Serviced", fmt(accountsServiced)),
    kpiCard("Accounts w/ Repeat Bookings", fmt(accountsWithRepeatBookings)),
    kpiCard("Avg. Attendance per Event", fmt(avgAttendance))
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
  makeChart("rep-chart2", {
    type: "doughnut",
    data: { labels: ["Repeat", "New"], datasets: [{ data: [repeatYes, total - repeatYes], backgroundColor: [COLORS.navy, COLORS.pale], datalabels: { color: (ctx) => labelContrast(ctx.dataset.backgroundColor[ctx.dataIndex]) } }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "70%", plugins: { legend: { position: "bottom" } } }
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
    data: { labels: qLabels.map(q => q.length > 45 ? q.slice(0, 45) + "…" : q), datasets: [{ label: "Avg Rating", data: qLabels.map(q => mean(byQ.get(q), r => r.rating)), backgroundColor: COLORS.navy, borderRadius: 4 }] },
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

  // Year-over-year table always shows the full multi-year view regardless of the
  // Year filter (but does respect the Services Manager filter via `all` above).
  const YEARS = [2023, 2024, 2025, 2026];
  const questions = DATA.accSurvey.questions.filter(q => q !== DATA.accSurvey.q2q7.q7Text);
  const rowsHtml = questions.map(q => {
    const yearly = {};
    YEARS.forEach(y => { yearly[y] = mean(all.filter(r => r.question === q && r.year === y), r => r.rating); });
    const cells = [`<td>${q}</td>`];
    YEARS.forEach((y, i) => {
      cells.push(`<td>${fmt(yearly[y], 2)}</td>`);
      if (i < YEARS.length - 1) {
        const d = pctChange(yearly[y], yearly[YEARS[i + 1]]);
        cells.push(`<td class="${deltaClass(d)}">${d === null ? "&mdash;" : pct(d, 1)}</td>`);
      }
    });
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  document.querySelector("#sur-yoyTable tbody").innerHTML = rowsHtml;
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
  const uniqueAttendees = distinctCount(rows, r => r.contactId);

  document.getElementById("bb-kpiGrid").innerHTML = [
    kpiCard("Distinct Events with Leads", fmt(distinctEvents)),
    kpiCard("Leads Generated", fmt(leadsGenerated)),
    kpiCard("Definite Leads", fmt(definiteLeads)),
    kpiCard("Definite Rate", pct(definiteRate)),
    kpiCard("Avg. Conversion Window", fmt(avgConversionWindow) + " days"),
    kpiCard("Unique Attendees", fmt(uniqueAttendees))
  ].join("");

  const byEvent = groupBy(uniqueLeadRows, r => r.eventName);
  const eventTotals = [...byEvent.entries()].map(([name, rs]) => ({ name, count: rs.length })).sort((a, b) => b.count - a.count).slice(0, 10);
  makeChart("bb-chart1", {
    type: "bar",
    data: { labels: eventTotals.map(e => e.name.length > 40 ? e.name.slice(0, 40) + "…" : e.name), datasets: [{ label: "Leads", data: eventTotals.map(e => e.count), backgroundColor: COLORS.teal, borderRadius: 4 }] },
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
}

main();
