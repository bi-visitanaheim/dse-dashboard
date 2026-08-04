# Destination Services & Events Dashboard

A static, no-build web dashboard for Visit Anaheim's Destination Services & Events (DS&E) KPIs. Its structure mirrors the live Power BI **"Destination Services & Events KPIs"** report tab-for-tab: Overview, Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, and Booked Business.

It reads all its data from `data.json`, generated from the master workbook `Department KPIs.xlsx` by `build_data.py`. No build step, no server-side code — plain HTML/CSS/JS plus Chart.js and the `chartjs-plugin-datalabels` plugin, both from a CDN, so it deploys as-is to GitHub + Vercel.

## Project structure

```
index.html         Tab bar + layout for all 7 pages
style.css           Theme (Visit Anaheim "ReBrand Teal" palette + Sharp Sans Disp No2)
app.js              Tab switching, Year (and Category/Status) filters, all KPI + chart logic
data.json           Raw per-record data (regenerate whenever the workbook changes)
build_data.py       Turns "Department KPIs.xlsx" into data.json
test/verify.mjs     Headless logic check (jsdom) — runs every tab and asserts it renders cleanly
```

Everything the browser loads (`index.html`, `style.css`, `app.js`, `data.json`) lives flat at the repo root — no subfolders. This is deliberate: GitHub's "upload files" web UI (drag-and-drop or file picker) frequently drops nested folders like `css/` or `js/` when you upload individual files instead of dragging a folder handle, which is exactly what happened on the first deploy of this dashboard (`style.css` and `app.js` both 404'd on the live Vercel URL even though `index.html` and `data.json` deployed fine). Keeping the browser-facing files flat means there's nothing for a file-picker upload to lose.

## Why raw rows, not pre-aggregated numbers

`data.json` stores row-level data (one entry per referral, survey response, client, event, lead, or event-survey response) rather than pre-computed monthly totals. That lets `app.js` filter by Year (and, on a couple of tabs, Category/Lead Status) and recompute every KPI and chart client-side — the same way the Power BI slicers work — instead of baking one fixed time window into the file.

## Updating the numbers

1. Update `Department KPIs.xlsx` (same sheet names/columns as before).
2. Regenerate:
   ```bash
   pip install openpyxl
   python3 build_data.py "/path/to/Department KPIs.xlsx"
   ```
3. Commit the new `data.json` and push — Vercel redeploys automatically, no rebuild step.

## Deploying to GitHub + Vercel

