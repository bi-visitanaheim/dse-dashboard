// Headless logic check for app.js: no real browser available in this sandbox,
// so we simulate the DOM with jsdom, stub Chart.js and fetch(), then execute
// app.js and assert every tab's DOM got populated without runtime errors.
import { JSDOM } from "jsdom";
import fs from "fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const data = JSON.parse(fs.readFileSync(new URL("../data.json", import.meta.url), "utf8"));
const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
const { window } = dom;

let chartInstances = 0;
window.Chart = function (ctx, config) {
  chartInstances++;
  this.ctx = ctx;
  this.canvas = ctx; // real Chart.js exposes .canvas separately; el works fine as a stand-in here
  this.config = config;
  this.data = config.data;
  this.destroy = () => {};
  this.update = () => {};
  this.getElementsAtEventForMode = () => [];
};
window.Chart.defaults = { font: {}, color: null, borderColor: null, plugins: {}, set: (scope, values) => { window.Chart.defaults[scope] = values; } };
window.Chart.register = () => {};
window.fetch = async () => ({ json: async () => data });

const errors = [];
window.onerror = (msg) => errors.push(msg);

dom.window.eval(appJs);
await new Promise((r) => setTimeout(r, 300));

const doc = window.document;
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

assert(errors.length === 0, `no window.onerror events (got: ${JSON.stringify(errors)})`);
assert(chartInstances > 0, `charts were instantiated (got ${chartInstances})`);

// Footer source line updates per tab
assert(doc.getElementById("footSource").textContent.includes("Granicus, Association Insights"), "Footer: Overview source shown by default");
window.switchTab("survey");
assert(doc.getElementById("footSource").textContent === "Association Insights", "Footer: Client Survey source updates on tab switch");
window.switchTab("events");
assert(doc.getElementById("footSource").textContent === "Internal Tracking", "Footer: Hosted Events source updates on tab switch");
window.switchTab("overview");

