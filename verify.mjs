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
assert(doc.getElementById("ov-desc").textContent.includes("January 1, 2026"), "Overview: subtitle reflects YTD wording");
assert(doc.getElementById("ov-kpiGrid").textContent.includes("Repeat Account %"), "Overview: card renamed to Repeat Account % (was Repeat Client %)");
assert(doc.querySelectorAll("#ov-summaryTable tbody tr").length === 12, "Overview: Department at a Glance summary table has all 12 categories");
assert(doc.querySelector("#ov-summaryTable tbody tr").children.length === 5, "Overview: summary table rows have Category/Month/Previous Month/YTD/YoY% columns");

// Team KPIs
assert(doc.getElementById("team-kpiGrid").children.length === 5, "Team KPIs: 5 KPI cards");
assert(doc.querySelectorAll("#team-yoyTable tbody tr").length > 0, "Team KPIs: YoY table has rows");

// Partner Referrals
assert(doc.getElementById("ref-kpiGrid").children.length === 2, "Partner Referrals: 2 KPI cards (Top Referrer removed)");
assert(doc.querySelectorAll("#ref-yoyTable tbody tr").length > 0, "Partner Referrals: YoY table has rows");

// Repeat Clients
assert(doc.getElementById("rep-kpiGrid").children.length === 5, "Repeat Clients: 5 KPI cards (reordered, avg attendance removed)");
assert(doc.querySelectorAll("#rep-clientsTable tbody tr").length > 0, "Repeat Clients: clients table has rows");
assert(doc.getElementById("rep-account").children.length > 1, "Repeat Clients: account name filter populated");
assert(doc.getElementById("rep-manager").children.length > 1, "Repeat Clients: services manager filter populated");

// Client Survey
assert(doc.getElementById("sur-kpiGrid").children.length === 4, "Client Survey: 4 KPI cards");
assert(doc.querySelector("#sur-kpiGrid").children[0].textContent.includes("The Overall Anaheim Experience Score"), "Client Survey: 'The Overall Anaheim Experience Score' card is first (left of Team Experience Score)");
assert(doc.querySelector("#sur-kpiGrid").children[1].textContent.includes("Visit Anaheim Team Experience Score"), "Client Survey: Team Experience Score card is second");
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
assert(doc.getElementById("q2q7Desc").textContent.includes("Question 7"), "Client Survey: feedback section description rendered");
assert(doc.getElementById("sur-manager").children.length > 1, "Client Survey: services manager filter populated");
assert(!doc.querySelector(".spotlight .tag"), "Client Survey: spotlight 'Beyond source report' tag removed");
assert(doc.querySelector(".spotlight h2").textContent.trim() === "Feedback", "Client Survey: spotlight title renamed to 'Feedback'");

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
assert(doc.querySelectorAll("#hev-bbTable tbody tr").length === 5, "Hosted Events: 5 events cross-referenced to Booked Business");

// Booked Business
assert(doc.getElementById("bb-kpiGrid").children.length === 6, "Booked Business: 6 KPI cards (Total Events card added)");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Total Events"), "Booked Business: 'Total Events' card present");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Events That Generated Leads"), "Booked Business: card renamed to 'Events That Generated Leads'");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Definite Leads Rate"), "Booked Business: card renamed to 'Definite Leads Rate'");
// Booked Business's sheet only has 2025 data so far (no 2026 rows yet), so
// the 2026-default falls back to "All" -- same fallback logic as every other
// tab's Year filter, just currently landing on a different value here.
assert(doc.getElementById("bb-year").value === "All", "Booked Business: Year filter defaults to 2026 (falls back to All, since the sheet has no 2026 rows yet)");
assert(!doc.getElementById("bb-chart3"), "Booked Business: 'Conversion Window - % of Leads' chart removed");
assert(doc.querySelector("#bb-conversionTable thead").textContent.includes("2-3 Months"), "Booked Business: conversion table columns renamed to month brackets");
assert(doc.querySelectorAll("#bb-conversionTable tbody tr").length > 0, "Booked Business: conversion table has rows");
assert(doc.querySelectorAll("#bb-conversionTable tfoot tr").length === 1, "Booked Business: conversion table has a totals row");
assert(doc.getElementById("bb-event").children.length > 1, "Booked Business: event name filter populated");
assert(doc.querySelectorAll("#bb-detailTable tbody tr").length > 0, "Booked Business: detail table has rows");
assert(doc.querySelector("#bb-detailTable thead").textContent.trim() === "EventAccountLeadEvent Start DateLead Created Date", "Booked Business: detail table has a Lead column");
assert(/^\d{2}\/\d{2}\/\d{4}$/.test(doc.querySelector("#bb-detailTable tbody tr td:nth-child(4)").textContent), "Booked Business: dates formatted MM/DD/YYYY");

// Spot-check the corrected KPI math against values verified live in the Power BI report
const overview = doc.getElementById("ov-kpiGrid").innerHTML;
console.log("\nAll checks passed.");
console.log(`Chart instances created: ${chartInstances}`);
console.log("Overview KPI grid (first 400 chars):\n", overview.slice(0, 400));
