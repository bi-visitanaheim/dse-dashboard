# Destination Services & Events Dashboard

A static, no-build web dashboard for Visit Anaheim's Destination Services & Events (DS&E) KPIs. Its structure mirrors the live Power BI **"Destination Services & Events KPIs"** report tab-for-tab: Overview, Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, and Booked Business.

It reads all its data from `data.json`, generated from the master workbook `Department KPIs.xlsx` by `build_data.py`. No build step, no server-side code — plain HTML/CSS/JS plus Chart.js from a CDN, so it deploys as-is to GitHub + Vercel.

## Project structure

```
index.html         Tab bar + layout for all 7 pages
css/style.css       Theme (navy/coral/teal/gold, Sharp Sans Display No.2 with system fallback)
js/app.js           Tab switching, Year (and Category/Status) filters, all KPI + chart logic
data.json           Raw per-record data (regenerate whenever the workbook changes)
build_data.py       Turns "Department KPIs.xlsx" into data.json
test/verify.mjs     Headless logic check (jsdom) — runs every tab and asserts it renders cleanly
```

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

## Filters implemented vs. the source report

This version implements a **Year** filter on every tab (Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, Booked Business), plus **Event Category** on Hosted Events and **Lead Status** on Booked Business. The source Power BI report also has a **Staff** slicer (Partner Referrals, Repeat Clients) and a **Rating range** slicer (Client Survey) that aren't wired up yet — the underlying data needed for them is already in `data.json` (staff/manager fields on every relevant row), so they can be added later without touching `build_data.py`.

The Year-over-Year tables (Team KPIs, Partner Referrals, Client Survey) always compare the two most recent years with data, independent of the Year filter — that matches the behavior observed in the live report.

## Insight narrative (Overview tab)

The Overview tab's narrative paragraphs are generated (not hand-written) by comparing the latest year with substantial data against the year before it, following a "So what → why → now what" structure: state the finding, suggest a likely explanation, and point to a next step or where to look for more context (e.g., pointing to the Q2/Q7 spotlight when the manager-experience score moves). Re-run `build_data.py` and refresh the page and the narrative updates itself from the new numbers.

## Q2 & Q7 spotlight (Client Survey tab)

This section is **not** in the source Power BI report — it's included because the DS&E dashboard brief specifically asked to relate Question 2 ("The Experience With Your Visit Anaheim Destination Service and Events Manager" — numeric, 0–10) with Question 7 (open-ended client testimonials) so the rating trend can be read alongside the qualitative feedback behind it. It always shows the full multi-year trend regardless of the Year filter.

## Known data-quality issue

Two rows in the **Events** sheet have a typo'd year (`2206` instead of, presumably, `2026`). `build_data.py` excludes any Events date outside 2020–2030 rather than guessing the intended year (`data.json → events.skippedInvalidDates`). Fix the dates in the source workbook and regenerate to include them.

## Brand / typography note

Org styling calls for **Sharp Sans Display No.2**. It's a licensed font, so it isn't bundled — `css/style.css` references it by name with a system-font fallback (Segoe UI/Arial). Add licensed font files under a `fonts/` folder and an `@font-face` rule if you have them.

The color palette (navy/coral/teal/gold) is a professional placeholder, not Visit Anaheim's official brand palette — no official hex values were available at build time. Swap the CSS variables at the top of `css/style.css` when you have brand guidelines.