```bash
git init && git add . && git commit -m "Initial DS&E dashboard"
git branch -M main
git remote add origin https://github.com/<your-org>/<repo-name>.git
git push -u origin main
```
Then in [Vercel](https://vercel.com): **Add New → Project** → import the repo → deploy. No framework preset or build command needed.

## Data source mapping (Overview tab's 12 KPI cards)

**This section is the authoritative reference for exactly which sheet, column, and date field feeds each Overview KPI card and the Department at a Glance summary table below it. Any future change to these cards must update this table first, then `build_data.py`/`app.js` to match — not the other way around.**

All 12 cards are year-to-date (Jan 1 through the latest populated month), each compared against the same year-to-date window one year earlier. "Current year" is 2026 for every card except the two Booked Business cards, which automatically track whatever the latest year actually present in that sheet is (see note below the table) instead of a hardcoded year.

| # | Overview card | Source sheet | Value column | Aggregation | Date column used to filter |
|---|---|---|---|---|---|
| 1 | Planning Visits | Planning Visits | Planning Visits | Sum | Date |
| 2 | Clients Serviced | Planning Visits | Clients Serviced | Sum | Date |
| 3 | Partners Visited | Planning Visits | Partners Visited | Sum | Date |
| 4 | Convention Groups Serviced | Planning Visits | Convention Groups Serviced | Sum | Date |
| 5 | In House Groups Serviced | Planning Visits | In House Groups Serviced | Sum | Date |
| 6 | Partner Referrals | Partner Referrals | Partner Referrals | Sum | Date |
| 7 | Repeat Account % (formerly "Repeat Client %") | Repeating ACC Clients Services | Repeat Business (Yes/No) &mdash; % is computed as count of "Yes" &divide; total rows; there is no literal "Repeat Client %" column in the sheet | Ratio | Meeting Dates (Preferred Start) |
| 8 | VA Team Experience Rating | ACC Survey | Rating | Average | Start Date (column A) &mdash; this is the date field for the entire ACC Survey table dashboard-wide (Client Survey tab's Year filter, charts, YoY tables, Q2/Q7 spotlight, and this Overview card all use it). "Recorded Date" (column D, when the response was submitted) is captured separately as `recordedDate` in `data.json` but nothing on the dashboard currently filters by it |
| 9 | VA Hosted Events | Event Surveys | Event ID | Distinct count | Event Date |
| 10 | VA Event Satisfaction Score | Event Surveys | Satisfaction Score | Average | Event Date |
| 11 | "[Year] Leads Generated From VA Events" | Booked Business | Lead ID | Distinct count | Event Start Date |
| 12 | "[Year] Avg. Lead Conversion Window" | Booked Business | Days of Lead Created from Event | Average | Event Start Date |

Two things worth flagging about this mapping, found while reconciling it against the actual workbook headers:

- **Card 7** doesn't have a literal "Repeat Client %" column to pull from &mdash; the sheet only has a "Repeat Business" Yes/No flag per row (matches the same field the Repeat Clients tab already uses for its own repeat-rate cards). The percentage is computed client-side (Yes count &divide; total rows) exactly the same way on both tabs.
- **Cards 11 & 12** carry a dynamic year prefix (e.g. "2025 Leads Generated From VA Events") rather than a fixed one, because as of this build the Booked Business sheet only contains 2025 event dates &mdash; there's no 2026 data in that sheet yet. Rather than hardcode 2026 and show a false "-100%" drop, these two cards detect the latest year actually present in Booked Business and use that as "current," with the year before it as the comparison. Once 2026 events start appearing in that sheet, these two cards (and their year prefix) will automatically shift to 2026 vs. 2025 on the next `build_data.py` run &mdash; no code change needed.
- **Planning Visits** (and the four other cards that share its sheet) exclude any month whose row exists but has no data filled in yet (all five metric columns null) when finding the "latest month" cutoff &mdash; otherwise an empty placeholder row for an upcoming month would make the cutoff (and the subtitle above the narrative) jump ahead of the actual last-reported month.

**Department at a Glance** (the table directly under the 12 cards) is fully automated: it shows, for each of the same 12 categories, that category's own latest single month's actual value, its year-to-date value, and the year-over-year % change vs. the prior year's YTD &mdash; regenerated from `data.json` on every page load, with no manually-written numbers. Re-run `build_data.py` after updating the workbook and this table (along with the 12 cards and the narrative below it) updates itself.

## Data source mapping (Team KPIs tab)

Confirmed against the actual workbook headers, same as the Overview mapping above. Every card, chart, and table on this tab reads from the single "Planning Visits" sheet, using its "Date" column for the Year filter and the x-axis on all three charts:

| Visual | Column(s) | Aggregation |
|---|---|---|
| KPI cards (left to right: Partners Visited, Planning Visits, Convention Groups Serviced, In House Groups Serviced, Clients Serviced) | Partners Visited / Planning Visits / Convention Groups Serviced / In House Groups Serviced / Clients Serviced | Sum, for the selected Year |
| "Partners Visited & Planning Visits" chart | Partners Visited, Planning Visits (y-axis); Date (x-axis) | Monthly values |
| "Groups Serviced" chart | Convention Groups Serviced, In House Groups Serviced (y-axis); Date (x-axis) | Monthly values |
| "Clients Serviced" chart | Clients Serviced (y-axis); Date (x-axis) | Monthly values |
| Year-over-Year KPIs table (row order: Partners Visited, Planning Visits, Convention Groups Serviced, In House Groups Serviced, Clients Serviced) | Same five columns | Sum per year, Selected Year vs. the year immediately before it |

Notes:

- The **Year filter defaults to 2026** on page load (falls back to "All" automatically if a future data refresh ever removes 2026 from the sheet).
- The KPI card order and the Year-over-Year table's row order match (Partners Visited first in both).
- The Year-over-Year table always shows all five rows even if a metric has no prior-year data at all. As of this build, the source sheet's 2025 rows have "Partners Visited" and "In House Groups Serviced" blank for every month (only Planning Visits, Convention Groups Serviced, and Clients Serviced were tracked in 2025) &mdash; those two rows show "&mdash;" for the % change instead of a misleading number or disappearing from the table. Once 2025 data is backfilled for those columns, the % change will populate automatically on the next `build_data.py` run.

## Data source mapping (Partner Referrals tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab reads from the single "Partner Referrals" sheet, and every one of them responds live to the Year filter (which reads from that sheet's "Date" column):

| Visual | Column(s) | Aggregation |
|---|---|---|
| Partner Referrals card | Partner Referrals | Sum, for the selected Year |
| Avg. Referrals per Entry card | Partner Referrals | Average, for the selected Year |
| "Partner Referrals by Staff" chart | Staff (x-axis); Partner Referrals (y-axis) | Sum per staff member, for the selected Year |
| "Partner Referrals by Month" chart | Date (x-axis); Partner Referrals (y-axis) | Sum per month, for the selected Year |
| "Monthly Referrals by Staff" chart | Date (x-axis); Partner Referrals (y-axis); Staff (legend/series) | Sum per staff member per month, for the selected Year |
| Year-over-Year table | Partner Referrals | Sum per year, Selected Year vs. the year immediately before it |

Notes:

- The **Year filter defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), same as Team KPIs.
- Click-to-highlight on this tab works across all three charts, but along two different, independent dimensions: clicking a bar in "Partner Referrals by Staff" selects a **staff member** (fades that person's non-matching bar there, and fades every other staff member's stacked segments in "Monthly Referrals by Staff"); clicking a bar in "Partner Referrals by Month" or "Monthly Referrals by Staff" selects a **month** (fades non-matching months in both of those charts). The two selections are independent and can be combined (e.g., a specific staff member in a specific month). "Partner Referrals by Staff" has no month dimension and "Partner Referrals by Month" has no staff dimension, so each selection only visibly affects the two charts that share that dimension.

## Data source mapping (Repeat Clients tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab reads from the single "Repeating ACC Clients Services" sheet, filtered by its "Meeting Dates (Preferred Start)" column ("Meeting Start Date") for the Year filter, by "Account Name" for the Account Name filter, and by "Services Manager" for the Services Manager filter -- all three filters drive every card/chart/table on the tab dynamically, and can be combined.

| Visual | Column(s) | Formula |
|---|---|---|
| Total Clients Serviced card | Lead ID | Distinct count |
| Total Accounts Serviced card | Account ID | Distinct count |
| Repeat Accounts card | Repeat Business | `Repeat Clients Count = CALCULATE(COUNTROWS('RepeatingBusiness'), KEEPFILTERS('RepeatingBusiness'[Repeat Business] = "Yes"))` |
| Repeat Account Percentage card | Repeat Business | `Repeat Client % = DIVIDE(CALCULATE(COUNTROWS('RepeatingBusiness'), KEEPFILTERS('RepeatingBusiness'[Repeat Business] = "Yes")), COUNTROWS('RepeatingBusiness'), 0)` |
| Accounts w/ Repeat Bookings card | Account ID | `Repeat Accounts Count = COUNTROWS(FILTER(VALUES('RepeatingBusiness'[Account ID]), CALCULATE(COUNTROWS('RepeatingBusiness')) > 1))` |
| "Repeat vs. New Services Manager" chart | Services Manager (y-axis); Repeat Business (x-axis, as count); Repeat Business (legend) | Row count per manager, split Repeat/New |
| "Repeat vs. New: Clients & Accounts" chart | Lead ID (Clients ring), Account ID (Accounts ring); both split by Repeat Business (legend) | Distinct count, split Repeat/New |
| Accounts table | Account = Account Name; Attendance = Original Total Attendance; Peak Room = Requested Peak Room; Repeat = Repeat Business; Services Manager = Services Manager | Row-level detail, top 30 by number of bookings |

Notes:

- The **Year filter defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), same as the other tabs.
- "Total Clients Serviced" and the "Clients" ring's Repeat/New split now use **distinct count of Lead ID** rather than raw row counts, per the measures above. As of this build the sheet's grain is already one row per Lead ID (no duplicates), so the numbers are identical to a plain row count today -- but the distinct-count formula is what's now implemented, so it stays correct if a Lead ID ever appears on more than one row.
- Data labels on "Repeat vs. New Services Manager" suppress the "0" label for any manager with zero Repeat or zero New bookings, so a stray "0" never overlaps the real segment next to it.

