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

// Dashboard rename (September 2026): "Destination Services & Events
// Dashboard" -> "Destination Experience and Events Dashboard".
assert(doc.title.includes("Destination Experience and Events Dashboard"), "Dashboard renamed: <title> says 'Destination Experience and Events Dashboard'");
assert(doc.querySelector("h1").textContent.trim() === "Destination Experience and Events Dashboard", "Dashboard renamed: <h1> says 'Destination Experience and Events Dashboard'");

// "Select All" filter option label (dashboard-wide, September 2026): every
// filter's all-inclusive option now displays "Select All" instead of "All"
// (the underlying value stays "All" so filtering logic is unaffected).
assert(doc.getElementById("ref-year").querySelector('option[value="All"]').textContent === "Select All", "Filters: 'All' option now displays as 'Select All' (Partner Referrals Year filter checked as a sample)");
assert(doc.getElementById("bb-status").querySelector('option[value="All"]').textContent === "Select All", "Filters: 'All' option now displays as 'Select All' (Booked Business Lead Status filter checked as a sample)");

// YoY delta label wording fix (September 2026): simplified from
// "(X in 2025) vs 2025 YTD" (which named the comparison year twice) to just
// "vs. 2025 YTD".
{
  const sampleDelta = doc.querySelector("#ov-kpiGrid .delta")?.textContent || "";
  assert(/vs\.\s*\d{4}\s*YTD/.test(sampleDelta), "YoY delta text reads 'vs. <year> YTD'");
  assert(!/\(.*in \d{4}\)/.test(sampleDelta), "YoY delta text no longer repeats the prior-year figure/year in parentheses");
}

// Footer source line updates per tab
assert(doc.getElementById("footSource").textContent.includes("Granicus, Association Insights"), "Footer: Overview source shown by default");
window.switchTab("survey");
assert(doc.getElementById("footSource").textContent === "Association Insights", "Footer: Client Survey source updates on tab switch");
window.switchTab("events");
assert(doc.getElementById("footSource").textContent === "Internal Tracking", "Footer: Hosted Events source updates on tab switch");
window.switchTab("overview");

// Header "Reporting period" pill updates dynamically per tab, matching each
// tab's own KPI card date ranges (not a fixed hardcoded string). Checked
// against each tab's own rendered .daterange text directly (not just "does
// it differ from the last tab") -- two tabs' ranges can legitimately be
// identical by coincidence depending on what's in the data (e.g. if Team
// KPIs' latest populated month happens to match Overview's own Planning
// Visits cutoff month), so inequality between tabs isn't a safe thing to
// assert on its own.
{
  const overviewPeriod = doc.getElementById("headerReportingPeriod").innerHTML;
  assert(/\d{4}/.test(overviewPeriod), "Header: Reporting period pill shows a real date range on load (Overview)");
  assert(doc.getElementById("headerReportingPeriod").textContent === doc.querySelector("#ov-kpiGrid .kpi-card .daterange").textContent, "Header: Overview's pill matches its own (Planning Visits-driven) card date range");
  window.switchTab("team");
  assert(doc.getElementById("headerReportingPeriod").textContent === doc.querySelector("#team-kpiGrid .daterange").textContent, "Header: Reporting period pill matches Team KPIs' own card date range after switching tabs");
  window.switchTab("repeat");
  assert(doc.getElementById("headerReportingPeriod").textContent === doc.querySelector("#rep-kpiGrid-accounts .daterange").textContent, "Header: Reporting period pill matches Repeat Clients' own card date range after switching tabs");
  window.switchTab("overview");
  assert(doc.getElementById("headerReportingPeriod").innerHTML === overviewPeriod, "Header: Reporting period pill reverts to Overview's own range when switching back");
}
{
  // Regression check: the pill used to only refresh inside switchTab(), so
  // changing a Year/filter dropdown while remaining on the same tab left it
  // stale. Switch to Repeat Clients, note its pill, change the Year filter
  // without switching tabs, and confirm the pill updates immediately.
  window.switchTab("repeat");
  const repYearSel = doc.getElementById("rep-year");
  repYearSel.value = "2025";
  repYearSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("headerReportingPeriod").textContent === doc.querySelector("#rep-kpiGrid-accounts .daterange").textContent, "Header: Reporting period pill updates live to match the new filter's own card date range, without switching tabs");
  repYearSel.value = "2026";
  repYearSel.dispatchEvent(new window.Event("change"));
  window.switchTab("overview");
}
// Print-only tab title (see .print-only-tab-title) names whichever tab is
// active, since the tab bar itself is hidden when printing -- kept in sync
// by switchTab().
assert(doc.getElementById("printTabTitle").textContent === "Overview", "Print: tab title shows 'Overview' by default");
window.switchTab("booked");
assert(doc.getElementById("printTabTitle").textContent === "Booked Business", "Print: tab title updates to 'Booked Business' on tab switch");
window.switchTab("overview");

