"""Build data.json for the DS&E dashboard from Master.xlsx.

DATA SOURCE (Oct 16, 2026 onward)
---------------------------------
Master.xlsx lives in SharePoint:
  Site:    https://visitanaheimorg.sharepoint.com/sites/BusinessIntelligence-Apps
  Library: Shared Documents ("Business Intelligence-Apps - Documents")
  Folder:  DS&E/Destination Services and Events Dashboard KPIs/Master.xlsx
  (web link: .../_layouts/15/Doc.aspx?sourcedoc={5190F585-22F9-43F3-8539-0303AD6DA8CB}&file=Master.xlsx)
When the library is synced with OneDrive, Master.xlsx sits one folder ABOVE
this script, so the default path below is ../Master.xlsx. Make sure OneDrive
has downloaded the file ("Always keep on this device") before running.

Usage:  python3 build_data.py                      (uses DEFAULT_SOURCE)
        python3 build_data.py "/path/to/Master.xlsx"

Sheets read (the only ones the dashboard shows):
  Planning Visits                 -> planningVisits   (Overview, Team KPIs)
  Partner Referrals Details       -> partnerReferrals (Partner Referrals)
  ACC Survey                      -> accSurvey        (Client Survey, Overview)
  Repeating ACC Clients Services  -> repeatingClients (Team KPIs: "Clients
                                     Serviced During Planning Visits")
Columns are found by their HEADER NAME (not position). If a sheet or a
required header is missing, the script stops with a clear error and does NOT
overwrite data.json -- it never writes empty data.
Master.xlsx is only read, never modified.
"""
import openpyxl, json, sys, os
from collections import defaultdict
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# ---- Default source: Master.xlsx in the parent folder (see docstring) ----
DEFAULT_SOURCE = os.path.join(SCRIPT_DIR, "..", "Master.xlsx")
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE)
OUT_PATH = os.path.join(SCRIPT_DIR, "data.json")


class SourceError(Exception):
    pass


def fail(msg):
    print("ERROR: " + msg)
    print("data.json was NOT changed.")
    sys.exit(1)


if not os.path.exists(SRC):
    fail(f"Could not find Master.xlsx at: {SRC}\n"
         "Pass the path explicitly: python3 build_data.py \"/path/to/Master.xlsx\"")

try:
    wb = openpyxl.load_workbook(SRC, data_only=True)
except Exception as e:  # e.g. OneDrive placeholder not downloaded yet
    fail(f"Could not open {SRC} as an Excel workbook ({e}). If it is a OneDrive "
         "cloud-only file, open it once or choose 'Always keep on this device', then retry.")


def sheet(name):
    """Find a sheet by name, ignoring stray leading/trailing spaces."""
    for ws in wb.worksheets:
        if ws.title.strip().lower() == name.strip().lower():
            return ws
    raise SourceError(f'Sheet "{name}" is missing from {os.path.basename(SRC)} '
                      f"(sheets found: {[w.title for w in wb.worksheets]})")


def norm(v):
    return " ".join(str(v).split()).lower() if v is not None else ""


def header_map(ws, required, scan_rows=10):
    """Locate the header row (first row in the top `scan_rows` containing every
    required header) and return (header_row_number, {header: column_number})."""
    want = {norm(h): h for h in required}
    for r in range(1, scan_rows + 1):
        found = {}
        for c in range(1, ws.max_column + 1):
            key = norm(ws.cell(row=r, column=c).value)
            if key in want and want[key] not in found:
                found[want[key]] = c
        if len(found) == len(required):
            return r, found
    raise SourceError(f'Sheet "{ws.title.strip()}": could not find a header row with all of '
                      f"{required} in the first {scan_rows} rows")


def iso(d):
    return d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else None


def iso_dt(d):
    return d.strftime("%Y-%m-%dT%H:%M:%S") if hasattr(d, "strftime") else None