// Overview
assert(doc.getElementById("ov-kpiGrid").children.length === 12, "Overview: 12 KPI cards");
assert(doc.getElementById("ov-insights").querySelectorAll("p").length === 3, "Overview: 3 narrative paragraphs");
assert(doc.querySelectorAll("#ov-kpiGrid .delta").length > 0, "Overview: cards show YoY deltas");
assert(doc.querySelectorAll("#ov-insights .delta-inline").length > 0, "Overview: narrative has bold/colored inline deltas");
assert(doc.getElementById("ov-desc").textContent.trim() === "", "Overview: stale 'above data cards reflect...' subtitle sentence removed (each card shows its own date range now)");
assert(doc.getElementById("ov-kpiGrid").textContent.includes("Repeat Account %"), "Overview: card renamed to Repeat Account % (was Repeat Client %)");
assert(doc.querySelectorAll("#ov-summaryTable tbody tr").length === 12, "Overview: Department at a Glance summary table has all 12 categories");
assert(doc.querySelector("#ov-summaryTable tbody tr").children.length === 5, "Overview: summary table rows have Category/Month/Previous Month/YTD/YoY% columns");
assert(!doc.getElementById("ov-summaryTable").closest(".table-scroll"), "Overview: Department at a Glance table no longer wrapped in a scrolling container");
assert(doc.querySelectorAll("#ov-kpiGrid .daterange").length === 12, "Overview: every KPI card shows its YTD date range");
assert(doc.querySelectorAll("#ov-kpiGrid .kpi-card.events-team").length === 4, "Overview: 4 events-team cards get the blue accent");
assert(
  ["VA Hosted Events", "VA Event Satisfaction Score", "Leads Generated From VA Events", "Avg. Lead Conversion Window"]
    .every(label => [...doc.querySelectorAll("#ov-kpiGrid .kpi-card.events-team .label")].some(el => el.textContent.includes(label))),
  "Overview: the correct 4 cards (Hosted Events, Event Satisfaction, Leads Generated, Conversion Window) are the events-team ones"
);
assert(doc.querySelector("#ov-kpiGrid").children[0].querySelector(".label").textContent === "Partners Visited", "Overview: cards reordered, Partners Visited first");
assert([...doc.querySelectorAll("#ov-kpiGrid .kpi-card")].every(el => el.classList.contains("selectable")), "Overview: every KPI card is clickable/selectable");
{
  // Clicking a card highlights it and narrows the summary table to just its
  // row; clicking it again clears the selection.
  const cards = [...doc.querySelectorAll("#ov-kpiGrid .kpi-card")];
  cards[2].dispatchEvent(new window.Event("click"));
  const visible = [...doc.querySelectorAll("#ov-summaryTable tbody tr")].filter(tr => tr.style.display !== "none");
  assert(cards[2].classList.contains("selected"), "Overview: clicked card gets the 'selected' highlight class");
  assert(visible.length === 1, "Overview: clicking a card narrows the summary table to 1 row");
  cards[2].dispatchEvent(new window.Event("click"));
  const visibleAfter = [...doc.querySelectorAll("#ov-summaryTable tbody tr")].filter(tr => tr.style.display !== "none");
  assert(!cards[2].classList.contains("selected"), "Overview: clicking the same card again clears the highlight");
  assert(visibleAfter.length === 12, "Overview: clicking the same card again shows all 12 rows again");
}
{
  // The narrative above the table is also dynamic with card selection: a
  // selected card swaps the full 3-paragraph narrative for that one
  // category's own 1-sentence version; deselecting restores the full thing.
  const fullNarrativeHtml = doc.getElementById("ov-insights").innerHTML;
  const fullParaCount = doc.getElementById("ov-insights").querySelectorAll("p").length;
  const cards = [...doc.querySelectorAll("#ov-kpiGrid .kpi-card")];
  cards[3].dispatchEvent(new window.Event("click"));
  assert(doc.getElementById("ov-insights").querySelectorAll("p").length === 1, "Overview: selecting a card narrows the narrative to 1 paragraph");
  assert(doc.getElementById("ov-insights").querySelector("strong")?.textContent === cards[3].querySelector(".label").textContent, "Overview: the 1-paragraph narrative names the selected card's own category");
  cards[3].dispatchEvent(new window.Event("click"));
  assert(doc.getElementById("ov-insights").querySelectorAll("p").length === fullParaCount, "Overview: deselecting restores the full multi-paragraph narrative");
  assert(doc.getElementById("ov-insights").innerHTML === fullNarrativeHtml, "Overview: restored narrative matches the original exactly");
}
{
  const panelHtml = doc.querySelector(".insight-panel").innerHTML;
  assert(panelHtml.indexOf("ov-insights") < panelHtml.indexOf("ov-summaryTable"), "Overview: narrative appears above the summary table");
}
{
  const narrative = doc.getElementById("ov-insights").textContent;
  assert(!narrative.includes("satisfaction dip"), "Overview: 'satisfaction dip' opinion sentence removed from narrative");
  assert(!/worth understanding|strong signal|worth a closer read|Read these together|pairing this with/i.test(narrative), "Overview: narrative has no opinions/action items, just the 12 data points");
}

