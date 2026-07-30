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

Every tab has a **Year** filter (Team KPIs, Partner Referrals, Repeat Clients, Client Survey, Hosted Events, Booked Business), plus: **Event Category** and **Event Name** on Hosted Events, **Lead Status** and **Event Name** on Booked Business, **Services Manager** on Client Survey (drives the KPI grid, all three charts, the YoY table, and the Q2/Q7 spotlight), and **Account Name** on Repeat Clients. The source Power BI report's **Staff** slicer (Partner Referrals) isn't wired up yet — the data needed for it is already in `data.json`.

The Team KPIs YoY table now follows the Year filter: pick a year and the table compares it against the year before; "All" falls back to the two most recent years with data. The Partner Referrals and Client Survey YoY tables still always show the latest two (or full 2023–2026) years regardless of the Year filter, matching the source report's behavior — the Client Survey one does respect the Services Manager filter, though.

Every chart dashboard-wide shows data labels (via the `chartjs-plugin-datalabels` CDN plugin, registered globally in `app.js`), with contrast-aware label colors on stacked bars and doughnut/pie slices.

## Insight narrative (Overview tab)

The Overview tab's narrative paragraphs are generated (not hand-written) by comparing the latest year with substantial data against the year before it, following a "So what → why → now what" structure: state the finding, suggest a likely explanation, and point to a next step or where to look for more context (e.g., pointing to the Q2/Q7 spotlight when the manager-experience score moves). Re-run `build_data.py` and refresh the page and the narrative updates itself from the new numbers.

## Q2 & Q7 spotlight (Client Survey tab)

This section is **not** in the source Power BI report — it's included because the DS&E dashboard brief specifically asked to relate Question 2 ("The Experience With Your Visit Anaheim Destination Service and Events Manager" — numeric, 0–10) with Question 7 (open-ended client testimonials) so the rating trend can be read alongside the qualitative feedback behind it. It always shows the full multi-year trend regardless of the Year filter, but does respect the Services Manager filter (both the Q2 line chart and the testimonial samples are recomputed client-side from the raw survey rows).

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

## Known deployment issue (fixed)

The first GitHub upload lost the `css/` and `js/` subfolders — confirmed by checking the live site's network requests: `index.html` and `data.json` returned 200, but `style.css` and `app.js` both 404'd. As of this version, both files were moved to the repo root specifically so this can't recur regardless of how files are added to GitHub. If you re-upload, just make sure all 7 files at the repo root (`index.html`, `style.css`, `app.js`, `data.json`, `build_data.py`, `README.md`, `.gitignore`, `vercel.json`) land directly in the repo root — not nested inside an extra folder.