def build():
    out = {"generatedAt": datetime.now().strftime("%Y-%m-%d"),
           "source": "Master.xlsx (SharePoint: BusinessIntelligence-Apps / DS&E / Destination Services and Events Dashboard KPIs)"}

    # ---------------- Planning Visits (monthly grain) ----------------
    ws = sheet("Planning Visits")
    PV = ["Date", "Planning Visits", "Clients Serviced", "Partners Visited",
          "Convention Groups Serviced", "In House Groups Serviced"]
    hr, col = header_map(ws, PV)
    pv = []
    for r in range(hr + 1, ws.max_row + 1):
        d = ws.cell(row=r, column=col["Date"]).value
        if not hasattr(d, "year"):
            continue
        g = lambda h: ws.cell(row=r, column=col[h]).value
        pv.append({
            "date": iso(d), "year": d.year,
            "planningVisits": g("Planning Visits"),
            "clientsServiced": g("Clients Serviced"),
            "partnersVisited": g("Partners Visited"),
            "conventionGroupsServiced": g("Convention Groups Serviced"),
            "inHouseGroupsServiced": g("In House Groups Serviced"),
        })
    if not pv:
        raise SourceError('Sheet "Planning Visits" has no dated rows under its header')
    out["planningVisits"] = pv

    # ---------------- Partner Referrals Details (one row per referral) ----------------
    # "count" is always 1 and "staff" duplicates "user" so app.js's existing
    # chart/card logic keeps working unchanged.
    ws = sheet("Partner Referrals Details")
    PR = ["Referral ID", "Referral Date", "Account Name", "Function Name",
          "Lead Arrival", "Lead Departure", "User"]
    hr, col = header_map(ws, PR)
    refs, skipped = [], 0
    for r in range(hr + 1, ws.max_row + 1):
        g = lambda h: ws.cell(row=r, column=col[h]).value
        rid, d = g("Referral ID"), g("Referral Date")
        if rid is None:
            continue
        if not hasattr(d, "year"):
            skipped += 1
            print(f"  (skipped Partner Referrals Details row {r}: Referral Date is not a date: {d!r})")
            continue
        refs.append({
            "referralId": rid, "date": iso(d), "year": d.year,
            "accountName": g("Account Name"), "functionName": g("Function Name"),
            "leadArrival": iso(g("Lead Arrival")), "leadDeparture": iso(g("Lead Departure")),
            "user": g("User"), "staff": g("User"), "count": 1,
        })
    if not refs:
        raise SourceError('Sheet "Partner Referrals Details" has no referral rows under its header')
    out["partnerReferrals"] = {"raw": refs}

    # ---------------- ACC Survey ("Visit Anaheim Team Experience") ----------------
    # date/year = Start Date everywhere on the dashboard; Recorded Date kept for reference.
    ws = sheet("ACC Survey")
    AS = ["Start Date", "Recorded Date", "Question", "Rating", "Feedback", "Sentiment",
          "Visit Anaheim Destination Service Manager", "LeadID"]
    hr, col = header_map(ws, AS)
    q_order, seen = [], set()
    for r in range(hr + 1, ws.max_row + 1):
        q = ws.cell(row=r, column=col["Question"]).value
        if q and q not in seen:
            seen.add(q)
            q_order.append(q)
    q_num = {q: i + 1 for i, q in enumerate(q_order)}
    survey = []
    for r in range(hr + 1, ws.max_row + 1):
        g = lambda h: ws.cell(row=r, column=col[h]).value
        q, sd = g("Question"), g("Start Date")
        if not q or not hasattr(sd, "year"):
            continue
        fb, se = g("Feedback"), g("Sentiment")
        survey.append({
            "question": q, "qNum": q_num[q], "rating": g("Rating"),
            "date": iso(sd), "year": sd.year, "recordedDate": iso_dt(g("Recorded Date")),
            "feedback": str(fb).strip() if fb else None,
            "sentiment": str(se).strip() if se else None,
            "manager": g("Visit Anaheim Destination Service Manager"),
            "leadId": g("LeadID"),
        })
    if len(q_order) < 7 or not survey:
        raise SourceError(f'Sheet "ACC Survey": expected at least 7 distinct questions with rows, found {len(q_order)}')
    out["accSurvey"] = {"questions": q_order, "raw": survey}

    # Q2 (DS&E manager rating) / Q7 (open-ended testimonial) spotlight
    q2_text, q7_text = q_order[1], q_order[6]
    years = sorted({row["year"] for row in survey})

    def yearly_avg(question):
        b = defaultdict(list)
        for row in survey:
            if row["question"] == question and isinstance(row["rating"], (int, float)):
                b[row["year"]].append(row["rating"])
        return {str(y): (round(sum(b[y]) / len(b[y]), 2) if b[y] else None) for y in years}

    def yoy(a, b):
        return None if a is None or b is None or a == 0 else round((b - a) / a, 4)

    q2_yearly = yearly_avg(q2_text)
    testimonials = defaultdict(list)
    for row in survey:
        if row["question"] == q7_text and row["feedback"]:
            testimonials[row["year"]].append({"date": row["date"][:10], "feedback": row["feedback"]})
    out["accSurvey"]["q2q7"] = {
        "q2Text": q2_text, "q7Text": q7_text, "q2Yearly": q2_yearly,
        "q2Yoy": {f"{a}-{b}": yoy(q2_yearly[str(a)], q2_yearly[str(b)]) for a, b in zip(years, years[1:])},
        "testimonialSamples": {str(y): testimonials[y][:3] for y in years},
        "totalTestimonials": sum(len(v) for v in testimonials.values()),
    }

    # ---------------- Repeating ACC Clients Services ----------------
    ws = sheet("Repeating ACC Clients Services")
    RC = ["Account ID", "Account Name", "Lead ID", "Lead Name", "Sales Manager", "Services Manager",
          "Convention Center", "Meeting Dates (Preferred Start)", "Meeting Dates (Preferred End)",
          "Original Total Attendance", "Requested Peak Room", "Repeat Business", "Status"]
    hr, col = header_map(ws, RC)
    rep = []
    for r in range(hr + 1, ws.max_row + 1):
        g = lambda h: ws.cell(row=r, column=col[h]).value
        mgr = g("Services Manager")
        if mgr is None:
            continue
        start = g("Meeting Dates (Preferred Start)")
        rep.append({
            "accountId": g("Account ID"), "accountName": g("Account Name"),
            "leadId": g("Lead ID"), "leadName": g("Lead Name"),
            "salesManager": g("Sales Manager"), "servicesManager": mgr,
            "conventionCenter": g("Convention Center"),
            "startDate": iso(start), "year": start.year if hasattr(start, "year") else None,
            "endDate": iso(g("Meeting Dates (Preferred End)")),
            "attendance": g("Original Total Attendance"), "peakRoom": g("Requested Peak Room"),
            "repeat": g("Repeat Business"), "status": g("Status"),
        })
    if not rep:
        raise SourceError('Sheet "Repeating ACC Clients Services" has no rows with a Services Manager')
    out["repeatingClients"] = {"raw": rep}
    return out, q_order, skipped


try:
    out, Q_ORDER, skipped = build()
except SourceError as e:
    fail(str(e))

with open(OUT_PATH, "w") as f:
    json.dump(out, f, indent=2, default=str)

print(f"DONE -> wrote {OUT_PATH} from {SRC}")
print("Questions:", Q_ORDER)
print("Planning visits rows:", len(out["planningVisits"]))
print("Referral rows:", len(out["partnerReferrals"]["raw"]), "skipped:", skipped)
print("Survey rows:", len(out["accSurvey"]["raw"]))
print("Repeat client rows:", len(out["repeatingClients"]["raw"]))