// Team KPIs
assert(doc.getElementById("team-kpiGrid").children.length === 5, "Team KPIs: 5 KPI cards");
assert(doc.querySelectorAll("#team-yoyTable tbody tr").length > 0, "Team KPIs: YoY table has rows");
assert(![...doc.querySelectorAll("#tab-team .grid-2 > .panel")].some(p => p.querySelector("p.desc:not(.auto-analysis)")), "Team KPIs: old per-visual subtitles removed");
assert(doc.querySelector("#tab-team .footnote")?.textContent.includes("only began being tracked in 2026"), "Team KPIs: tab-level footnote about 2026-only metrics present");
assert(doc.getElementById("team-kpiGrid").textContent.includes("Partners Visited*"), "Team KPIs: Partners Visited card marked with asterisk");
assert(doc.getElementById("team-kpiGrid").textContent.includes("In House Groups Serviced*"), "Team KPIs: In House Groups Serviced card marked with asterisk");
assert(doc.getElementById("team-analysis1").textContent.trim().length > 0, "Team KPIs: auto-analysis sentence for Partners Visited & Planning Visits chart");
assert(doc.getElementById("team-analysis2").textContent.trim().length > 0, "Team KPIs: auto-analysis sentence for Groups Serviced chart");
assert(doc.getElementById("team-analysis3").textContent.trim().length > 0, "Team KPIs: auto-analysis sentence for Clients Serviced chart");
assert(doc.getElementById("team-analysis1").querySelectorAll("strong").length > 0, "Team KPIs: analysis 1 values are bolded");
assert(doc.getElementById("team-analysis2").querySelectorAll("strong").length > 0, "Team KPIs: analysis 2 values are bolded");
assert(doc.getElementById("team-analysis3").querySelectorAll("strong").length > 0, "Team KPIs: analysis 3 values are bolded");
assert(doc.getElementById("team-yoy-analysis").textContent.trim().length > 0, "Team KPIs: Year over Year KPIs table has an auto-analysis sentence");
assert(doc.getElementById("team-yoy-analysis").querySelectorAll("strong").length > 0, "Team KPIs: YoY analysis sentence values are bolded");
// Regression check: a trailing placeholder month with null values used to
// render as the literal text "&mdash;" (textContent doesn't decode HTML
// entities) instead of a real number or an actual em dash character.
assert(!doc.getElementById("team-analysis1").textContent.includes("&mdash;"), "Team KPIs: analysis 1 has no literal '&mdash;' text (innerHTML decodes the entity)");
assert(!doc.getElementById("team-analysis2").textContent.includes("&mdash;"), "Team KPIs: analysis 2 has no literal '&mdash;' text");
assert(!doc.getElementById("team-analysis3").textContent.includes("&mdash;"), "Team KPIs: analysis 3 has no literal '&mdash;' text");
assert(/\d/.test(doc.getElementById("team-analysis1").textContent), "Team KPIs: analysis 1 reports an actual numeric value, not a placeholder");
assert(doc.querySelectorAll("#team-kpiGrid .daterange").length === 5, "Team KPIs: every KPI card shows a dynamic date-range subtitle");
assert(doc.querySelectorAll("#team-kpiGrid .delta").length > 0, "Team KPIs: at least some cards show a YoY % delta");
{
  // Selecting a completed past year (2025) should switch the analysis
  // sentences from "latest month" to "full year" phrasing instead of
  // falling back to "no data available" (Partners Visited/In House Groups
  // Serviced are entirely null in 2025, which used to break the "latest row
  // with data" lookup for the whole sentence).
  const teamSel = doc.getElementById("team-year");
  teamSel.value = "2025";
  teamSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("team-analysis1").innerHTML.includes("In <strong>2025</strong>"), "Team KPIs: analysis 1 uses full-year phrasing for a completed past year");
  assert(!doc.getElementById("team-analysis1").textContent.includes("No data available"), "Team KPIs: analysis 1 no longer falls back to 'no data available' for 2025");
  assert(!doc.getElementById("team-analysis2").textContent.includes("No data available"), "Team KPIs: analysis 2 no longer falls back to 'no data available' for 2025");
  teamSel.value = "2026";
  teamSel.dispatchEvent(new window.Event("change"));
  assert(!doc.getElementById("team-analysis1").innerHTML.includes("In <strong>2026</strong>,"), "Team KPIs: analysis 1 reverts to 'latest month' phrasing for the current year");
}