## Data source mapping (Client Survey tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab reads from the single "ACC Survey" sheet, filtered by its "Start Date" column for the Year filter and by "Visit Anaheim Destination Service Manager" for the Services Manager filter -- both drive every card/chart on the tab dynamically.

| Visual | Column(s) | Formula |
|---|---|---|
| The Overall Anaheim Experience Score card | Rating | Average, filtered to Question = "The Overall Anaheim Experience" |
| Visit Anaheim Team Experience Score card | Rating | Average across all questions (grand mean) |
| DS&E Manager Experience Score card | Rating | Average, filtered to Question = "The Experience With Your Visit Anaheim Destination Service and Events Manager" |
| Survey Respondents card | Lead ID | Distinct count |
| "Category Rating" chart | Question (y-axis); Rating (x-axis) | Average per question |
| "Avg. Score by Month" chart | Start Date, by month (x-axis); Rating (y-axis) | Average per month |
| "Avg. Rating by DS&E Manager" chart | Visit Anaheim Destination Service Manager (x-axis); Rating (y-axis) | Average per manager |
| "Ratings by Year" table | Question (rows); Rating (values) | Average per question per year, one column per year present in the data (2023 through the latest year) |
| "Year-over-Year % Change" table | Question (rows); Rating (values) | YoY % change between each consecutive pair of years present in the data |
| "Feedback" section testimonials | Feedback | Up to 20 responses per year, each card titled with its year |