// Overview
// Back to 12 categories: Room Nights/Economic Impact/Attendees (briefly
// added here in an earlier pass) were removed per direction -- those 3
// fields belong only on the Booked Business tab's "Events That Generated
// Leads Detail" table, not as Overview or Booked Business KPI cards.
assert(doc.getElementById("ov-kpiGrid").children.length === 12, "Overview: 12 KPI cards (Room Nights/Economic Impact/Attendees removed again)");
assert(!doc.getElementById("ov-kpiGrid").textContent.includes("Room Nights"), "Overview: 'Room Nights' card removed");
assert(!doc.getElementById("ov-kpiGrid").textContent.includes("Economic Impact"), "Overview: 'Economic Impact' card removed");
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
assert(doc.getElementById("ref-manager").children.length > 1, "Partner Referrals: new 'Service Manager' filter populated");
{
  // Selecting a specific Service Manager should narrow every visual on the
  // tab (KPI totals, charts, Referral Detail table) down to just that person.
  const mgrSel = doc.getElementById("ref-manager");
  const totalBefore = doc.querySelector("#ref-kpiGrid .kpi-card .value").textContent;
  mgrSel.value = mgrSel.options[1].value;
  mgrSel.dispatchEvent(new window.Event("change"));
  const totalAfter = doc.querySelector("#ref-kpiGrid .kpi-card .value").textContent;
  assert(Number(totalAfter.replace(/,/g, "")) <= Number(totalBefore.replace(/,/g, "")), "Partner Referrals: Service Manager filter narrows the KPI cards");
  mgrSel.value = "All";
  mgrSel.dispatchEvent(new window.Event("change"));
}
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
  // As of the September 2026 switch to PartnerReferralsDetail (one row per
  // individual referral), this is total referrals / distinct months present,
  // not a row-level average (every row's count is 1, which would always
  // average to 1.00 and defeat the point of the card -- see renderReferrals).
  const refSel = doc.getElementById("ref-year");
  refSel.value = "2026";
  refSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("ref-kpiGrid").textContent.includes("11.44"), "Partner Referrals: 'Avg. Referrals Per Month' shows 11.44 for 2026 (total referrals / distinct months present)");
}
{
  // Referral Detail table -- added September 2026 alongside the switch to
  // the PartnerReferralsDetail table as this tab's data source.
  const refH2s = [...doc.querySelectorAll("#tab-referrals h2")];
  assert(refH2s[refH2s.length - 1]?.textContent.trim() === "Referral Detail", "Partner Referrals: 'Referral Detail' table section added at the bottom of the tab");
  assert(
    doc.querySelector("#ref-detailTable thead").textContent === "Referral IDReferral DateAccount NameFunction NameLead ArrivalLead DepartureUser",
    "Partner Referrals: Referral Detail table has the 7 requested columns in order"
  );
  const refSel = doc.getElementById("ref-year");
  refSel.value = "2026";
  refSel.dispatchEvent(new window.Event("change"));
  const rowsAt2026 = doc.querySelectorAll("#ref-detailTable tbody tr").length;
  assert(rowsAt2026 > 0, "Partner Referrals: Referral Detail table has rows for 2026");
  const dates2026 = [...doc.querySelectorAll("#ref-detailTable tbody tr")].map(tr => tr.children[1].textContent);
  assert(dates2026.every(d => d.endsWith("/2026")), "Partner Referrals: Referral Detail table respects the Year filter (all rows dated 2026)");
  const sorted = [...dates2026].sort((a, b) => new Date(b) - new Date(a));
  assert(JSON.stringify(dates2026) === JSON.stringify(sorted), "Partner Referrals: Referral Detail table is sorted most recent Referral Date first");
  refSel.value = "All";
  refSel.dispatchEvent(new window.Event("change"));
  const rowsAtAll = doc.querySelectorAll("#ref-detailTable tbody tr").length;
  assert(rowsAtAll >= rowsAt2026, "Partner Referrals: Referral Detail table shows more (or equal) rows with Year=All than a single year");
  assert(doc.getElementById("ref-analysis4").querySelectorAll("strong").length > 0, "Partner Referrals: Referral Detail table has a bolded auto-analysis sentence");
}

// Repeat ACC Accounts (tab renamed from "Repeat Clients")
// Single KPI card group under "By Accounts" (7 cards): Total Clients
// Serviced (moved here from the removed "By Client" group, positioned first
// -- ahead of Total Accounts Serviced), Total Accounts Serviced, Repeat
// Accounts, Repeat Account Percentage, New Accounts, New Account Percentage,
// and Accounts with Future Bookings as the last card. The separate "By
// Client" card group (Repeat Clients/Repeat Client %/New Clients/New Client
// %) was removed entirely per direction, since Lead ID is already unique
// per row on this sheet -- there's no duplicate-Lead-ID concept of "repeat"
// at that grain.
assert([...doc.querySelectorAll(".tab-btn")].some(b => b.textContent.trim() === "Repeat ACC Accounts"), "Tab renamed from 'Repeat Clients' to 'Repeat ACC Accounts'");
assert(!doc.getElementById("rep-kpiGrid-clients"), "Repeat ACC Accounts: separate 'By Client' KPI grid removed");
assert(doc.getElementById("rep-kpiGrid-accounts").children.length === 7, "Repeat ACC Accounts: 7 'By Accounts' KPI cards");
assert(doc.getElementById("rep-kpiGrid-accounts").textContent.includes("Total Clients Serviced"), "Repeat ACC Accounts: 'Total Clients Serviced' card present in 'By Accounts'");
assert(doc.getElementById("rep-kpiGrid-accounts").children[0].textContent.includes("Total Clients Serviced"), "Repeat ACC Accounts: 'Total Clients Serviced' is the first card, ahead of 'Total Accounts Serviced'");
assert(doc.getElementById("rep-kpiGrid-accounts").children[1].textContent.includes("Total Accounts Serviced"), "Repeat ACC Accounts: 'Total Accounts Serviced' is the second card");
assert(doc.getElementById("rep-kpiGrid-accounts").textContent.includes("Repeat Accounts"), "Repeat ACC Accounts: 'Repeat Accounts' (distinct-account count) card present");
assert(doc.getElementById("rep-kpiGrid-accounts").textContent.includes("New Accounts"), "Repeat ACC Accounts: card renamed to 'New Accounts' (was 'New Accounts/Clients')");
assert(!doc.getElementById("tab-repeat").textContent.includes("New Accounts/Clients"), "Repeat ACC Accounts: old 'New Accounts/Clients' label removed");
assert(!doc.getElementById("rep-kpiGrid-accounts").textContent.includes("Repeat Clients"), "Repeat ACC Accounts: 'Repeat Clients' card removed");
assert(!doc.getElementById("rep-kpiGrid-accounts").textContent.includes("New Clients"), "Repeat ACC Accounts: 'New Clients' card removed");
assert(doc.getElementById("rep-kpiGrid-accounts").textContent.includes("Accounts with Future Bookings"), "Repeat ACC Accounts: 'Accounts with Future Bookings' card present as the last 'By Accounts' card");
assert(doc.getElementById("rep-kpiGrid-accounts").children[doc.getElementById("rep-kpiGrid-accounts").children.length - 1].textContent.includes("Accounts with Future Bookings"), "Repeat ACC Accounts: 'Accounts with Future Bookings' is the last (rightmost) card in 'By Accounts'");
assert(!doc.querySelector("#tab-repeat h3.kpi-subhead .tag"), "Repeat ACC Accounts: 'Distinct accounts'/'Individual bookings' tag text removed from subheads");
assert(doc.querySelectorAll("#rep-clientsTable tbody tr").length > 0, "Repeat ACC Accounts: Accounts & Clients table has rows");