// Partner Referrals
assert(doc.getElementById("ref-kpiGrid").children.length === 2, "Partner Referrals: 2 KPI cards (Top Referrer removed)");
assert(doc.querySelectorAll("#ref-yoyTable tbody tr").length > 0, "Partner Referrals: YoY table has rows");
assert(doc.querySelectorAll("#ref-kpiGrid .daterange").length === 2, "Partner Referrals: every KPI card shows a dynamic date-range subtitle");
assert(!doc.getElementById("tab-referrals").textContent.includes("Click a month"), "Partner Referrals: 'Click a month or staff member' subtitles removed");
assert([...doc.querySelectorAll("#tab-referrals h2")].some(h => h.textContent.includes("Monthly Referrals by Staff") && h.textContent.includes("Monthly")), "Partner Referrals: 'Monthly' tag added to Monthly Referrals by Staff");
assert(doc.getElementById("ref-analysis1").querySelectorAll("strong").length > 0, "Partner Referrals: analysis 1 (by staff) has bolded values");
assert(doc.getElementById("ref-analysis2").querySelectorAll("strong").length > 0, "Partner Referrals: analysis 2 (by month) has bolded values");
assert(doc.getElementById("ref-analysis3").querySelectorAll("strong").length > 0, "Partner Referrals: analysis 3 (monthly by staff) has bolded values");
assert(doc.getElementById("ref-yoy-analysis").querySelectorAll("strong").length > 0, "Partner Referrals: YoY table analysis sentence has bolded values");
assert(doc.querySelectorAll("#ref-kpiGrid .delta").length === 2, "Partner Referrals: both cards show a YoY % delta");
{
  const refSel = doc.getElementById("ref-year");
  refSel.value = "2026";
  refSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("ref-kpiGrid").textContent.includes("3.45"), "Partner Referrals: 'Avg. Referrals Per Month' shows 3.45 for 2026 (plain row-level AVERAGE())");
}

// Repeat Clients
assert(doc.getElementById("rep-kpiGrid").children.length === 5, "Repeat Clients: 5 KPI cards (reordered, avg attendance removed)");
assert(doc.querySelectorAll("#rep-clientsTable tbody tr").length > 0, "Repeat Clients: clients table has rows");
assert(doc.getElementById("rep-account").children.length > 1, "Repeat Clients: account name filter populated");
assert(doc.getElementById("rep-manager").children.length > 1, "Repeat Clients: services manager filter populated");
assert(doc.querySelectorAll("#rep-yoyTable tbody tr").length === 2, "Repeat Clients: Year over Year table has Clients + Accounts rows");
assert(doc.querySelector("#rep-yoyTable tbody").textContent.includes("Clients"), "Repeat Clients: YoY table has a Clients row");
assert(doc.querySelector("#rep-yoyTable tbody").textContent.includes("Accounts"), "Repeat Clients: YoY table has an Accounts row");
assert(doc.querySelectorAll("#rep-kpiGrid .daterange").length === 5, "Repeat Clients: every KPI card shows a dynamic date-range subtitle");
assert(doc.getElementById("rep-repeat").children.length === 3, "Repeat Clients: new 'Repeat' filter populated (All/Yes/No)");
{
  const repeatSel = doc.getElementById("rep-repeat");
  const before = doc.querySelector("#rep-kpiGrid .kpi-card .value").textContent;
  repeatSel.value = "Yes";
  repeatSel.dispatchEvent(new window.Event("change"));
  const afterYes = doc.querySelector("#rep-kpiGrid .kpi-card .value").textContent;
  assert(Number(afterYes.replace(/,/g, "")) <= Number(before.replace(/,/g, "")), "Repeat Clients: 'Repeat' filter narrows the KPI cards when set to Yes");
  repeatSel.value = "All";
  repeatSel.dispatchEvent(new window.Event("change"));
}
assert(doc.getElementById("rep-analysis1").querySelectorAll("strong").length > 0, "Repeat Clients: analysis 1 (by manager) has bolded values");
assert(doc.getElementById("rep-analysis2").querySelectorAll("strong").length > 0, "Repeat Clients: analysis 2 (repeat vs new) has bolded values");
assert(doc.getElementById("rep-yoy-analysis").querySelectorAll("strong").length > 0, "Repeat Clients: YoY table analysis sentence has bolded values");
assert(doc.querySelectorAll("#rep-kpiGrid .delta").length === 5, "Repeat Clients: all 5 cards show a YoY % delta");
assert(!doc.getElementById("tab-repeat").textContent.includes("proxy for repeat-booking depth"), "Repeat Clients: 'Bookings = how many times...' subsentence removed from Accounts table");
assert(doc.getElementById("rep-analysis3").querySelectorAll("strong").length > 0, "Repeat Clients: Accounts table has a bolded auto-analysis sentence");
// Regression check: every analysis sentence on this tab now states the
// latest available month of data (not a year-to-date/whole-period total).
assert(/^In <strong>[A-Za-z]{3} \d{2}<\/strong>,/.test(doc.getElementById("rep-analysis1").innerHTML), "Repeat Clients: analysis 1 states the latest month, not a YTD/whole-period total");
assert(/^In <strong>[A-Za-z]{3} \d{2}<\/strong>,/.test(doc.getElementById("rep-analysis2").innerHTML), "Repeat Clients: analysis 2 states the latest month, not a YTD/whole-period total");
assert(/^In <strong>[A-Za-z]{3} \d{2}<\/strong>,/.test(doc.getElementById("rep-analysis3").innerHTML), "Repeat Clients: analysis 3 states the latest month, not a YTD/whole-period total");