Notes:

- The **Year filter defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), same as the other tabs.
- **"The Overall Anaheim Experience Score"** replaces the former "Visit Anaheim Met Event Objectives Score" card and sits to the left of "Visit Anaheim Team Experience Score" -- it reads the new 8th ACC Survey question ("The Overall Anaheim Experience"), which the workbook started tracking retroactively across all 122 existing respondents (not from new respondents).
- **"Category Rating"** data labels are now bold and larger (font size bumped up, explicit bold weight) so they're easy to read at a glance.
- **"Ratings by Year" and "Year-over-Year % Change"** now build their year columns dynamically from whatever years are actually present in the ACC Survey sheet (2023 through the latest year), instead of a hardcoded 2023-2026 range -- both the table headers and the "Feedback" section's testimonial years update automatically as new years of data get added.
- **The Q2/Q7 spotlight is now just "Feedback"** -- the Q2 line chart was removed entirely (per direction to keep only the feedback cards); each testimonial card is titled with its year in bold, and shows up to 4 comments per year.

## Data source mapping (Hosted Events tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab (other than the fixed Booked Business cross-reference at the bottom) reads from the single "Event Surveys" sheet, filtered by its "Event Date" column for the Year filter, "Event Category" for the Event Category filter, and "Event" for the Event Name filter -- all three drive every card/chart on the tab dynamically.