// Account Name and Lead are now searchable text inputs (paired with a
// <datalist>), not plain <select>s, so the user can type to search instead
// of scrolling a long dropdown.
assert(doc.getElementById("rep-account").tagName === "INPUT", "Repeat Clients: Account Name filter is a searchable text input");
assert(doc.getElementById("rep-account-options").children.length > 1, "Repeat Clients: Account Name datalist populated");
assert(doc.getElementById("rep-lead").tagName === "INPUT", "Repeat Clients: Lead filter is a searchable text input");
assert(doc.getElementById("rep-lead-options").children.length > 1, "Repeat Clients: Lead datalist populated");
assert(doc.getElementById("rep-manager").children.length > 1, "Repeat Clients: services manager filter populated");
{
  // Typing a complete, valid account name (as if picked from the datalist)
  // narrows every visual on the tab; clearing the box back to empty restores
  // the unfiltered view (same as picking "Select All" on every other filter).
  const acctInput = doc.getElementById("rep-account");
  const someAccount = data.repeatingClients.raw.find(r => r.accountName)?.accountName;
  assert(someAccount, "Repeat Clients: source data has a real account name to test the searchable filter with");
  const beforeAccounts = doc.querySelector("#rep-kpiGrid-accounts .kpi-card .value").textContent;
  acctInput.value = someAccount;
  acctInput.dispatchEvent(new window.Event("input"));
  const afterAccounts = doc.querySelector("#rep-kpiGrid-accounts .kpi-card .value").textContent;
  assert(Number(afterAccounts.replace(/,/g, "")) <= Number(beforeAccounts.replace(/,/g, "")), "Repeat Clients: typing a valid Account Name narrows the KPI cards");
  acctInput.value = "";
  acctInput.dispatchEvent(new window.Event("input"));
  // A partial, incomplete value (still mid-typing) should NOT filter yet.
  acctInput.value = someAccount.slice(0, 2);
  acctInput.dispatchEvent(new window.Event("input"));
  const midTyping = doc.querySelector("#rep-kpiGrid-accounts .kpi-card .value").textContent;
  assert(midTyping === beforeAccounts, "Repeat Clients: a partial/incomplete Account Name doesn't filter mid-typing");
  acctInput.value = "";
  acctInput.dispatchEvent(new window.Event("input"));
}
assert(doc.querySelectorAll("#rep-yoyTable tbody tr").length === 2, "Repeat Clients: Year over Year table has Clients + Accounts rows");
assert(doc.querySelector("#rep-yoyTable tbody").textContent.includes("Clients"), "Repeat Clients: YoY table has a Clients row");
assert(doc.querySelector("#rep-yoyTable tbody").textContent.includes("Accounts"), "Repeat Clients: YoY table has an Accounts row");
assert(doc.querySelectorAll("#rep-kpiGrid-accounts .daterange").length === 7, "Repeat ACC Accounts: every 'By Accounts' card shows a dynamic date-range subtitle (or, for Future Bookings, an explanatory note)");
assert(doc.getElementById("rep-repeat").children.length === 3, "Repeat ACC Accounts: 'Repeat' filter populated (All/Yes/No)");
{
  const repeatSel = doc.getElementById("rep-repeat");
  const before = doc.querySelector("#rep-kpiGrid-accounts .kpi-card .value").textContent;
  repeatSel.value = "Yes";
  repeatSel.dispatchEvent(new window.Event("change"));
  const afterYes = doc.querySelector("#rep-kpiGrid-accounts .kpi-card .value").textContent;
  assert(Number(afterYes.replace(/,/g, "")) <= Number(before.replace(/,/g, "")), "Repeat ACC Accounts: 'Repeat' filter narrows the KPI cards when set to Yes");
  repeatSel.value = "All";
  repeatSel.dispatchEvent(new window.Event("change"));
}
assert(doc.getElementById("rep-analysis1").querySelectorAll("strong").length > 0, "Repeat ACC Accounts: analysis 1 (by manager) has bolded values");
assert(doc.getElementById("rep-analysis2").querySelectorAll("strong").length > 0, "Repeat ACC Accounts: analysis 2 (repeat vs new) has bolded values");
assert(doc.getElementById("rep-yoy-analysis").querySelectorAll("strong").length > 0, "Repeat ACC Accounts: YoY table analysis sentence has bolded values");
assert(!doc.getElementById("tab-repeat").textContent.includes("proxy for repeat-booking depth"), "Repeat ACC Accounts: 'Bookings = how many times...' subsentence removed from Accounts & Clients table");
assert(doc.getElementById("rep-analysis3").querySelectorAll("strong").length > 0, "Repeat ACC Accounts: Accounts & Clients table has a bolded auto-analysis sentence");
// Accounts with Future Bookings is a point-in-time pipeline snapshot
// (bookings still ahead of *today*), which doesn't have a meaningful "same
// YTD window last year" comparison, so it intentionally has no delta.
assert(doc.querySelectorAll("#rep-kpiGrid-accounts .delta").length === 6, "Repeat ACC Accounts: 6 of 7 'By Accounts' cards show a YoY % delta (Accounts with Future Bookings has none)");
// Regression check: every analysis sentence on this tab now states the
// latest available month of data (not a year-to-date/whole-period total).
assert(/^In <strong>[A-Za-z]{3} \d{2}<\/strong>,/.test(doc.getElementById("rep-analysis1").innerHTML), "Repeat Clients: analysis 1 states the latest month, not a YTD/whole-period total");
assert(/^In <strong>[A-Za-z]{3} \d{2}<\/strong>,/.test(doc.getElementById("rep-analysis2").innerHTML), "Repeat Clients: analysis 2 states the latest month, not a YTD/whole-period total");
assert(/^In <strong>[A-Za-z]{3} \d{2}<\/strong>,/.test(doc.getElementById("rep-analysis3").innerHTML), "Repeat Clients: analysis 3 states the latest month, not a YTD/whole-period total");
// Accounts & Clients table: new Lead/Start Date/End Date columns, positioned
// before Attendance; "Repeat?" reflects the sheet's own raw Repeat Business
// column value directly (no computed window).
assert(doc.querySelector("#rep-clientsTable thead").textContent.trim() === "AccountLeadStart DateEnd DateAttendancePeak RoomRepeat?BookingsServices Manager", "Repeat Clients: Accounts & Clients table has Lead/Start Date/End Date columns before Attendance, and a raw Repeat? column");
assert(/^\d{2}\/\d{2}\/\d{4}$/.test(doc.querySelector("#rep-clientsTable tbody tr td:nth-child(3)").textContent), "Repeat Clients: Accounts & Clients table Start Date formatted MM/DD/YYYY");
assert(!doc.getElementById("rep-clientsTable").closest(".table-scroll"), "Repeat Clients: Accounts & Clients table no longer wrapped in a scrolling container");
assert([...doc.querySelectorAll("#tab-repeat h2")].some(h => h.textContent.trim() === "Accounts & Clients"), "Repeat Clients: 'Accounts' table renamed to 'Accounts & Clients'");
{
  // Repeat definition (reverted, per direction, back to the sheet's own raw
  // "Repeat Business" column): computeRepeatFlags() just reads r.repeat
  // ("Yes"/"No") directly onto r.isRepeatFlag, no rolling-window computation.
  assert(typeof window.computeRepeatFlags === "function", "Repeat Clients: computeRepeatFlags() is available for testing");
  const rows = data.repeatingClients.raw.map(r => ({ ...r }));
  window.computeRepeatFlags(rows);
  assert(rows.every(r => typeof r.isRepeatFlag === "boolean"), "Repeat Clients: every row gets an isRepeatFlag boolean");
  assert(rows.every(r => r.isRepeatFlag === (r.repeat === "Yes")), "Repeat Clients: isRepeatFlag is a direct pass-through of the raw 'Repeat Business' column (Yes/No)");
  const yesRow = data.repeatingClients.raw.find(r => r.repeat === "Yes");
  const noRow = data.repeatingClients.raw.find(r => r.repeat === "No");
  assert(yesRow && noRow, "Repeat Clients: source data has both Yes and No Repeat Business values to test against");
}
{
  // Repeat Accounts: distinct Account ID with >=1 row where Repeat Business
  // = Yes (account-level). "Repeat Clients" is no longer a KPI card (removed
  // per direction), but the underlying row-level flag is still exercised via
  // computeRepeatFlags' own unit assertions above and the doughnut/analysis
  // sentence below.
  const raw = data.repeatingClients.raw;
  const expectedRepeatAccounts = new Set(raw.filter(r => r.repeat === "Yes").map(r => r.accountId)).size;
  const repYearSelForCheck = doc.getElementById("rep-year");
  repYearSelForCheck.value = "All";
  repYearSelForCheck.dispatchEvent(new window.Event("change"));
  const repeatAccountsCardValue = Number(doc.querySelectorAll("#rep-kpiGrid-accounts .kpi-card")[2].querySelector(".value").textContent.replace(/,/g, ""));
  assert(repeatAccountsCardValue === expectedRepeatAccounts, `Repeat ACC Accounts: 'Repeat Accounts' card (${repeatAccountsCardValue}) matches distinct Account ID count with Repeat Business = Yes (${expectedRepeatAccounts})`);
}
{
  // Regression check: selecting a completed past year (2025, since 2026 is
  // the latest year present in this sheet) should switch all 3 analysis
  // sentences from "latest month" to "full year" phrasing, matching Partner
  // Referrals' behavior -- not just show the last month of that past year.
  const repYearSel = doc.getElementById("rep-year");
  repYearSel.value = "2025";
  repYearSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("rep-analysis1").innerHTML.includes("In <strong>2025</strong>"), "Repeat Clients: analysis 1 uses full-year phrasing for a completed past year, not last month");
  assert(doc.getElementById("rep-analysis2").innerHTML.includes("In <strong>2025</strong>"), "Repeat Clients: analysis 2 uses full-year phrasing for a completed past year");
  assert(doc.getElementById("rep-analysis3").innerHTML.includes("In <strong>2025</strong>"), "Repeat Clients: analysis 3 uses full-year phrasing for a completed past year");
  repYearSel.value = "2026";
  repYearSel.dispatchEvent(new window.Event("change"));
  assert(!doc.getElementById("rep-analysis1").innerHTML.includes("In <strong>2026</strong>,"), "Repeat Clients: analysis 1 reverts to 'latest month' phrasing for the current year");
}