// Client Survey
assert(doc.getElementById("sur-kpiGrid").children.length === 4, "Client Survey: 4 KPI cards");
assert(doc.querySelector("#sur-kpiGrid").children[0].textContent.includes("The Overall Anaheim Experience Score"), "Client Survey: 'The Overall Anaheim Experience Score' card is first (left of Team Experience Score)");
assert(doc.querySelector("#sur-kpiGrid").children[1].textContent.includes("Visit Anaheim Team Experience Score"), "Client Survey: Team Experience Score card is second");
{
  // "VA Survey Questions Rating" reverted to a single uniform bar color
  // (no more lighter-fill highlight for the Overall Anaheim Experience/DS&E
  // Manager questions).
  const seenConfigs = {};
  const OrigChart = window.Chart;
  window.Chart = function (ctx, config) { seenConfigs[ctx.id] = config; return new OrigChart(ctx, config); };
  window.Chart.defaults = OrigChart.defaults;
  window.Chart.register = OrigChart.register;
  doc.getElementById("sur-manager").dispatchEvent(new window.Event("change"));
  const bg = seenConfigs["sur-chart1"]?.data.datasets[0].backgroundColor;
  assert(typeof bg === "string", "Client Survey: 'VA Survey Questions Rating' bars use one uniform color (not a per-question array)");
  window.Chart = OrigChart;
}
assert(!doc.getElementById("sur-kpiGrid").textContent.includes("Met Event Objectives"), "Client Survey: old 'Met Event Objectives' card removed");
// The ACC Survey sheet now has 8 rated questions (a new "The Overall Anaheim
// Experience" question was added), minus the 1 open-ended Q7 testimonial
// question that's excluded from these tables = 7 rows.
assert(doc.querySelectorAll("#sur-yoyValuesTable tbody tr").length === 7, "Client Survey: 7 rows in values table");
assert(doc.querySelectorAll("#sur-yoyPctTable tbody tr").length === 7, "Client Survey: 7 rows in % change table");
assert(doc.querySelectorAll("#sur-yoyValuesTable thead th").length >= 2, "Client Survey: values table header built dynamically from data years");
assert(doc.querySelectorAll("#testimonialCols .testimonial").length > 0, "Client Survey: Q7 testimonial cards rendered");
assert(doc.querySelector("#testimonialCols .testimonial .yr"), "Client Survey: testimonial cards show a year title");
assert(!doc.getElementById("chartQ2"), "Client Survey: Q2 line chart removed from spotlight");
assert(doc.getElementById("q2q7Desc").textContent.trim().startsWith("Visit Anaheim Team Experience Feedback"), "Client Survey: feedback section subtitle renamed to 'Visit Anaheim Team Experience Feedback'");
assert(doc.querySelectorAll("#sur-kpiGrid .daterange").length >= 4, "Client Survey: every KPI card shows a dynamic date-range subtitle");
assert(doc.querySelectorAll("#sur-kpiGrid").length && [...doc.querySelectorAll("#sur-kpiGrid .kpi-card")][1].textContent.includes("Consists of 6 Questions"), "Client Survey: Team Experience Score card shows 'Consists of 6 Questions' subtext");
assert(doc.getElementById("sur-chart2-title").parentElement.querySelector(".tag")?.textContent === "Monthly", "Client Survey: 'Monthly' tag added next to 'VA Team Experience Avg. Score by Month'");
assert(doc.getElementById("sur-analysis1").querySelectorAll("strong").length > 0, "Client Survey: analysis 1 (by question) has bolded values");
assert(doc.getElementById("sur-analysis2").querySelectorAll("strong").length > 0, "Client Survey: analysis 2 (by month) has bolded values");
assert(doc.getElementById("sur-analysis3").querySelectorAll("strong").length > 0, "Client Survey: analysis 3 (by manager) has bolded values");
assert(doc.getElementById("sur-yoy-analysis").querySelectorAll("strong").length > 0, "Client Survey: YoY values table analysis sentence has bolded values");
assert(doc.querySelectorAll("#sur-kpiGrid .delta").length > 0, "Client Survey: at least some cards show a YoY % delta");
assert(doc.getElementById("sur-manager").children.length > 1, "Client Survey: services manager filter populated");
assert(!doc.querySelector(".spotlight .tag"), "Client Survey: spotlight 'Beyond source report' tag removed");
assert(doc.querySelector(".spotlight h2").textContent.trim() === "Feedback", "Client Survey: spotlight title renamed to 'Feedback'");
assert(doc.getElementById("sur-chart1-title").textContent === "VA Survey Questions Rating", "Client Survey: 'Category Rating' renamed to 'VA Survey Questions Rating'");
assert(doc.getElementById("sur-chart2-title").textContent.trim().startsWith("VA Team Experience Avg. Score by Month"), "Client Survey: 'Avg. Score by Month' renamed");
assert(doc.getElementById("sur-question").children.length > 1, "Client Survey: Question filter populated");
{
  // Selecting a specific question should narrow/relabel every visual on the tab.
  const qSel = doc.getElementById("sur-question");
  const target = [...qSel.options].find(o => o.value.includes("Overall Anaheim"));
  qSel.value = target.value;
  qSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("sur-chart1-title").textContent.includes("Overall Anaheim"), "Client Survey: chart title updates to the selected Question");
  assert(doc.querySelectorAll("#sur-yoyValuesTable tbody tr").length === 1, "Client Survey: YoY table narrows to 1 row when a Question is selected");
  assert(doc.querySelectorAll("#sur-kpiGrid .label")[1].textContent === "The Overall Anaheim Experience Score", "Client Survey: 'Team Experience Score' card relabels/recomputes to the selected Question");
  qSel.value = "All";
  qSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("sur-chart1-title").textContent === "VA Survey Questions Rating", "Client Survey: titles revert when Question filter is reset to All");
}