| Visual | Column(s) | Formula |
|---|---|---|
| Total Events card | Event ID | Distinct count |
| Attendee Events card | Event ID | Distinct count, filtered to Event Survey Type = "Attendee" |
| Partner Events card | Event ID | Distinct count, filtered to Event Survey Type = "Partner" |
| Survey Respondents card | Event ID | Count (one row per response) |
| Avg. Satisfaction Score card | Satisfaction Score | Average |
| "Events by Month" chart | Event Date, by month (x-axis); Event ID (y-axis) | Distinct count per month |
| "Question Ratings" chart | Event Date, by month (x-axis); 4 rated questions (y-axis) | Average per month, one series each for Overall Experience, Recommend Future Events, Arrival and Registration, and Satisfaction Score (the latter scaled ×5 for display so all four sit on the same 0–5 axis) |
| "Avg. Rating by Question" table | Overall Experience, Recommend Future Events, Arrival and Registration, Satisfaction Score (rows); Event Survey Type (Attendee/Partner columns) | Average per question, split by Attendee vs. Partner, plus an unfiltered "Avg. Total" column |
| "Ratings by Event Category" table | Event Category (rows); Event ID, Satisfaction Score, Overall Experience, Arrival and Registration, Recommend Future Events (columns) | Respondents = count of Event ID; the four rating columns are averages |
| "Event Survey Detail" table | Event, Event Survey Type, Event Category, Event Date | One row per event/survey-type combination |
| "Hosted Events & Booked Business" cross-reference | Event (chart/table); Event ID (Survey Respondents); Satisfaction Score (Avg. Satisfaction Score); Booked Business's Lead ID (Leads Generated) | Only shows events that have a matching Booked Business record; Leads Generated is a distinct count of Lead ID |

Notes:

- The **Year filter now defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), matching every other tab.
- **"Question Ratings"** was switched from a by-year chart to a **by-month** chart (same x-axis grain as "Events by Month"), per direction, with the underlying questions renamed to their card/table labels: "Overall Experience," "Recommend Future Events," "Arrival and Registration" (was "Registration Experience" in the chart / "Registration and Arrival Process" in the table), and "Satisfaction Score" (was "Satisfaction").
- **"Avg. Rating by Question"** table's 4th column is now labeled **"Avg. Total"** (was "Total").
- **"Ratings by Event Category"** table's columns are now labeled with the full question names ("Avg. Satisfaction Score," "Overall Experience," "Arrival and Registration," "Recommend Future Events") instead of the earlier shortened labels.
- **"Event Survey Detail"** table's column order is now **Event, Event Type, Category, Date** (previously Event, Type, Date, Category), and its subtitle sentence ("One row per event / survey type...") was removed.

## Data source mapping (Booked Business tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab (other than "Total Events," see below) reads from the single "Booked Business" sheet, filtered by its "Event Start Date" column for the Year filter, "Lead Status" for the Lead Status filter, and "Event Name" for the Event Name filter -- all three drive every card/chart/table on the tab dynamically.

| Visual | Column(s) | Formula |
|---|---|---|
| Total Events card | Event ID (from the "Event Surveys" sheet) | Distinct count |
| Events That Generated Leads card | Event ID | Distinct count |
| Leads Generated card | Lead ID | Distinct count |
| Definite Leads card | Lead ID | Distinct count, filtered to Lead Status = "Definite" |
| Definite Leads Rate card | Lead ID | Definite Leads ÷ Leads Generated, shown as a percentage |
| Avg. Conversion Window card | Days of Lead Created from Event | Average; displayed in days, or in months (÷30) once the average passes 90 days |
| "Leads Generated by Event" chart | Event Name (x-axis); Lead ID (y-axis) | Distinct count per event, top 10 |
| "Leads Generated by Lead Status" chart | Lead ID (values); Lead Status (legend) | Distinct count per status |
| "Conversion Window by Event — Detail" table | Event (rows); Days of Lead Created from Event (bucketed) | Distinct count of Lead ID per bracket, per the DAX measure in the code comment above this table's render logic |
| "Events That Generated Leads Detail" table | Event Name, Account Name, Lead Name, Event Start Date, Lead Created Date | One row per unique Lead ID; both date columns formatted MM/DD/YYYY |

Notes:

- The **Year filter now defaults to 2026** on page load, same as every other tab -- but the Booked Business sheet only has 2025 data as of this build, so it currently falls back to "All" (the same fallback every other 2026-default filter already uses when a year isn't in the data yet). It'll start landing on 2026 automatically once 2026 rows are added to the sheet.
- **"Total Events"** is carried over from the Hosted Events tab and reads the separate "Event Surveys" sheet (distinct count of Event ID). It only follows this tab's **Year** filter (matched against that sheet's own Event Date year) -- it does **not** follow the Lead Status or Event Name filters, since Lead Status doesn't exist on the Event Surveys sheet, and the two sheets label events differently (e.g. "Ducks vs. Stars" vs. "2025 March Ducks vs. Dallas Stars" -- see the Hosted Events ↔ Booked Business cross-reference note below), so an Event Name selected here wouldn't reliably match a name on the other sheet.
- **"Leads Generated by Event"** is a distinct count of **Lead ID** per event (matching the chart's own name and the existing "Leads Generated" KPI card), not a distinct count of Event ID -- an Event ID count would always be 1 per event bar, which wouldn't be a meaningful chart. Flagging this since the column was given as "Event ID" but the behavior implemented matches "Leads Generated."
- **"Avg. Conversion Window"** auto-switches from days to months once the average exceeds 90 days (divided by 30 days/month), so a large day count reads as e.g. "4.2 months" instead of "127 days."
- **"Conversion Window by Event"** dropped its "% of Leads" chart (removed per direction) and kept only the "Detail" table, whose 5 columns are renamed to month-based brackets ("1 Month," "2-3 Months," "4-6 Months," "7-12 Months," "Over 12+ Months") -- the underlying day ranges are unchanged (0–30, 31–90, 91–180, 181–365, 366+), confirmed against the provided DAX measure for the "1 Month" bracket.
- **"Booked Business Detail"** is renamed **"Events That Generated Leads Detail"** and gains a **Lead** column (Lead Name) between Account and Event Start Date; both date columns are now formatted **MM/DD/YYYY** instead of the raw YYYY-MM-DD.

## How the KPI formulas were verified

Every KPI on this dashboard was checked against the numbers shown live in the Power BI report (viewed via browser on 2026-07-29) rather than assumed from column names. Some notable, non-obvious formulas this uncovered:

- **Client Survey "Team Experience Score"** is the grand mean across *all* individual rating values in the ACC Survey sheet (not an average of the six category averages — those differ slightly, 8.68 vs 8.62).
- **"Survey Respondents"** is a count of *unique Lead IDs*, not survey rows (each respondent answers all 6 questions, so rows are ~6x the respondent count).
- **Client Survey "Avg. Rating by [Manager]"** groups *all six* rated questions by the "Visit Anaheim Destination Service Manager" column — not just the Q2 (manager-specific) question.
- **Booked Business "Leads Generated"** counts unique Lead IDs. The sheet's grain is one row per attendee under a lead, so counting rows directly overstates leads by ~1.8x (273 attendee-rows vs. 152 unique leads).
- **Booked Business "Unique Attendees"** is unique **Contact ID**, not Attendee ID (Attendee ID varies per attendance record even for the same person).
- **Booked Business "Avg. Conversion Window"** is averaged at the attendee-row grain (not deduplicated by lead) — this is what matches the live report's 262.6-day figure exactly.
- **Repeat Clients "Accounts with Repeat Bookings"** counts accounts that appear more than once in the sheet at all (19), not accounts with a "Yes" repeat flag (which is a larger, different set).

One number I could **not** reproduce: the source report's Booked Business "Total Events" (35) and "Event Conversion Rate" (28.6%). The Booked Business sheet only contains events that already generated at least one lead, so a "total events" and "conversion rate" computed from it alone are tautological (always 100%). The live report's 35 almost certainly comes from a join to the broader Events calendar filtered to the same window — I didn't have enough visibility into that relationship to replicate it with confidence, so this dashboard shows "Distinct Events with Leads" instead and omits the conversion-rate card rather than presenting a number I couldn't verify.

**Hosted Events ↔ Booked Business relationship** (bottom of the Hosted Events tab): `eventSurveys` and `bookedBusiness` share the same `eventId` values even though the two sheets label events differently (e.g. "Ducks vs. Stars" in Event Surveys is "2025 March Ducks vs. Dallas Stars" in Booked Business). 6 of the 35 hosted events match a Booked Business `eventId`; the cross-reference table/chart shows 5 of those 6, because it counts unique leads the same way the rest of the tab does (`dedupeBy` on Lead ID), and a few leads in the source data span more than one event, so they get attributed to whichever event lists them first.

## Footer source line (per tab)

The "Source: ..." line in the footer changes depending on which tab is active, since each tab draws from a different mix of the department's underlying systems (not all of which are represented in `Department KPIs.xlsx` itself -- this reflects where the sheet's own data ultimately comes from). The mapping (`TAB_SOURCES` in `app.js`, applied in `switchTab()`):