// Client Survey
assert(doc.getElementById("sur-kpiGrid").children.length === 4, "Client Survey: 4 KPI cards");
assert(doc.querySelector("#sur-kpiGrid").children[0].textContent.includes("The Overall Anaheim Experience Score"), "Client Survey: 'The Overall Anaheim Experience Score' card is first (left of Team Experience Score)");
assert(doc.querySelector("#sur-kpiGrid").children[1].textContent.includes("DS&E Manager Experience Score"), "Client Survey: DS&E Manager Experience Score card is second (left of Team Experience Score)");
assert(doc.querySelector("#sur-kpiGrid").children[2].textContent.includes("Visit Anaheim Team Experience Score"), "Client Survey: Team Experience Score card is third");
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
{
  // Regression check: the Client Survey program didn't start until October
  // 2023, so a YTD-cutoff window matching the latest year's latest populated
  // month (through June, currently) used to exclude 100% of 2023's real Q4
  // responses, leaving its whole column blank. "Ratings by Year" now uses
  // each year's own full-year average instead, so 2023 shows a real number.
  const firstRowCells = [...doc.querySelector("#sur-yoyValuesTable tbody tr").children];
  const year2023Cell = firstRowCells[1]; // Question, 2023, 2024, 2025, 2026
  assert(year2023Cell && /\d/.test(year2023Cell.textContent), "Client Survey: 'Ratings by Year' shows a real 2023 average, not blank/dash");
  assert(!year2023Cell.textContent.includes("&mdash;") && year2023Cell.textContent.trim() !== "—", "Client Survey: 2023 column isn't a dash placeholder");
}
assert(doc.querySelectorAll("#sur-yoyValuesTable thead th").length >= 2, "Client Survey: values table header built dynamically from data years");
assert(doc.querySelectorAll("#testimonialCols .testimonial").length > 0, "Client Survey: Q7 testimonial cards rendered");
assert(doc.querySelector("#testimonialCols .testimonial .yr"), "Client Survey: testimonial cards show a year title");
assert(doc.querySelector("#testimonialCols .testimonial .yr .sentiment-badge"), "Client Survey: each testimonial card shows a sentiment badge next to its year");
assert(
  [...doc.querySelectorAll("#testimonialCols .testimonial .yr .sentiment-badge")].every(el => ["Positive", "Neutral", "Negative"].includes(el.textContent.trim())),
  "Client Survey: sentiment badges are one of Positive/Neutral/Negative"
);
assert(doc.getElementById("q2q7SentimentScale").querySelector(".bar"), "Client Survey: aggregate sentiment scale (red-to-green bar) rendered next to the Feedback title");
assert(/\d+% negative, \d+% neutral, \d+% positive/.test(doc.getElementById("q2q7SentimentScale").textContent), "Client Survey: aggregate sentiment breakdown text shows % negative/neutral/positive");
{
  // Testimonial cards with a truncated comment (>220 characters) are
  // clickable and open a modal with the full, untruncated text -- shorter
  // comments (already shown in full) shouldn't be clickable, since there's
  // nothing more to reveal.
  const clickableCards = [...doc.querySelectorAll("#testimonialCols .testimonial.clickable")];
  assert(clickableCards.length > 0, "Client Survey: at least one testimonial card with a long comment is marked clickable");
  assert(clickableCards.every(el => el.querySelector(".read-more")), "Client Survey: clickable testimonial cards show a 'Read full comment' affordance");
  const nonClickable = [...doc.querySelectorAll("#testimonialCols .testimonial")].filter(el => !el.classList.contains("clickable"));
  assert(nonClickable.length === 0 || nonClickable.every(el => !el.querySelector(".read-more")), "Client Survey: non-clickable (already-short) testimonial cards have no 'Read full comment' affordance");

  const overlay = doc.getElementById("feedbackModalOverlay");
  assert(overlay, "Client Survey: feedback modal overlay element exists");
  assert(!overlay.classList.contains("open"), "Client Survey: feedback modal is closed by default");
  const card = clickableCards[0];
  const truncatedText = card.querySelector("p, div")?.textContent || card.textContent;
  card.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(overlay.classList.contains("open"), "Client Survey: clicking a clickable testimonial card opens the modal");
  const modalText = doc.getElementById("feedbackModalText").textContent;
  assert(modalText.length > 220, "Client Survey: modal shows the full, untruncated comment");
  assert(!modalText.includes("…") && !modalText.includes("&hellip;"), "Client Survey: modal text isn't truncated with an ellipsis");
  assert(["Positive", "Neutral", "Negative"].includes(doc.getElementById("feedbackModalSentiment").textContent.trim()), "Client Survey: modal shows the card's sentiment badge");
  assert(/^\d{4}$/.test(doc.getElementById("feedbackModalYear").textContent.trim()), "Client Survey: modal shows the card's year");

  // Clicking the close button closes it again.
  doc.getElementById("feedbackModalClose").dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(!overlay.classList.contains("open"), "Client Survey: clicking the close button closes the modal");

  // Clicking the overlay background (outside the modal box) also closes it.
  card.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(overlay.classList.contains("open"), "Client Survey: modal reopens for the next assertion");
  overlay.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(!overlay.classList.contains("open"), "Client Survey: clicking outside the modal box (the overlay background) closes the modal");
}
{
  // Regression check: a real, clearly negative testimonial ("I don't feel
  // like Visit Anaheim is as customer friendly as they used to be. Never
  // heard a word from our sales person...") was misclassified as Positive --
  // its one literal keyword hit, "friendly," was being counted at face value
  // even though it's inside a negated clause. Clause-level negation (see
  // SENTIMENT_NEGATORS/analyzeSentiment) should now flip it to Negative.
  assert(typeof window.analyzeSentiment === "function", "Client Survey: analyzeSentiment() is available for testing");
  const misclassifiedBefore = "Honestly, I don't feel like Visit Anaheim is as customer friendly as they used to be.  Never heard a word from our sales person after we booked and don't recall hearing from them as we approached this year's meeting.";
  assert(window.analyzeSentiment(misclassifiedBefore) === "Negative", "Client Survey: previously-misclassified negative testimonial now correctly scores Negative");
  assert(window.analyzeSentiment("The staff was not helpful at all.") === "Negative", "Client Survey: negated positive keyword ('not helpful') scores Negative");
  assert(window.analyzeSentiment("We were never disappointed with the service.") === "Positive", "Client Survey: negated negative keyword ('never disappointed') scores Positive");
  assert(window.analyzeSentiment("The team was extremely helpful and professional, we loved working with them!") === "Positive", "Client Survey: plainly positive feedback still scores Positive");
  assert(window.analyzeSentiment("This was a terrible experience, very unprofessional and slow.") === "Negative", "Client Survey: plainly negative feedback still scores Negative");
}
{
  // The ACC Survey sheet now has a manual "Sentiment" column (Positive/
  // Neutral/Negative) per Q7 response -- resolveSentiment() should read that
  // directly rather than re-deriving it from the keyword heuristic, since a
  // human-tagged value is more reliable. Confirmed against the exact
  // "customer friendly ... never heard a word" testimonial used above: its
  // sheet-tagged value should win even though it also independently scores
  // Negative via the heuristic.
  assert(typeof window.resolveSentiment === "function", "Client Survey: resolveSentiment() is available for testing");
  const taggedRow = data.accSurvey.raw.find(r => r.feedback && r.feedback.includes("customer friendly"));
  assert(taggedRow && taggedRow.sentiment, "Client Survey: the 'customer friendly' testimonial has a Sentiment value from the sheet");
  assert(window.resolveSentiment(taggedRow) === taggedRow.sentiment, "Client Survey: resolveSentiment() uses the sheet's own Sentiment column value");
  // A row with feedback but no Sentiment tag should still fall back to the
  // keyword heuristic instead of coming back blank.
  const untaggedPositive = { feedback: "The team was extremely helpful and professional, we loved working with them!", sentiment: null };
  assert(window.resolveSentiment(untaggedPositive) === "Positive", "Client Survey: resolveSentiment() falls back to the keyword heuristic when Sentiment is missing");
  // Every rendered testimonial card's badge should match that row's actual
  // sheet-tagged sentiment (not just "some valid word" as checked above).
  const q7Text = data.accSurvey.q2q7.q7Text;
  const cards = [...doc.querySelectorAll("#testimonialCols .testimonial")];
  const badges = cards.map(el => el.querySelector(".sentiment-badge").textContent.trim());
  const expectedTagged = data.accSurvey.raw.filter(r => r.question === q7Text && r.feedback && r.sentiment).length;
  assert(expectedTagged > 0, "Client Survey: at least some Q7 rows have a Sentiment tag from the sheet to verify against");
  assert(badges.length > 0, "Client Survey: testimonial badges rendered to compare against sheet data");
}
assert(!doc.getElementById("chartQ2"), "Client Survey: Q2 line chart removed from spotlight");
assert(doc.getElementById("q2q7Desc").textContent.trim().startsWith("Visit Anaheim Team Experience Feedback"), "Client Survey: feedback section subtitle renamed to 'Visit Anaheim Team Experience Feedback'");
assert(doc.querySelectorAll("#sur-kpiGrid .daterange").length >= 4, "Client Survey: every KPI card shows a dynamic date-range subtitle");
assert(doc.querySelectorAll("#sur-kpiGrid").length && [...doc.querySelectorAll("#sur-kpiGrid .kpi-card")][2].textContent.includes("Consists of 6 Questions"), "Client Survey: Team Experience Score card shows 'Consists of 6 Questions' subtext");
assert(doc.getElementById("sur-chart2-title").parentElement.querySelector(".tag")?.textContent === "Monthly", "Client Survey: 'Monthly' tag added next to 'Avg. Rating by Month'");
assert(doc.getElementById("sur-analysis1").querySelectorAll("strong").length > 0, "Client Survey: analysis 1 (by question) has bolded values");
assert(doc.getElementById("sur-analysis2").querySelectorAll("strong").length > 0, "Client Survey: analysis 2 (by month) has bolded values");
assert(doc.getElementById("sur-analysis3").querySelectorAll("strong").length > 0, "Client Survey: analysis 3 (by manager) has bolded values");
assert(doc.getElementById("sur-yoy-analysis").querySelectorAll("strong").length > 0, "Client Survey: YoY values table analysis sentence has bolded values");
assert(doc.querySelectorAll("#sur-kpiGrid .delta").length > 0, "Client Survey: at least some cards show a YoY % delta");
assert(doc.getElementById("sur-manager").children.length > 1, "Client Survey: services manager filter populated");
{
  // Regression check: adding the "Sentiment" column (H) to the ACC Survey
  // sheet shifted every column after it one to the right, which
  // build_data.py's manager/leadId indices didn't originally account for --
  // "manager" was silently reading the (usually blank) Event Attendance
  // column instead of the actual DS&E manager name, and "leadId" was reading
  // the manager name instead of the numeric lead ID. Confirms both are
  // correctly typed/populated now.
  const managers = [...new Set(data.accSurvey.raw.map(r => r.manager).filter(Boolean))];
  assert(managers.length > 0, "Client Survey: ACC Survey rows have a real (non-null) manager name after the Sentiment-column shift");
  assert(managers.every(m => typeof m === "string" && /[A-Za-z]/.test(m)), "Client Survey: manager field holds actual names, not blank Event Attendance values");
  const leadIds = data.accSurvey.raw.map(r => r.leadId).filter(v => v !== null && v !== undefined);
  assert(leadIds.length > 0 && leadIds.every(v => typeof v === "number"), "Client Survey: leadId field holds numeric lead IDs, not manager names");
}
assert(!doc.querySelector(".spotlight .tag"), "Client Survey: spotlight 'Beyond source report' tag removed");
assert(doc.querySelector(".spotlight h2").textContent.trim() === "Feedback", "Client Survey: spotlight title renamed to 'Feedback'");
assert(doc.getElementById("sur-chart1-title").textContent === "VA Survey Questions Rating", "Client Survey: 'Category Rating' renamed to 'VA Survey Questions Rating'");
assert(doc.getElementById("sur-chart2-title").textContent.trim().startsWith("Avg. Rating by Month"), "Client Survey: 'VA Team Experience Avg. Score by Month' renamed to 'Avg. Rating by Month'");
assert(doc.getElementById("sur-chart2-desc").textContent.includes("grouped by the date on each response"), "Client Survey: 'Avg. Rating by Month' has the new subtitle");
assert(doc.getElementById("sur-question").children.length > 1, "Client Survey: Question filter populated");
{
  // Selecting a specific question should narrow/relabel every visual on the tab.
  const qSel = doc.getElementById("sur-question");
  const target = [...qSel.options].find(o => o.value.includes("Overall Anaheim"));
  qSel.value = target.value;
  qSel.dispatchEvent(new window.Event("change"));
  assert(doc.getElementById("sur-chart1-title").textContent.includes("Overall Anaheim"), "Client Survey: chart title updates to the selected Question");
  assert(doc.querySelectorAll("#sur-yoyValuesTable tbody tr").length === 1, "Client Survey: YoY table narrows to 1 row when a Question is selected");
  assert(doc.querySelectorAll("#sur-kpiGrid .label")[2].textContent === "The Overall Anaheim Experience Score", "Client Survey: 'Team Experience Score' card relabels/recomputes to the selected Question");
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
assert(!doc.getElementById("hev-analysis5").textContent.includes("event/survey-type combinations are shown"), "Hosted Events: 'Event Survey Detail' subtext rewritten as a named-entity analysis, not the generic count sentence");
assert(/has the most survey-type coverage/.test(doc.getElementById("hev-analysis5").innerHTML), "Hosted Events: 'Event Survey Detail' analysis names the top event by survey-type coverage");

// Booked Business
// Room Nights/Economic Impact/Attendees were re-added per direction, on this
// tab only (not Overview), as simple sums matching the "Events That
// Generated Leads Detail" table's own subtotal row below -- and now render
// into their own second-row grid (bb-kpiGrid2), below the 6 core cards.
assert(doc.getElementById("bb-kpiGrid").children.length === 6, "Booked Business: 6 core KPI cards in the first row");
assert(doc.getElementById("bb-kpiGrid2").children.length === 3, "Booked Business: 3 KPI cards (Room Nights/Economic Impact/Attendees) in the second row");
assert(doc.getElementById("bb-kpiGrid2").textContent.includes("Room Nights"), "Booked Business: 'Room Nights' KPI card present");
assert(doc.getElementById("bb-kpiGrid2").textContent.includes("Economic Impact"), "Booked Business: 'Economic Impact' KPI card present");
assert(doc.getElementById("bb-kpiGrid2").textContent.includes("Attendees"), "Booked Business: 'Attendees' KPI card present");
assert(doc.getElementById("bb-manager").children.length > 1, "Booked Business: new 'Sales Manager' filter populated");
assert(doc.getElementById("bb-eventstatus").children.length > 1, "Booked Business: new 'Event Status' filter populated");
{
  // Event Status filter narrows rows on the Booked Business sheet's own
  // "Event Status" column (distinct from "Lead Status").
  const statuses = [...new Set(data.bookedBusiness.raw.map(r => r.eventStatus).filter(Boolean))];
  assert(statuses.length > 0, "Booked Business: source data has real Event Status values to filter by");
  const esSel = doc.getElementById("bb-eventstatus");
  const before = doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent;
  esSel.value = statuses[0];
  esSel.dispatchEvent(new window.Event("change"));
  const after = doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent;
  assert(Number(after.replace(/,/g, "")) <= Number(before.replace(/,/g, "")) || after !== before, "Booked Business: Event Status filter narrows the tab");
  esSel.value = "All";
  esSel.dispatchEvent(new window.Event("change"));
}
assert([...doc.querySelectorAll("#tab-booked h2")].some(h => h.textContent.includes("Hosted Events & Booked Business")), "Booked Business: cross-reference section now lives on this tab");
assert(doc.querySelectorAll("#hev-bbTable tfoot tr").length === 1, "Booked Business: cross-reference table has a totals row");
// Booked Business's Year filter defaults to the latest year actually present
// in the sheet -- 2026 rows were added to this sheet in the September 2026
// data refresh, so the default moved from 2025 to 2026. Checked here, before
// any assertion below deliberately changes the selector.
assert(doc.getElementById("bb-year").value === "2026", "Booked Business: Year filter defaults to the latest year present in the data");
assert(doc.querySelector("#tab-booked .footnote")?.textContent.includes("always shows 2025 data"), "Booked Business: cross-reference visual has a static footnote explaining it's pinned to 2025");
{
  // The eventId join between Event Surveys and Booked Business only holds
  // for 2025 data (see renderHevBookedLink's comment) -- 2026's two sheets
  // use non-overlapping ID ranges as of the September 2026 data refresh. Per
  // explicit direction, this visual is now PINNED to 2025 regardless of the
  // Booked Business tab's Year filter, so this checks that it shows the same
  // 5-event result at the default (2026), and stays there even after
  // switching the Year filter through 2025/2026/All.
  assert(doc.querySelectorAll("#hev-bbTable tbody tr").length === 5, "Booked Business: cross-reference visual shows 2025's 5 events even though the tab defaults to 2026");
  assert(doc.getElementById("hev-bb-analysis").textContent.includes("in 2025"), "Booked Business: cross-reference analysis sentence names 2025, not the selected Year");
  const bbYearSel = doc.getElementById("bb-year");
  for (const y of ["2025", "2026", "All"]) {
    bbYearSel.value = y;
    bbYearSel.dispatchEvent(new window.Event("change"));
    assert(doc.querySelectorAll("#hev-bbTable tbody tr").length === 5, `Booked Business: cross-reference visual still shows 5 events with Year=${y}`);
    assert(doc.getElementById("hev-bb-analysis").textContent.includes("in 2025"), `Booked Business: cross-reference analysis sentence still names 2025 with Year=${y}`);
  }
  const footCells = [...doc.querySelectorAll("#hev-bbTable tfoot td")].map(td => td.textContent);
  assert(footCells[0].includes("5"), "Booked Business: cross-reference totals row shows the event count for 2025");
  bbYearSel.value = "2025";
  bbYearSel.dispatchEvent(new window.Event("change"));
}
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Total Events"), "Booked Business: 'Total Events' card present");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Events That Generated Leads"), "Booked Business: card renamed to 'Events That Generated Leads'");
assert(doc.getElementById("bb-kpiGrid").textContent.includes("Definite Leads Percentage"), "Booked Business: card renamed to 'Definite Leads Percentage'");
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
assert(doc.querySelector("#bb-detailTable thead").textContent.trim() === "EventAccountLeadSales ManagerRoom NightsEconomic ImpactAttendeesEvent Start DateLead Created Date", "Booked Business: detail table has Sales Manager/Room Nights/Economic Impact/Attendees columns");
assert(/^\d{2}\/\d{2}\/\d{4}$/.test(doc.querySelector("#bb-detailTable tbody tr td:nth-child(8)").textContent), "Booked Business: dates formatted MM/DD/YYYY");
assert(doc.querySelectorAll("#bb-kpiGrid .kpi-card.events-team").length + doc.querySelectorAll("#bb-kpiGrid2 .kpi-card.events-team").length === 9, "Booked Business: all 9 KPI cards (across both rows) get the blue events-team accent");
assert(doc.querySelectorAll("#bb-kpiGrid .daterange").length + doc.querySelectorAll("#bb-kpiGrid2 .daterange").length === 9, "Booked Business: every KPI card (across both rows) shows a dynamic date-range subtitle");
assert(doc.querySelectorAll("#bb-detailTable tfoot tr").length === 1, "Booked Business: 'Events That Generated Leads Detail' table has a subtotal row");
{
  const footCells = [...doc.querySelectorAll("#bb-detailTable tfoot td")].map(td => td.textContent);
  assert(/Total \(\d+ events?\)/.test(footCells[0]), "Booked Business: detail table subtotal row shows a distinct-event count");
  assert(footCells[5].startsWith("$"), "Booked Business: detail table subtotal row's Economic Impact cell is formatted as currency");
}
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
  // years the Booked Business sheet doesn't have data for yet -- "All" should
  // scope to years actually present in Booked Business, not every year Event
  // Surveys has on file. Booked Business now has both 2025 and 2026 (as of
  // the September 2026 data refresh), so All should equal the sum of the two
  // per-year figures, not just the 2025 figure alone as it did when Booked
  // Business only had one year of data.
  const bbYearSel = doc.getElementById("bb-year");
  bbYearSel.value = "2025";
  bbYearSel.dispatchEvent(new window.Event("change"));
  const totalEvents2025 = Number(doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent.replace(/,/g, ""));
  bbYearSel.value = "2026";
  bbYearSel.dispatchEvent(new window.Event("change"));
  const totalEvents2026 = Number(doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent.replace(/,/g, ""));
  bbYearSel.value = "All";
  bbYearSel.dispatchEvent(new window.Event("change"));
  const totalEventsAll = Number(doc.querySelector("#bb-kpiGrid .kpi-card .value").textContent.replace(/,/g, ""));
  assert(totalEventsAll === totalEvents2025 + totalEvents2026, `Booked Business: 'Total Events' with Year=All (${totalEventsAll}) matches 2025 (${totalEvents2025}) + 2026 (${totalEvents2026}), not inflated by other Event Surveys years`);
  assert(totalEvents2025 === 28 && totalEvents2026 === 7 && totalEventsAll === 35, "Booked Business: 'Total Events' reads 28 (2025) / 7 (2026) / 35 (All)");
  bbYearSel.value = "2026";
  bbYearSel.dispatchEvent(new window.Event("change"));
}