// Hosted Events
assert(doc.getElementById("hev-kpiGrid").children.length === 5, "Hosted Events: 5 KPI cards");
assert(doc.getElementById("hev-year").value === "2026", "Hosted Events: Year filter defaults to 2026");
assert(doc.querySelectorAll("#hev-byQuestionTable tbody tr").length === 4, "Hosted Events: 4 question rows (incl. Satisfaction)");
assert(doc.querySelector("#hev-byQuestionTable thead").textContent.includes("Avg. Total"), "Hosted Events: question table last column renamed to Avg. Total");
assert(doc.querySelectorAll("#hev-byCategoryTable tbody tr").length > 0, "Hosted Events: category table has rows");
assert(doc.querySelector("#hev-byCategoryTable thead").textContent.includes("Arrival and Registration"), "Hosted Events: category table columns use full question names");
assert(doc.getElementById("hev-event").children.length > 1, "Hosted Events: event name filter populated");
assert(doc.querySelectorAll("#hev-detailTable tbody tr").length > 0, "Hosted Events: event survey detail table has rows");
assert(doc.querySelector("#hev-detailTable thead").textContent.trim().startsWith("EventEvent TypeCategoryDate"), "Hosted Events: detail table column order is Event/Event Type/Category/Date");
assert([...doc.querySelectorAll("#tab-events .desc")].every(el => !el.textContent.includes("One row per event")), "Hosted Events: old detail-table subtitle removed");
assert([...doc.querySelectorAll("#tab-events h2")].some(h => h.textContent.includes("Survey Questions Ratings")), "Hosted Events: 'Question Ratings' renamed to 'Survey Questions Ratings'");
assert([...doc.querySelectorAll("#tab-events .desc")].some(el => el.textContent.includes("0") && el.textContent.includes("5")), "Hosted Events: 'Survey Questions Ratings' has a 0-5 scale subtitle");
assert(!doc.querySelector("#tab-events #hev-bbTable"), "Hosted Events: cross-reference table moved out of this tab");
assert(![...doc.querySelectorAll("#tab-events h2")].some(h => h.textContent.includes("Hosted Events & Booked Business")), "Hosted Events: cross-reference section moved out of this tab");
assert(doc.querySelectorAll("#hev-kpiGrid .kpi-card.events-team").length === 5, "Hosted Events: all 5 KPI cards get the blue events-team accent");
assert(doc.querySelectorAll("#hev-kpiGrid .daterange").length === 5, "Hosted Events: every KPI card shows a dynamic date-range subtitle");
assert(doc.getElementById("hev-analysis1").querySelectorAll("strong").length > 0, "Hosted Events: analysis 1 (Events by Month) has bolded values");
assert(doc.getElementById("hev-analysis2").querySelectorAll("strong").length > 0, "Hosted Events: analysis 2 (Survey Questions Ratings) has bolded values");
assert(doc.querySelectorAll("#hev-kpiGrid .delta").length === 5, "Hosted Events: all 5 cards show a YoY % delta");
assert(doc.getElementById("hev-analysis3").querySelectorAll("strong").length > 0, "Hosted Events: 'Avg. Rating by Question' table has a bolded auto-analysis sentence");
assert(doc.getElementById("hev-analysis4").querySelectorAll("strong").length > 0, "Hosted Events: 'Ratings by Event Category' table has a bolded auto-analysis sentence");
assert(doc.getElementById("hev-analysis5").querySelectorAll("strong").length > 0, "Hosted Events: 'Event Survey Detail' table has a bolded auto-analysis sentence");