| Tab | Source |
|---|---|
| Overview | Granicus, Association Insights, and Internal Tracking |
| Team KPIs | Granicus and Internal Tracking |
| Partner Referrals | Granicus |
| Repeat Clients | Granicus |
| Client Survey | Association Insights |
| Hosted Events | Internal Tracking |
| Booked Business | Granicus |

## Filters implemented vs. the source report

Every tab has a **Year** filter (Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, Booked Business), plus: **Event Category** and **Event Name** on Hosted Events, **Lead Status** and **Event Name** on Booked Business, **Services Manager** on Client Survey (drives the KPI grid, all three charts, the YoY table, and the Q2/Q7 spotlight), and **Account Name** plus **Services Manager** on Repeat Clients (both drive the KPI grid, both charts, and the Accounts table). The source Power BI report's **Staff** slicer (Partner Referrals) isn't wired up yet — the data needed for it is already in `data.json`.

The Team KPIs YoY table now follows the Year filter: pick a year and the table compares it against the year before; "All" falls back to the two most recent years with data. The Partner Referrals and Client Survey YoY tables still always show the latest two (or full 2023–2026) years regardless of the Year filter, matching the source report's behavior — the Client Survey one does respect the Services Manager filter, though.

Every chart dashboard-wide shows data labels (via the `chartjs-plugin-datalabels` CDN plugin, registered globally in `app.js`), with contrast-aware label colors on stacked bars and doughnut/pie slices.

## Click-to-highlight a month across charts

On tabs where more than one chart shares the same actual-calendar-month x-axis, clicking a bar highlights that month in every other chart sharing that axis (and fades the rest); clicking it again clears the highlight. This currently links Team KPIs' three charts together, and Partner Referrals' "by Month" and "Monthly Referrals by Staff" charts together (the latter was changed from a calendar-month-of-year view to the same continuous month timeline specifically so the two could link). Charts that are the only monthly chart on their tab (Client Survey's "Avg. Score by Month", Hosted Events' "Events by Month") don't have anything to cross-highlight against, so clicking them has no visible effect.

Partner Referrals also has a second, independent selection dimension: clicking a bar in "Partner Referrals by Staff" (which has no month axis) selects a staff member instead, fading everyone else's stacked segments in "Monthly Referrals by Staff" (the only other chart on that tab with a staff dimension). See "Data source mapping (Partner Referrals tab)" above for the full breakdown of which chart responds to which kind of click.

## Overview tab: year-to-date only

The Overview KPI cards show year-to-date totals only (not all-time), each with a YoY delta against the same year-to-date window one year earlier — the cutoff month is whichever month is latest in each underlying sheet's own current-year data (so, e.g., if Booked Business has data through a different month than Planning Visits, each card's comparison stays apples-to-apples rather than using one fixed month for everything). See "Data source mapping" above for the exact sheet/column/date-field each card pulls from. The subtitle above the narrative panel states the cutoff month dynamically. The narrative paragraphs below are unchanged — they still use the "most recent year with 5+ months of data vs. the year before it" logic, which independently resolves to the same current-vs-prior-year comparison.

## Insight narrative (Overview tab)