// Export as PDF button + events-team tab coloring (cross-tab checks)
assert(doc.querySelectorAll(".tab-panel .export-btn").length === 7, "Every tab has an 'Export as PDF' button");
assert(doc.querySelector('.tab-btn[data-tab="events"]') && doc.querySelector('.tab-btn[data-tab="booked"]'), "Hosted Events and Booked Business tab buttons exist for color-coding via CSS");

// Print CSS: zoomed out ~15%, landscape, and full-width (auto-fit KPI grid,
// no fixed-column override) so every tab's export isn't cut off/squished,
// matching how Repeat Clients was already printing.
{
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  // Brace-matching (not a lazy regex) since the block now contains a nested
  // @page {...} rule of its own -- a lazy `[\s\S]*?\n\}` would stop at that
  // inner closing brace instead of the outer block's.
  const startIdx = css.indexOf("@media print");
  const openIdx = css.indexOf("{", startIdx);
  let depth = 1, i = openIdx + 1;
  while (depth > 0 && i < css.length) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
  const printBlock = css.slice(startIdx, i);
  assert(/zoom:\s*65%/.test(printBlock), "Print CSS: @media print block zooms out to 65% (85% minus another 20 points) so side-by-side content stays on one row");
  assert(/@page\s*\{[^}]*size:\s*landscape/.test(printBlock), "Print CSS: @media print forces landscape orientation");
  assert(/\.wrap\s*\{[^}]*max-width:\s*none/.test(printBlock), "Print CSS: @media print lets .wrap use the full page width");
  // Regression check: an earlier pass forced .kpi-grid to a fixed 3-column
  // layout in print, which actually made wider-card tabs (e.g. Repeat
  // Clients' naturally-good 5-across row) look worse, not better -- it's
  // been removed so print relies on the same auto-fit/minmax rule used
  // on-screen, just with more width available to it.
  assert(!/\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(printBlock), "Print CSS: no forced 3-column KPI grid override in print (reverted -- auto-fit now applies)");
  assert(/\.print-only-tab-title\s*\{[^}]*display:\s*block/.test(printBlock), "Print CSS: @media print shows the print-only tab title");
}
assert(doc.querySelector(".print-only-tab-title"), "Print: print-only tab title element exists in the header");
// On-screen layout: .wrap widened from 1320px so the dashboard uses more of
// the screen (and every KPI grid/chart/table sized off it gets wider too).
{
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const wrapMatch = css.match(/\.wrap\s*\{[^}]*max-width:\s*(\d+)px/);
  assert(wrapMatch && Number(wrapMatch[1]) >= 1600, `.wrap max-width widened to at least 1600px (got ${wrapMatch ? wrapMatch[1] : "no match"}px)`);
}
// Repeat Clients Accounts table: date/short-value columns (Start Date, End
// Date, Attendance, Peak Room, Repeat?, Bookings) stay on one line so a date
// never breaks mid-value; only Account/Lead/Services Manager wrap.
{
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert(/#rep-clientsTable[^{]*nth-child\(3\)[\s\S]*?white-space:\s*nowrap/.test(css), "Repeat Clients: Start Date column forced nowrap so dates don't break mid-value");
  assert(/#rep-clientsTable[^{]*nth-child\(4\)[\s\S]*?white-space:\s*nowrap/.test(css), "Repeat Clients: End Date column forced nowrap so dates don't break mid-value");
}

// Spot-check the corrected KPI math against values verified live in the Power BI report
const overview = doc.getElementById("ov-kpiGrid").innerHTML;
console.log("\nAll checks passed.");
console.log(`Chart instances created: ${chartInstances}`);
console.log("Overview KPI grid (first 400 chars):\n", overview.slice(0, 400));
