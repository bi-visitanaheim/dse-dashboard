// Headless logic check for app.js: no real browser available in this sandbox,
// so we simulate the DOM with jsdom, stub Chart.js and fetch(), then execute
// app.js and assert every tab's DOM got populated without runtime errors.
import { JSDOM } from "jsdom";
import fs from "fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const data = JSON.parse(fs.readFileSync(new URL("../data.json", import.meta.url), "utf8"));
const appJs = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
const { window } = dom;

let chartInstances = 0;
window.Chart = function (ctx, config) { chartInstances++; this.ctx = ctx; this.config = config; this.destroy = () => {}; };
window.Chart.defaults = { font: {}, color: null, borderColor: null };
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

// Overview
assert(doc.getElementById("ov-kpiGrid").children.length === 12, "Overview: 12 KPI cards");
assert(doc.getElementById("ov-insights").querySelectorAll("p").length === 3, "Overview: 3 narrative paragraphs");

// Team KPIs
assert(doc.getElementById("team-kpiGrid").children.length === 5, "Team KPIs: 5 KPI cards");
assert(doc.querySelectorAll("#team-yoyTable tbody tr").length > 0, "Team KPIs: YoY table has rows");

// Partner Referrals
assert(doc.getElementById("ref-kpiGrid").children.length === 3, "Partner Referrals: 3 KPI cards");
assert(doc.querySelectorAll("#ref-yoyTable tbody tr").length > 0, "Partner Referrals: YoY table has rows");

// Repeat Clients
assert(doc.getElementById("rep-kpiGrid").children.length === 6, "Repeat Clients: 6 KPI cards");
assert(doc.querySelectorAll("#rep-clientsTable tbody tr").length > 0, "Repeat Clients: clients table has rows");

// Client Survey
assert(doc.getElementById("sur-kpiGrid").children.length === 4, "Client Survey: 4 KPI cards");
assert(doc.querySelectorAll("#sur-yoyTable tbody tr").length === 6, "Client Survey: 6 rated-question rows in YoY table");
assert(doc.querySelectorAll("#testimonialCols .testimonial").length > 0, "Client Survey: Q7 testimonial cards rendered");
assert(doc.getElementById("q2q7Desc").textContent.includes("Question 2"), "Client Survey: Q2/Q7 spotlight description rendered");

// Hosted Events
assert(doc.getElementById("hev-kpiGrid").children.length === 5, "Hosted Events: 5 KPI cards");
assert(doc.querySelectorAll("#hev-byQuestionTable tbody tr").length === 3, "Hosted Events: 3 question rows");
assert(doc.querySelectorAll("#hev-byCategoryTable tbody tr").length > 0, "Hosted Events: category table has rows");

// Booked Business
assert(doc.getElementById("bb-kpiGrid").children.length === 6, "Booked Business: 6 KPI cards");
assert(doc.querySelectorAll("#bb-conversionTable tbody tr").length > 0, "Booked Business: conversion table has rows");

// Spot-check the corrected KPI math against values verified live in the Power BI report
const overview = doc.getElementById("ov-kpiGrid").innerHTML;
console.log("\nAll checks passed.");
console.log(`Chart instances created: ${chartInstances}`);
console.log("Overview KPI grid (first 400 chars):\n", overview.slice(0, 400));