The three paragraphs below the Department at a Glance table are generated (not hand-written) and summarize all 12 KPI categories — the same categories, the same year-to-date figures, and the same YoY deltas already shown in the 12 cards and the summary table above, just written in prose grouped by theme (planning/servicing volume; referrals, repeat business, and team experience; events and lead generation) rather than repeated as another table. Each paragraph follows a light "So what → why → now what" structure: state the finding, suggest a likely explanation, and point to a next step or where to look for more context (e.g., pointing to the Q2/Q7 spotlight when the team experience score moves). Because the narrative pulls from the exact same `cur`/`pri` values used for the cards and table (not a separately-computed year comparison), the three will never disagree with each other. Re-run `build_data.py` and refresh the page and the narrative updates itself from the new numbers. Inline percentage deltas in both the KPI cards and this narrative are bold and colored (teal for up, navy for down) via the `.delta` / `.delta-inline` CSS classes.

## Feedback section (Client Survey tab)

Titled "Feedback," this section surfaces Question 7 (open-ended client testimonials). It originally paired a Question 2 line chart with the testimonials, but per later direction it's now feedback-cards only: each card is headed by its year and shows up to 20 testimonial quotes from Question 7 for that year (fewer if that year has less feedback than that). It now respects both filters on the tab — the Year filter (showing just the selected year's card, or every year present in the data when "All" is selected) and the Services Manager filter — same as every other card/chart on this tab (recomputed client-side from the raw survey rows).

## Known data-quality issue

Two rows in the **Events** sheet have a typo'd year (`2206` instead of, presumably, `2026`). `build_data.py` excludes any Events date outside 2020–2030 rather than guessing the intended year (`data.json → events.skippedInvalidDates`). Fix the dates in the source workbook and regenerate to include them.

## Brand / typography

This dashboard is restricted to **only** the six approved Visit Anaheim brand colors below — no other hues (including the gold/coral accents in the original Power BI theme) appear anywhere in the CSS or chart palettes. Borders, shadows, and muted text are opacity tints of these same six colors, not new hues.

| Variable | Hex | Role |
|---|---|---|
| `--navy` | `#125C60` | Primary deep teal (header, dark backgrounds, KPI card edge, "down" deltas) |
| `--teal` | `#43A3A3` | Mid teal (tags, chart series, "up" deltas) |
| `--teal-light` | `#77C7C9` | Light teal (chart series, spotlight accents) |
| `--pale` | `#B4D9E3` | Pale blue (chart series) |
| `--text` | `#231F20` | Near-black body text |
| `--bg` | `#F9F9F2` | Warm off-white page background |

Typeface is **Sharp Sans Disp No2** (the exact name used in the theme file), referenced by name in `style.css` with a system-font fallback (Segoe UI/Arial) since it's a licensed font not bundled here. Add licensed font files and an `@font-face` rule if you have them.

### Logo

The header has an `<img class="brand-logo" src="logo.png">` in place (it appears on every tab since the header is shared across the whole single-page app), wired to fail silently (`onerror` hides the element) so the layout doesn't break if the file is ever missing. `logo.png` at the repo root is currently the off-white "A" mark (transparent background, tightly cropped, no padding) — it was chosen over the full "Anaheim California" wordmark and the dark/black "VISIT Anaheim" wordmark because it reads clearly at the small, fixed 48px height this space is designed for, and its off-white fill shows up against the dark navy-to-teal header gradient (the dark wordmark version would disappear against that background). To swap in a different logo variant, just replace `logo.png` with another transparent, light-colored file — no code changes needed.

## Known deployment issue (fixed)

The first GitHub upload lost the `css/` and `js/` subfolders — confirmed by checking the live site's network requests: `index.html` and `data.json` returned 200, but `style.css` and `app.js` both 404'd. As of this version, both files were moved to the repo root specifically so this can't recur regardless of how files are added to GitHub. If you re-upload, just make sure all 7 files at the repo root (`index.html`, `style.css`, `app.js`, `data.json`, `build_data.py`, `README.md`, `.gitignore`, `vercel.json`) land directly in the repo root — not nested inside an extra folder.