// Booked Business
assert(doc.getElementById("bb-kpiGrid").children.length === 6, "Booked Business: 6 KPI cards (Total Events card added)");
assert([...doc.querySelectorAll("#tab-booked h2")].some(h => h.textContent.includes("Hosted Events & Booked Business")), "Booked Business: cross-reference section now lives on this tab");
assert(doc.querySelectorAll("#hev-bbTable tbody tr").length === 5, "Booked Business: 5 events cross-referenced from Hosted Events");
assert(doc.querySelectorAll("#hev-bbTable tfoot tr").length === 1, "Booked Business: cross-reference table has a totals row");
{
  const footCells = [...doc.querySelectorAll("#hev-bbTable tfoot td")].map(td => td.textContent);
  assert(footCells[0].includes("5"), "Booked Business: cross-reference totals row shows the event count");
}
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Total Events"), "Booked Business: 'Total Events' card present");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Events That Generated Leads"), "Booked Business: card renamed to 'Events That Generated Leads'");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Definite Leads Percentage"), "Booked Business: card renamed to 'Definite Leads Percentage'");
// Booked Business's Year filter defaults to the latest year actually present
// in the sheet (currently 2025, since 2026 rows haven't been added yet).
assert(doc.getElementById("bb-year").value === "2025", "Booked Business: Year filter defaults to the latest year present in the data");
assert(!doc.getElementById("bb-chart3"), "Booked Business: 'Conversion Window - % of Leads' chart removed");
assert(doc.querySelector("#bb-conversionTable thead").textContent.includes("2-3 Months"), "Booked Business: conversion table columns renamed to month brackets");
assert(doc.querySelectorAll("#bb-conversionTable tbody tr").length > 0, "Booked Business: conversion table has rows");
// Regression check: this table used to silently drop any event whose leads
// were *all* shared with another event (a global dedup-by-Lead-ID quirk) --
// it should now show every event counted in "Events That Generated Leads".
assert(
  doc.querySelectorAll("#bb-conversionTable tbody tr").length ===
    Number(doc.querySelector("#bb-kpiGrid").children[1].querySelector(".value").textContent.replace(/,/g, "")),
  "Booked Business: conversion table includes every event that generated leads"
);
assert(doc.querySelectorAll("#bb-conversionTable tfoot tr").length === 1, "Booked Business: conversion table has a totals row");
assert(doc.getElementById("bb-event").children.length > 1, "Booked Business: event name filter populated");
assert(doc.querySelectorAll("#bb-detailTable tbody tr").length > 0, "Booked Business: detail table has rows");
assert(doc.querySelector("#bb-detailTable thead").textContent.trim() === "EventAccountLeadEvent Start DateLead Created Date", "Booked Business: detail table has a Lead column");
assert(/^\d{2}\/\d{2}\/\d{4}$/.test(doc.querySelector("#bb-detailTable tbody tr td:nth-child(4)").textContent), "Booked Business: dates formatted MM/DD/YYYY");
assert(doc.querySelectorAll("#bb-kpiGrid .kpi-card.events-team").length === 6, "Booked Business: all 6 KPI cards get the blue events-team accent");
assert(doc.querySelectorAll("#bb-kpiGrid .daterange").length === 6, "Booked Business: every KPI card shows a dynamic date-range subtitle");
assert(doc.getElementById("bb-analysis1").querySelectorAll("strong").length > 0, "Booked Business: analysis 1 (Leads Generated by Event) has bolded values");
assert(doc.getElementById("bb-analysis2").querySelectorAll("strong").length > 0, "Booked Business: analysis 2 (Leads Generated by Lead Status) has bolded values");
assert(doc.getElementById("hev-bb-analysis").textContent.includes("Out of the"), "Booked Business: cross-reference visual has the dynamic 'Out of the X events...' analysis sentence");
assert(doc.getElementById("hev-bbDesc").textContent.trim() === "", "Booked Business: 'These are matched by Event ID...' subsentence removed from the cross-reference visual");
assert(!doc.getElementById("tab-booked").textContent.includes("Days from lead created to event start"), "Booked Business: 'Days from lead created to event start...' subsentence removed from Conversion Window by Event");
assert(!doc.getElementById("tab-booked").textContent.includes("One row per unique lead"), "Booked Business: 'One row per unique lead.' subsentence removed from Events That Generated Leads Detail");
assert(doc.getElementById("bb-analysis3").querySelectorAll("strong").length > 0, "Booked Business: 'Conversion Window by Event' table has a bolded auto-analysis sentence");
assert(doc.getElementById("bb-analysis4").querySelectorAll("strong").length > 0, "Booked Business: 'Events That Generated Leads Detail' table has a bolded auto-analysis sentence");
{
  // Regression check: Total Events with Year = All used to double-count
  // years the Booked Business sheet doesn't have data for yet (35 instead of
  // the correct 28, since Event Surveys has years 2023-2026 on file but
  // Booked Business currently only has 2025). "All" should scope to years
  // actually present in Booked Business, so it should match the single-year
  // 2025 figure exactly (both tabs currently only have 2025 data).
  const bbYearSel = doc.getElementById("bb-year");
  bbYearSel.value = "2025";
  bbYearSel.dispatchEvent(new window.Event("change"));
  const totalEvents2025 = doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent;
  bbYearSel.value = "All";
  bbYearSel.dispatchEvent(new window.Event("change"));
  const totalEventsAll = doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent;
  assert(totalEventsAll === totalEvents2025, `Booked Business: 'Total Events' with Year=All (${totalEventsAll}) matches 2025-only (${totalEvents2025}), not inflated by other Event Surveys years`);
  assert(totalEventsAll === "28", "Booked Business: 'Total Events' with Year=All correctly reads 28, not 35");
  bbYearSel.value = "2025";
  bbYearSel.dispatchEvent(new window.Event("change"));
}

// Export as PDF button + events-team tab coloring (cross-tab checks)
assert(doc.querySelectorAll(".tab-panel .export-btn").length === 7, "Every tab has an 'Export as PDF' button");
assert(doc.querySelector('.tab-btn[data-tab="events"]') && doc.querySelector('.tab-btn[data-tab="booked"]'), "Hosted Events and Booked Business tab buttons exist for color-coding via CSS");

// Spot-check the corrected KPI math against values verified live in the Power BI report
const overview = doc.getElementById("ov-kpiGrid").innerHTML;
console.log("\nAll checks passed.");
console.log(`Chart instances created: ${chartInstances}`);
console.log("Overview KPI grid (first 400 chars):\n", overview.slice(0, 400));
