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
- **Fixed a bug** in the 1-sentence auto-analysis under each chart: it previously always used the chronologically last row in the selected Year, which could be a pre-created placeholder row for an upcoming month with every metric still null (rendering as the literal text "&mdash;" instead of a real number, since the code used `textContent` rather than `innerHTML`). It now uses a `latestRowWithData(rows, fields)` helper that walks backward to the latest row where every field that sentence needs is actually populated, and writes via `innerHTML` so the `&mdash;` HTML entity (used elsewhere as a "no data" placeholder) renders as an actual em dash if it's ever needed rather than as literal text.

## Data source mapping (Partner Referrals tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab reads from the single "Partner Referrals" sheet, and every one of them responds live to the Year filter (which reads from that sheet's "Date" column):

| Visual | Column(s) | Aggregation |
|---|---|---|
| Partner Referrals card | Partner Referrals | Sum, for the selected Year |
| Avg. Referrals Per Month card | Partner Referrals | Plain AVERAGE() of the Partner Referrals count column for the selected Year (a row-level average, not summed-by-month first) -- confirmed against the live value (3.45 for 2026). Renamed from "Avg. Referrals per Entry" |
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
| Accounts table | Account = Account Name; Lead = Lead Name; Start Date/End Date = Meeting Dates (Preferred Start/End); Attendance = Original Total Attendance; Peak Room = Requested Peak Room; Repeat = Repeat Business; Services Manager = Services Manager | Row-level detail, top 30 by number of bookings |

Notes:

- The **Year filter defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), same as the other tabs.
- "Total Clients Serviced" and the "Clients" ring's Repeat/New split now use **distinct count of Lead ID** rather than raw row counts, per the measures above. As of this build the sheet's grain is already one row per Lead ID (no duplicates), so the numbers are identical to a plain row count today -- but the distinct-count formula is what's now implemented, so it stays correct if a Lead ID ever appears on more than one row.
- Data labels on "Repeat vs. New Services Manager" suppress the "0" label for any manager with zero Repeat or zero New bookings, so a stray "0" never overlaps the real segment next to it.

## Data source mapping (Client Survey tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab reads from the single "ACC Survey" sheet, filtered by its "Start Date" column for the Year filter, "Visit Anaheim Destination Service Manager" for the Services Manager filter, and "Question" for the Question filter -- all three drive every card/chart/table on the tab dynamically.

| Visual | Column(s) | Formula |
|---|---|---|
| The Overall Anaheim Experience Score card | Rating | Average, filtered to Question = "The Overall Anaheim Experience" (fixed regardless of the Question filter) |
| Visit Anaheim Team Experience Score card | Rating | Average across all questions (grand mean) when Question = "All"; when a specific Question is selected, this card recomputes to that question's own average and its label changes to "[Question] Score" |
| DS&E Manager Experience Score card | Rating | Average, filtered to Question = "The Experience With Your Visit Anaheim Destination Service and Events Manager" (fixed regardless of the Question filter) |
| Survey Respondents card | Lead ID | Distinct count (not question-specific) |
| "VA Survey Questions Rating" chart | Question (y-axis); Rating (x-axis) | Average per question; narrows to a single bar when a specific Question is selected. The Overall Anaheim Experience and DS&E Manager questions are highlighted with a lighter fill, since they're also their own KPI cards |
| "VA Team Experience Avg. Score by Month" chart | Start Date, by month (x-axis); Rating (y-axis) | Average per month, across all questions or just the selected Question |
| "Avg. Rating by DS&E Manager" chart | Visit Anaheim Destination Service Manager (x-axis); Rating (y-axis) | Average per manager, across all questions or just the selected Question |
| "Ratings by Year" table | Question (rows); Rating (values) | Average per question per year, one column per year present in the data (2023 through the latest year); narrows to 1 row when a Question is selected |
| "Year-over-Year % Change" table | Question (rows); Rating (values) | YoY % change between each consecutive pair of years present in the data; narrows to 1 row when a Question is selected |
| "Feedback" section testimonials | Feedback | Up to 20 responses per year, each card titled with its year (not affected by the Question filter -- Q7 is an open-ended question, not one of the rated questions in that dropdown) |

Notes:

- The **Year filter defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), same as the other tabs.
- **"The Overall Anaheim Experience Score"** replaces the former "Visit Anaheim Met Event Objectives Score" card and sits to the left of "Visit Anaheim Team Experience Score" -- it reads the new 8th ACC Survey question ("The Overall Anaheim Experience"), which the workbook started tracking retroactively across all 122 existing respondents (not from new respondents).
- **"Category Rating" was renamed "VA Survey Questions Rating"**, and **"Avg. Score by Month" was renamed "VA Team Experience Avg. Score by Month."** Data labels on the former are bold and larger (font size bumped up, explicit bold weight) so they're easy to read at a glance.
- **A new Question filter** was added, listing all 7 rated questions (everything except the open-ended Q7 feedback question). When a specific question is selected: the 3 chart titles and the 2 YoY table titles get an " — [Question]" suffix; "VA Survey Questions Rating" narrows to that question's single bar; "VA Team Experience Avg. Score by Month" and "Avg. Rating by DS&E Manager" recompute using only that question's ratings; both YoY tables narrow to a single row. The "Overall Anaheim Experience Score" and "DS&E Manager Experience Score" cards keep their own fixed meaning regardless of this filter, since their titles already name a specific question -- only "Visit Anaheim Team Experience Score" (normally the grand mean across all questions) is the one that recomputes and relabels itself to match the selected question.
- **"Ratings by Year" and "Year-over-Year % Change"** now build their year columns dynamically from whatever years are actually present in the ACC Survey sheet (2023 through the latest year), instead of a hardcoded 2023-2026 range -- both the table headers and the "Feedback" section's testimonial years update automatically as new years of data get added.
- **The Q2/Q7 spotlight is now just "Feedback"** -- the Q2 line chart was removed entirely (per direction to keep only the feedback cards); each testimonial card is titled with its year in bold, and shows up to 20 comments per year, respecting the Year and Services Manager filters (but not the new Question filter).
- **The "Feedback" section's subtitle** was changed from "Client feedback from Question 7 ("...")‚ grouped by year." to **"Visit Anaheim Team Experience Feedback"** (still appends "Filtered to responses naming [Manager] as the Services Manager" when the Services Manager filter is active).
- **"Visit Anaheim Team Experience Score"** now shows a **"Consists of 6 Questions"** subtext under its value, since it's the grand mean across the survey's 6 rated questions. That subtext only shows when the card is displaying the grand mean (Question filter = "All") -- it disappears once a specific Question is selected, since the card is then showing just that one question's average, not 6.

## Data source mapping (Hosted Events tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab reads from the single "Event Surveys" sheet, filtered by its "Event Date" column for the Year filter, "Event Category" for the Event Category filter, and "Event" for the Event Name filter -- all three drive every card/chart on the tab dynamically. (The former "Hosted Events & Booked Business" cross-reference has moved to the Booked Business tab -- see that section below.)

| Visual | Column(s) | Formula |
|---|---|---|
| Total Events card | Event ID | Distinct count |
| Attendee Events card | Event ID | Distinct count, filtered to Event Survey Type = "Attendee" |
| Partner Events card | Event ID | Distinct count, filtered to Event Survey Type = "Partner" |
| Survey Respondents card | Event ID | Count (one row per response) |
| Avg. Satisfaction Score card | Satisfaction Score | Average |
| "Events by Month" chart | Event Date, by month (x-axis); Event ID (y-axis) | Distinct count per month |
| "Survey Questions Ratings" chart | Event Date, by month (x-axis); 4 rated questions (y-axis) | Average per month, one series each for Overall Experience, Recommend Future Events, Arrival and Registration, and Satisfaction Score (the latter scaled ×5 for display so all four sit on the same 0–5 axis) |
| "Avg. Rating by Question" table | Overall Experience, Recommend Future Events, Arrival and Registration, Satisfaction Score (rows); Event Survey Type (Attendee/Partner columns) | Average per question, split by Attendee vs. Partner, plus an unfiltered "Avg. Total" column |
| "Ratings by Event Category" table | Event Category (rows); Event ID, Satisfaction Score, Overall Experience, Arrival and Registration, Recommend Future Events (columns) | Respondents = count of Event ID; the four rating columns are averages |
| "Event Survey Detail" table | Event, Event Survey Type, Event Category, Event Date | One row per event/survey-type combination |

Notes:

- The **Year filter now defaults to 2026** on page load (falls back to "All" if 2026 isn't in the data yet), matching every other tab.
- **"Question Ratings" is now "Survey Questions Ratings"**, and was switched from a by-year chart to a **by-month** chart (same x-axis grain as "Events by Month"), per direction, with the underlying questions renamed to their card/table labels: "Overall Experience," "Recommend Future Events," "Arrival and Registration" (was "Registration Experience" in the chart / "Registration and Arrival Process" in the table), and "Satisfaction Score" (was "Satisfaction"). It now also has a subtitle noting the 0–5 scale.
- **"Avg. Rating by Question"** table's 4th column is now labeled **"Avg. Total"** (was "Total").
- **"Ratings by Event Category"** table's columns are now labeled with the full question names ("Avg. Satisfaction Score," "Overall Experience," "Arrival and Registration," "Recommend Future Events") instead of the earlier shortened labels.
- **"Event Survey Detail"** table's column order is now **Event, Event Type, Category, Date** (previously Event, Type, Date, Category), and its subtitle sentence ("One row per event / survey type...") was removed.
- **The "Hosted Events & Booked Business" cross-reference section moved to the Booked Business tab** (directly beneath its KPI cards), per direction -- see the Booked Business mapping section below for its formulas, including its new totals row.

## Data source mapping (Booked Business tab)

Confirmed against the actual workbook headers. Every card, chart, and table on this tab (other than "Total Events" and the "Hosted Events & Booked Business" cross-reference, see below) reads from the single "Booked Business" sheet, filtered by its "Event Start Date" column for the Year filter, "Lead Status" for the Lead Status filter, and "Event Name" for the Event Name filter -- all three drive every card/chart/table on the tab dynamically.

| Visual | Column(s) | Formula |
|---|---|---|
| Total Events card | Event ID (from the "Event Surveys" sheet) | Distinct count |
| Events That Generated Leads card | Event ID | Distinct count |
| Leads Generated card | Lead ID | Distinct count |
| Definite Leads card | Lead ID | Distinct count, filtered to Lead Status = "Definite" |
| Definite Leads Percentage card | Lead ID | Definite Leads ÷ Leads Generated, shown as a percentage |
| Avg. Conversion Window card | Days of Lead Created from Event | Average; displayed in days, or in months (÷30) once the average passes 90 days |
| "Hosted Events & Booked Business" cross-reference | Event (chart/table); Event ID (Survey Respondents); Satisfaction Score (Avg. Satisfaction Score); Booked Business's Lead ID (Leads Generated) | Only shows events that have a matching Booked Business record; Leads Generated is a distinct count of Lead ID. Totals row: Event = count of events, Survey Respondents/Leads Generated = sum, Avg. Satisfaction Score = average |
| "Leads Generated by Event" chart | Event Name (x-axis); Lead ID (y-axis) | Distinct count per event, top 10 |
| "Leads Generated by Lead Status" chart | Lead ID (values); Lead Status (legend) | Distinct count per status |
| "Conversion Window by Event — Detail" table | Event (rows); Days of Lead Created from Event (bucketed) | Distinct count of Lead ID per bracket, per the DAX measure in the code comment above this table's render logic |
| "Events That Generated Leads Detail" table | Event Name, Account Name, Lead Name, Event Start Date, Lead Created Date | One row per unique Lead ID; both date columns formatted MM/DD/YYYY |

Notes:

- The **Year filter now defaults to the latest year of data actually present in the Booked Business sheet** (currently 2025, since 2026 rows haven't been added yet) -- previously this was hardcoded to "2026, falling back to All," which meant it landed on "All" instead of a single year. Defaulting to the latest year present means it'll show 2025 specifically today, and will move to 2026 on its own once 2026 rows are added.
- **"Total Events"** is carried over from the Hosted Events tab and reads the separate "Event Surveys" sheet (distinct count of Event ID). It only follows this tab's **Year** filter (matched against that sheet's own Event Date year) -- it does **not** follow the Lead Status or Event Name filters, since Lead Status doesn't exist on the Event Surveys sheet, and the two sheets label events differently (e.g. "Ducks vs. Stars" vs. "2025 March Ducks vs. Dallas Stars" -- see the cross-reference row above), so an Event Name selected here wouldn't reliably match a name on the other sheet.
- **The "Hosted Events & Booked Business" cross-reference section moved here from the Hosted Events tab**, directly beneath the KPI cards, per direction. It gained a **totals row** at the bottom of its table.
- **"Definite Rate" is now "Definite Leads Percentage."**
- **"Leads Generated by Event"** is a distinct count of **Lead ID** per event (matching the chart's own name and the existing "Leads Generated" KPI card), not a distinct count of Event ID -- an Event ID count would always be 1 per event bar, which wouldn't be a meaningful chart. Flagging this since the column was given as "Event ID" but the behavior implemented matches "Leads Generated." It's also grouped from the un-deduped rows now (see next note) so every event with leads shows up.
- **Fixed a bug**: "Leads Generated by Event" and "Conversion Window by Event — Detail" were silently dropping any event whose leads were *all* shared with another event, because they grouped from a Lead-ID-deduped-across-all-events list -- a lead touching 2 events only "belonged" to whichever one listed it first. Both now group from the full rows and take a distinct Lead ID count *within* each event's own rows, so every event that generated leads is now included (this can make an event's count add up to more than the tab-wide "Leads Generated" total, which is deduped globally on purpose).
- **"Events That Generated Leads Detail"** wraps its Event/Account/Lead column text instead of forcing horizontal scroll.
- **"Avg. Conversion Window"** auto-switches from days to months once the average exceeds 90 days (divided by 30 days/month), so a large day count reads as e.g. "4.2 months" instead of "127 days."
- **"Conversion Window by Event"** dropped its "% of Leads" chart (removed per direction) and kept only the "Detail" table, whose 5 columns are renamed to month-based brackets ("1 Month," "2-3 Months," "4-6 Months," "7-12 Months," "Over 12+ Months") -- the underlying day ranges are unchanged (0–30, 31–90, 91–180, 181–365, 366+), confirmed against the provided DAX measure for the "1 Month" bracket.
- **"Leads Generated by Lead Status"** and **"Repeat vs. New" (Repeat Clients tab)** doughnuts now anchor their data labels to the center of each arc instead of the outer edge, which was clipping or hiding labels on larger slices.
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

One number I could **not** reproduce: the source report's Booked Business "Total Events" (35) and "Event Conversion Rate" (28.6%). The Booked Business sheet only contains events that already generated at least one lead, so a "total events" and "conversion rate" computed from it alone are tautological (always 100%). The live report's 35 almost certainly comes from a join to the broader Events calendar filtered to the same window — I didn't have enough visibility into that relationship to replicate it with confidence, so this dashboard shows "Events That Generated Leads" instead (a distinct count of Event ID; a separate "Total Events" card, sourced from the Event Surveys sheet, was added later) and omits the conversion-rate card rather than presenting a number I couldn't verify.

**Hosted Events ↔ Booked Business relationship** (Booked Business tab, directly beneath the KPI cards -- moved here from the bottom of the Hosted Events tab): `eventSurveys` and `bookedBusiness` share the same `eventId` values even though the two sheets label events differently (e.g. "Ducks vs. Stars" in Event Surveys is "2025 March Ducks vs. Dallas Stars" in Booked Business). 6 of the 35 hosted events match a Booked Business `eventId`; the cross-reference table/chart shows 5 of those 6, because it counts unique leads the same way this specific visual always has (`dedupeBy` on Lead ID), and a few leads in the source data span more than one event, so they get attributed to whichever event lists them first. (This dedup-across-events quirk is intentional here and only affects this one cross-reference visual -- it's a different, and separately fixed, issue from the one described in the Booked Business notes above for "Leads Generated by Event" and the conversion window table.)

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

Every tab has a **Year** filter (Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, Booked Business), plus: **Event Category** and **Event Name** on Hosted Events, **Lead Status** and **Event Name** on Booked Business, **Services Manager** and **Question** on Client Survey (drive the KPI grid, all three charts, the YoY tables, and the visual titles -- see the Client Survey mapping notes above for exactly how the Question filter recomputes/relabels things), and **Account Name**, **Services Manager**, plus **Repeat** (new -- see above) on Repeat Clients (all drive the KPI grid, both charts, the Accounts table, and the Year over Year table). The source Power BI report's **Staff** slicer (Partner Referrals) isn't wired up yet — the data needed for it is already in `data.json`.

The Team KPIs YoY table now follows the Year filter: pick a year and the table compares it against the year before; "All" falls back to the two most recent years with data. The Partner Referrals and Client Survey YoY tables still always show the latest two (or full 2023–2026) years regardless of the Year filter, matching the source report's behavior — the Client Survey one does respect the Services Manager filter, though.

Every chart dashboard-wide shows data labels (via the `chartjs-plugin-datalabels` CDN plugin, registered globally in `app.js`), with contrast-aware label colors on stacked bars and doughnut/pie slices.

## Click-to-highlight a month across charts

On tabs where more than one chart shares the same actual-calendar-month x-axis, clicking a bar highlights that month in every other chart sharing that axis (and fades the rest); clicking it again clears the highlight. This currently links Team KPIs' three charts together, and Partner Referrals' "by Month" and "Monthly Referrals by Staff" charts together (the latter was changed from a calendar-month-of-year view to the same continuous month timeline specifically so the two could link). Charts that are the only monthly chart on their tab (Client Survey's "Avg. Score by Month", Hosted Events' "Events by Month") don't have anything to cross-highlight against, so clicking them has no visible effect.

Partner Referrals also has a second, independent selection dimension: clicking a bar in "Partner Referrals by Staff" (which has no month axis) selects a staff member instead, fading everyone else's stacked segments in "Monthly Referrals by Staff" (the only other chart on that tab with a staff dimension). See "Data source mapping (Partner Referrals tab)" above for the full breakdown of which chart responds to which kind of click.

## Overview tab: year-to-date only

The Overview KPI cards show year-to-date totals only (not all-time), each with a YoY delta against the same year-to-date window one year earlier — the cutoff month is whichever month is latest in each underlying sheet's own current-year data (so, e.g., if Booked Business has data through a different month than Planning Visits, each card's comparison stays apples-to-apples rather than using one fixed month for everything). See "Data source mapping" above for the exact sheet/column/date-field each card pulls from. Each card shows its own exact YTD window directly on the card (via `ytdRangeLabel`), so the "Department at a Glance" section no longer needs a separate sentence stating the same date range — `ov-desc` is intentionally left empty. The narrative paragraphs below are unchanged — they still use the "most recent year with 5+ months of data vs. the year before it" logic, which independently resolves to the same current-vs-prior-year comparison.

## Dynamic per-card date-range subtitle (every tab except Overview)

Every KPI card on Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, and Booked Business now shows a small date-range line under its value/delta, the same way Overview's cards do — but unlike Overview's fixed year-to-date window, this range is fully dynamic: it's the earliest-to-latest date actually present in whatever rows are feeding that tab right now, so it moves automatically with the tab's own Year (and, where present, Category/Status/Manager/Question) filters. Implemented via two small helpers in `app.js`:

- `rangeLabel(rows, dateField)` — the plain earliest/latest date across the given rows.
- `rangeLabelFiltered(rows, dateField, checkFields)` — same, but first drops any row where none of `checkFields` has a real value, so a sheet's placeholder row for an upcoming month (all metric columns still null) doesn't stretch the range a month past the actual data. Used on Team KPIs, whose Planning Visits sheet pre-creates that kind of placeholder row.

Each tab computes one range from its own currently-filtered rows and passes it to every `kpiCard()` call on that tab (Team KPIs: Date; Partner Referrals: Date; Repeat Clients: Meeting Dates/Start Date; Client Survey: Start Date; Hosted Events: Event Date; Booked Business: Event Start Date).

## Events-team card accent (Hosted Events & Booked Business tabs)

All KPI cards on the Hosted Events and Booked Business tabs now use the same pale-blue `.kpi-card.events-team` accent (border + light gradient background) that the 4 events-team cards on the Overview tab already used, since both tabs represent the events team's own data end to end. Overview's card color-coding (blue for events-team categories, navy for services-team categories) is unchanged — this just extends the same visual treatment tab-wide on the two tabs that are 100% events-team data.

## Insight narrative (Overview tab)

The three paragraphs below the Department at a Glance table are generated (not hand-written) and summarize all 12 KPI categories — the same categories, the same year-to-date figures, and the same YoY deltas already shown in the 12 cards and the summary table above, just written in prose grouped by theme (planning/servicing volume; referrals, repeat business, and team experience; events and lead generation) rather than repeated as another table. Each paragraph follows a light "So what → why → now what" structure: state the finding, suggest a likely explanation, and point to a next step or where to look for more context (e.g., pointing to the Q2/Q7 spotlight when the team experience score moves). Because the narrative pulls from the exact same `cur`/`pri` values used for the cards and table (not a separately-computed year comparison), the three will never disagree with each other. Re-run `build_data.py` and refresh the page and the narrative updates itself from the new numbers. Inline percentage deltas in both the KPI cards and this narrative are bold and colored (teal for up, navy for down) via the `.delta` / `.delta-inline` CSS classes.

## Feedback section (Client Survey tab)

Titled "Feedback," this section surfaces Question 7 (open-ended client testimonials). It originally paired a Question 2 line chart with the testimonials, but per later direction it's now feedback-cards only: each card is headed by its year and shows up to 20 testimonial quotes from Question 7 for that year (fewer if that year has less feedback than that). It now respects both filters on the tab — the Year filter (showing just the selected year's card, or every year present in the data when "All" is selected) and the Services Manager filter — same as every other card/chart on this tab (recomputed client-side from the raw survey rows).

