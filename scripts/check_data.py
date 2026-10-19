"""Sanity-check a freshly built data.json before the workflow commits it.

Published Oct 19, 2026 (approved by John Picou). Inert until the secrets in SETUP-REFRESH.md exist.
Fails (exit 1) on anything suspicious so the workflow stops and NOTHING is
committed -- it never lets empty or half-built data through. On success it
writes changed=true|false to $GITHUB_OUTPUT (generatedAt alone changing does
not count as a change, so an unchanged Master.xlsx makes no commit).

Usage: python scripts/check_data.py data.json --previous old.json --workbook Master.xlsx
"""
import argparse
import json
import os
import re
import sys

SHEETS = ["Planning Visits", "Partner Referrals Details", "ACC Survey", "Repeating ACC Clients Services"]
DATASETS = {  # label -> function returning the row list
    "planningVisits": lambda d: d.get("planningVisits"),
    "partnerReferrals.raw": lambda d: (d.get("partnerReferrals") or {}).get("raw"),
    "accSurvey.raw": lambda d: (d.get("accSurvey") or {}).get("raw"),
    "repeatingClients.raw": lambda d: (d.get("repeatingClients") or {}).get("raw"),
}
MAX_SHRINK = float(os.environ.get("MAX_SHRINK", "0.5"))  # fail if a dataset loses more than 50% of its rows


def problems(new, prev, workbook):
    out = []
    if not re.match(r"^\d{4}-\d{2}-\d{2}", str(new.get("generatedAt", ""))):
        out.append("generatedAt is missing or not a date")
    for label, get in DATASETS.items():
        rows = get(new)
        if not isinstance(rows, list) or not rows:
            out.append(f"{label} is empty or missing")
            continue
        if prev is not None:
            old = get(prev)
            if isinstance(old, list) and old and len(rows) < len(old) * (1 - MAX_SHRINK):
                out.append(f"{label} shrank from {len(old)} to {len(rows)} rows (more than {int(MAX_SHRINK * 100)}%)")
    q = (new.get("accSurvey") or {}).get("questions")
    if not isinstance(q, list) or len(q) < 7:
        out.append("accSurvey.questions has fewer than 7 questions")
    pv = new.get("planningVisits") or []
    if pv and not any(isinstance(r.get("planningVisits"), (int, float)) for r in pv):
        out.append("planningVisits has no numeric Planning Visits values")
    if workbook:
        import openpyxl
        wb = openpyxl.load_workbook(workbook, read_only=True)
        names = {ws.strip().lower() for ws in wb.sheetnames}
        wb.close()
        for s in SHEETS:
            if s.lower() not in names:
                out.append(f'Master.xlsx is missing the expected sheet "{s}"')
    return out


def strip_stamp(d):
    return {k: v for k, v in d.items() if k != "generatedAt"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--previous")
    ap.add_argument("--workbook")
    a = ap.parse_args()
    with open(a.data) as f:
        new = json.load(f)
    prev = None
    if a.previous and os.path.exists(a.previous):
        with open(a.previous) as f:
            prev = json.load(f)
    bad = problems(new, prev, a.workbook)
    if bad:
        print("SANITY CHECK FAILED -- data.json will NOT be committed:", file=sys.stderr)
        for b in bad:
            print("  - " + b, file=sys.stderr)
        sys.exit(1)
    changed = prev is None or strip_stamp(new) != strip_stamp(prev)
    for label, get in DATASETS.items():
        print(f"{label}: {len(get(new))} rows")
    print("changed:", changed)
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main()