## Auto-analysis sentences (every chart and Year-over-Year table, all tabs)

Every chart and every Year-over-Year table on Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, and Booked Business now has a bolded 1-sentence auto-generated takeaway underneath it (Overview already had its own narrative -- see above -- and wasn't touched here). All values inside these sentences are wrapped in `<strong>`. Two flavors, depending on whether the chart has a month axis:

- **Month-based charts** (Team KPIs' 3 charts, Partner Referrals "by Month," Client Survey "Avg. Score by Month," Hosted Events' 2 charts) use the same `latestRowWithData(rows, fields, dateField)` helper as the Team KPIs fix above -- states the latest month that actually has data for that chart's metric(s), and that month's value(s).
- **Non-month charts** (Partner Referrals "by Staff," Repeat Clients' 2 charts, Client Survey "by Question" and "by Manager," Booked Business's 2 charts) use a new `topEntry(list, valFn)` helper -- states whichever staff member/manager/question/event/status has the largest value instead of a "latest month," since these charts don't have a time axis to begin with.
- **Year-over-Year tables** (Team KPIs, Partner Referrals, Repeat Clients, Client Survey's "Ratings by Year") get a new `yoyAnalysisSentence` sentence via `yoyBiggestMover`, which resolves the same prior/latest year pair the table itself uses and states whichever metric moved the most (by absolute % change), with both years' values.

## Print / Export as PDF (every tab)

Every tab now has an **"Export as PDF"** button at the top (`.tab-toolbar`). It simply calls the browser's native `window.print()` -- there's no server-side PDF generation. A `@media print` block in `style.css` hides the header, tab bar, and toolbar buttons and prints only the currently active tab, so choosing the browser's "Save as PDF" destination in the print dialog produces a clean one-tab-at-a-time document. To export a different tab, switch to it first, then click its Export button (or just print again).

## Events-team tab bar coloring

The Hosted Events and Booked Business tab buttons in the top nav now get a pale-blue tint (inactive) / solid pale-blue background when active (`.tab-btn[data-tab="events"]`, `.tab-btn[data-tab="booked"]` in `style.css`), matching the same events-team accent already used on their KPI cards -- so the tab bar itself signals the grouping before a user even clicks into either tab.

## Repeat Clients: new "Repeat" filter

A fourth filter, **Repeat** (All / Yes / No), was added alongside Year/Account Name/Services Manager. It filters directly on the "Repeat Business" column and drives every card, chart, and table on the tab the same way the other three filters do (including the Year-over-Year table, via the same `yoyRows` chain the other filters already flow through).

## Booked Business: "Total Events" All-year fix + dynamic cross-reference

Two related bugs, both stemming from the same root cause: the "Total Events" card and the "Hosted Events & Booked Business" cross-reference visual both pull their event count from the separate Event Surveys sheet, which has years 2023 through 2026 on file -- but the Booked Business sheet itself currently only has 2025 data. When the Year filter was set to "All," both visuals were counting every Event Surveys year (35 events) instead of just the year(s) Booked Business actually has data for (28 events), which didn't match what "All" means everywhere else on this tab.

Fixed by scoping the Event Surveys side to `getYears(DATA.bookedBusiness.raw)` whenever Year = "All" (falls back to matching the single selected year otherwise), so "Total Events" now reads 28 for both "All" and "2025" specifically -- and will automatically expand to include 2026 once Booked Business itself has 2026 rows.

The cross-reference visual (chart, table, and its new description above) is also no longer a fixed, filter-independent snapshot -- it now respects this tab's Year, Lead Status, and Event Name filters, using the same Event-Surveys-scoped-to-Booked-Business-years logic for its own event total. It gained a new auto-generated sentence: "Out of the **X** events in **[year]**, **Y** events generated **Z** leads, based on matching Event ID between Event Surveys and Booked Business." -- fully dynamic with the tab's filters.

## Overview: Department at a Glance table no longer scrolls

The `.table-scroll` wrapper (which capped the table at a fixed height with a vertical scrollbar) was removed from around `#ov-summaryTable` specifically -- the table now expands to its full natural height. Every other `.table-scroll`-wrapped table on the dashboard (Accounts, YoY value tables, detail tables, etc.) is unchanged.

## Overview: clickable KPI cards filter the Department at a Glance table AND the narrative

Every one of the 12 Overview KPI cards is now clickable (`.kpi-card.selectable` in `style.css`, click handlers wired up in `renderOverview()`). Clicking a card highlights it with a light teal shade and:

- narrows the Department at a Glance table below to just that category's row, and
- swaps the 3-paragraph narrative above the table for that one category's own 1-sentence version (e.g. "Year to date through May 31, 2026, **In House Groups Serviced** reached **26**.") -- same YTD cur/pri/cutoff figures as everywhere else on the tab, via the new `OV_CATEGORY_SENTENCES` array built alongside the full narrative in `renderOverview()`.

Clicking the same card again (or reloading the page) clears the selection, restores all 12 summary-table rows, and restores the original full narrative (`OV_FULL_NARRATIVE`). Only one card can be selected at a time. This is purely a display filter -- it doesn't change any underlying numbers, just which rows/text are visible.

## Dashboard-wide YoY methodology: year-to-date, not full-year

Every KPI card that shows a YoY % delta -- on every tab, not just Overview -- now uses the exact same methodology: the "current" year is compared against the prior year over the identical January-1-through-cutoff-month window (the cutoff being the latest month with real, non-placeholder data in the current year), rather than comparing full calendar years against each other. This one rule (`ytdYoyMetric` in `app.js`) automatically produces the right result in both situations:

- If the selected/latest year is **still in progress** (like 2026 today), the comparison is a true YTD one -- exactly what Overview's cards have always done.
- If the selected year is a **completed past year** (like 2025), every month already has data, so the cutoff naturally resolves to December and the comparison becomes an ordinary full-year-vs-full-year one on its own -- no separate code path needed.

This same YTD-cutoff approach now also drives the existing "Year over Year" tables on Team KPIs, Partner Referrals, and Repeat Clients (previously full-selected-year-vs-full-prior-year sums), and Client Survey's "Ratings by Year"/"Year-over-Year % Change" tables (previously each year's full-year average; now every year column is limited to the same Jan-1-through-cutoff window of months, so a partial current year is never unfairly compared against complete past years). `resolveYoyYears()` centralizes which two years are being compared (a specific selected year vs. the year before it, or the two most recent years present when "All" is selected); `ytdDeltaText()` formats the result to match Overview's exact card wording ("▲ 12.3% (45 in 2025) vs 2025 YTD").

## Auto-analysis sentences: full-year phrasing for a completed past year

Every month-based auto-analysis sentence (Team KPIs' 3 charts, Partner Referrals "by Month" and "Monthly Referrals by Staff," Client Survey "by Month," Hosted Events' 2 charts) now checks `isPastYear(rows, selectedYear)` first. For the current/latest year (or "All"), it still states the latest populated month's figures as before. For a selected year that's already complete, it instead states that year's full-year totals -- this fixes a bug where a metric that's entirely null for an otherwise-complete year (e.g. Partners Visited wasn't tracked at all in 2025) used to make the whole sentence fall back to "No data available for this period yet." even though the year overall has plenty of real data.

## New auto-analysis sentences on table-only visuals

Beyond the chart/YoY-table sentences added previously, these table-only visuals also got a bolded 1-sentence auto-analysis: Repeat Clients' "Accounts" table (top account by number of bookings), Hosted Events' "Avg. Rating by Question," "Ratings by Event Category," and "Event Survey Detail" tables, and Booked Business's "Conversion Window by Event" and "Events That Generated Leads Detail" tables.

## Repeat Clients: removed "Bookings" subsentence

The "Accounts" table's subtitle sentence explaining what the Bookings column means ("Bookings = how many times this account appears in the dataset...") was removed per direction; the table now has its own auto-analysis sentence instead (see above).

## Booked Business: removed 3 subsentences

Per direction, three static subtitle sentences were removed (the visuals now rely on their new/existing auto-analysis sentences instead): "Of the 35 hosted events tracked here, these are matched by Event ID..." (Hosted Events & Booked Business), "Days from lead created to event start, bucketed by month..." (Conversion Window by Event), and "One row per unique lead." (Events That Generated Leads Detail).

## Client Survey: "VA Survey Questions Rating" bar color reverted

The lighter-fill highlight previously applied to the Overall Anaheim Experience and DS&E Manager bars (since those two also have their own KPI cards) was reverted per direction -- every bar on this chart is the same uniform navy color again.

## Tab bar: stronger color contrast for Hosted Events/Booked Business

The Hosted Events and Booked Business tab buttons now use a solid pale-blue fill (not just a faint tint) so they read as clearly distinct from the other 5 tabs at a glance, matching the same events-team accent already used on their KPI cards. The active state keeps the tab bar's normal off-white active background, with a pale-blue underline accent so it's still clear which of the two is currently open.

## Export as PDF: full page now prints

The print stylesheet no longer hides the header, logo, branding, or "data last refreshed" pill -- only the tab bar buttons and the "Export as PDF" buttons themselves are hidden (they're purely interactive controls with nothing to print). Only the currently active tab's content prints; switch to a different tab first to export that one instead.

## Repeat Clients: new "Repeat" filter

*(Documented above alongside the other Repeat Clients filters.)*

## Repeat Clients: auto-analysis sentences now state the latest month, not a YTD/whole-period total

Per direction, every 1-sentence auto-analysis on this tab (the two charts and the Accounts table) was changed from a whole-selected-period aggregate to the same "latest month with data" pattern used dashboard-wide (e.g. "In Jun 26, Pearl, Jenni serviced the most clients, with 5 total (repeat + new)." instead of a whole-year figure). The latest month is found from whatever's currently filtered (Year/Account Name/Services Manager/Repeat), via `monthKey(r.startDate)`, so it moves with those filters too. The "Year over Year" table's own auto-analysis sentence (`rep-yoy-analysis`) was intentionally left as a year-over-year comparison, since that's inherent to what a Year-over-Year table shows -- a "latest month" framing wouldn't make sense directly under it.

## Repeat Clients: Accounts table adds Lead/Start Date/End Date columns

The Accounts table now shows **Lead** (Lead Name), **Start Date**, and **End Date** (Meeting Dates (Preferred Start)/(Preferred End) -- `startDate`/`endDate` in `data.json`, see build_data.py) ahead of the Attendance column. Dates are formatted `MM/DD/YYYY` via the existing `mdy()` helper (same formatting already used on the Booked Business detail table).

## Repeat Clients: past-year analysis sentences now show full-year totals, not last month

Fixed a gap from the previous "latest month" change above: when a *completed past* year is selected in this tab's Year filter, the three analysis sentences (Repeat vs. New Services Manager, Repeat vs. New: Clients & Accounts, Accounts table) now state that year's **full-year** totals, matching the same `isPastYear()`-driven pattern already used on Team KPIs, Partner Referrals, Client Survey, and Hosted Events -- rather than just reporting the last month of that past year, which is what the plain "latest month" logic worked out to for a year that's already over. The current/latest year (or "All") is unaffected and still reports the latest available month, as before.

## Hosted Events: "Event Survey Detail" table analysis rewritten

The table's auto-analysis sentence no longer states a generic "N event/survey-type combinations are shown, spanning M distinct events." It now names the specific event with the most survey-type coverage (e.g. "**Ducks vs. Stars** has the most survey-type coverage, with **2** survey types recorded, across **7** distinct events total."), matching the named-top-entity style already used by Repeat Clients' Accounts table analysis and Booked Business' Events That Generated Leads Detail analysis.

## Header "Reporting period" pill is now dynamic per tab

The pill in the top-right of the header used to show a single hardcoded date range regardless of which tab was open. It now updates to reflect whichever tab is currently active, using that exact same date-range logic each tab's own KPI cards already use (`TAB_REPORTING_PERIODS` in `app.js`, populated by every `render*()` function and read by `switchTab()`). It also refreshes automatically as a tab's own Year/Manager/etc. filters change, since every `render*()` call updates it, not just the initial tab load.

## Print / Export as PDF: zoomed out ~15%

`@media print { body { zoom: 85%; } }` was added so a full tab's cards, charts, and tables fit on the printed/PDF page without getting cut off at the edge or squished together. `zoom` (not `transform: scale`) was used deliberately -- it reflows the layout at the smaller size rather than just shrinking a full-size layout visually into a clipped box, which is what actually buys back usable room per page. Supported by Chrome/Edge, which is what "Save as PDF" printing runs through in practice.

## Client Survey "Feedback" section: automated sentiment analysis

Since this is a static site with no backend or LLM/API access available client-side, sentiment is classified with a small, deterministic keyword-lexicon heuristic (`analyzeSentiment()` in `app.js`): each Q7 testimonial's text is lowercased, stripped of punctuation, and scored by counting hits against a fixed list of positive and negative words; a positive net score is "Positive," negative is "Negative," and zero (including no keyword hits at all) is "Neutral." This is an approximation, not true NLP -- it won't catch sarcasm, negation ("not helpful"), or words outside its two lists -- but it's consistent, explainable, and requires no external service.

- Each testimonial card shows its classified sentiment word (Positive/Neutral/Negative) as a small colored badge next to the year, on the same line (`.sentiment-badge`).
- Next to the "Visit Anaheim Team Experience Feedback" title, an aggregate breakdown (e.g. "20% negative, 40% neutral, 40% positive") plus a red-to-green segmented bar (`.sentiment-scale`) shows the overall mix across **all** Q7 feedback currently matching the Year/Services Manager filters -- not just the up-to-20-per-year subset rendered as cards, so it's a true overall picture even when a year has more than 20 responses.
- Both are fully dynamic: changing the Year or Services Manager filter re-classifies and re-aggregates immediately.
- Red/amber/green is used **only** in this one spot on the dashboard, as a deliberate, scoped exception to the six-color brand palette described below -- red-to-green is the near-universal, instantly legible convention for sentiment, which the brand's teal/navy tones can't convey as clearly.

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
