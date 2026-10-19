"""Download Master.xlsx from SharePoint with Microsoft Graph (read-only).

Published Oct 19, 2026 (approved by John Picou). Inert until the secrets in SETUP-REFRESH.md exist.
Used by .github/workflows/refresh-data.yml. Never modifies SharePoint and never
prints a secret or an access token.

Auth: app-only (client credentials) via MSAL, scope https://graph.microsoft.com/.default.
The Entra app should have ONLY the Graph application permission Sites.Selected,
with "read" granted on the BusinessIntelligence-Apps site (see SETUP.md).

Environment variables
  MS_TENANT_ID                 Entra tenant (directory) id            [secret]
  MS_CLIENT_ID                 app (client) id                        [secret]
  MS_CLIENT_SECRET             client secret                          [secret]
    -- or, preferred --
  MS_CLIENT_CERT_PEM           PEM private key of the app certificate [secret]
  MS_CLIENT_CERT_THUMBPRINT    SHA-1 thumbprint shown in Entra        [secret]
  SP_HOSTNAME                  visitanaheimorg.sharepoint.com
  SP_SITE_PATH                 /sites/BusinessIntelligence-Apps
  SP_ITEM_ID                   {5190F585-22F9-43F3-8539-0303AD6DA8CB} (SharePoint
                               file UniqueId) or a Graph driveItem id
  SP_FILE_PATH                 DS&E/Destination Services and Events Dashboard KPIs/Master.xlsx
                               (path inside "Shared Documents"; fallback lookup)

Usage:  python scripts/fetch_master.py --out /tmp/Master.xlsx
"""
import argparse
import os
import re
import sys
from urllib.parse import quote

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPE = ["https://graph.microsoft.com/.default"]
GUID = re.compile(r"^\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?$")
TIMEOUT = 60


class FetchError(Exception):
    pass


def env(name, required=True, default=None):
    val = os.environ.get(name, "").strip() or default
    if required and not val:
        raise FetchError(f"Missing environment variable {name} (set it as a GitHub secret/variable; see SETUP.md).")
    return val


def get_token():
    import msal  # imported here so --help works without msal installed

    tenant, client = env("MS_TENANT_ID"), env("MS_CLIENT_ID")
    secret = env("MS_CLIENT_SECRET", required=False)
    cert_pem = env("MS_CLIENT_CERT_PEM", required=False)
    thumb = env("MS_CLIENT_CERT_THUMBPRINT", required=False)
    if cert_pem and thumb:
        credential = {"private_key": cert_pem, "thumbprint": thumb}
        kind = "certificate"
    elif secret:
        credential = secret
        kind = "client secret"
    else:
        raise FetchError("No app credential: set MS_CLIENT_CERT_PEM + MS_CLIENT_CERT_THUMBPRINT (preferred) "
                         "or MS_CLIENT_SECRET.")
    app = msal.ConfidentialClientApplication(
        client, authority=f"https://login.microsoftonline.com/{tenant}", client_credential=credential)
    result = app.acquire_token_for_client(scopes=SCOPE)
    if "access_token" not in result:
        # error / error_description never contain the secret; still trim to one line.
        desc = str(result.get("error_description", "")).splitlines()[0][:300]
        raise FetchError(f"Sign-in to Microsoft Graph failed using the {kind} "
                         f"({result.get('error', 'unknown_error')}): {desc}")
    print(f"Signed in to Microsoft Graph (app-only, {kind}).")
    return result["access_token"]


def graph_get(session, url, what, stream=False):
    r = session.get(url, timeout=TIMEOUT, stream=stream)
    if r.status_code == 200:
        return r
    hint = {
        401: "the token was rejected (check tenant/client id and credential).",
        403: "access denied -- has the app been granted 'read' on this site (Sites.Selected)? See SETUP.md.",
        404: "not found -- check the site path / file id / file path.",
        429: "Graph is throttling requests; try again in a few minutes.",
    }.get(r.status_code, "unexpected response.")
    code = ""
    try:
        code = r.json().get("error", {}).get("code", "")
    except ValueError:
        pass
    raise FetchError(f"Could not get {what}: HTTP {r.status_code} {code} -- {hint}")


def resolve_site_id(session, hostname, site_path):
    site_path = "/" + site_path.strip("/")
    r = graph_get(session, f"{GRAPH}/sites/{hostname}:{quote(site_path)}?$select=id,displayName",
                  f"site {hostname}{site_path}")
    site = r.json()
    print(f"Site: {site.get('displayName')} ({hostname}{site_path})")
    return site["id"]


def resolve_item(session, site_id, item_id, file_path):
    """Return a Graph driveItem id for Master.xlsx.

    The id in the SharePoint web link ({5190F585-...}) is the file's SharePoint
    UniqueId, which is not always accepted as a Graph driveItem id. Try it
    directly; if Graph says 404, look the file up by path in the site's default
    library (Shared Documents) and confirm its UniqueId matches.
    """
    m = GUID.match(item_id or "")
    unique = m.group(1).lower() if m else None
    sel = "?$select=id,name,size,lastModifiedDateTime,sharepointIds"
    if item_id and not unique:  # already a Graph driveItem id
        return graph_get(session, f"{GRAPH}/sites/{site_id}/drive/items/{quote(item_id)}{sel}", "Master.xlsx").json()
    if unique:
        r = session.get(f"{GRAPH}/sites/{site_id}/drive/items/{unique}{sel}", timeout=TIMEOUT)
        if r.status_code == 200:
            return r.json()
        if r.status_code not in (400, 404):
            graph_get(session, f"{GRAPH}/sites/{site_id}/drive/items/{unique}{sel}", "Master.xlsx")
    if not file_path:
        raise FetchError("File id lookup failed and SP_FILE_PATH is not set.")
    path = quote("/" + file_path.strip("/"))
    item = graph_get(session, f"{GRAPH}/sites/{site_id}/drive/root:{path}:{sel}", f"file {file_path}").json()
    found = str((item.get("sharepointIds") or {}).get("listItemUniqueId", "")).lower()
    if unique and found and found != unique:
        raise FetchError(f"The file at SP_FILE_PATH is not the expected Master.xlsx (UniqueId {found} != {unique}). "
                         "Was it replaced or moved? Update SP_ITEM_ID / SP_FILE_PATH.")
    return item


def main():
    ap = argparse.ArgumentParser(description="Download Master.xlsx from SharePoint (read-only).")
    ap.add_argument("--out", required=True, help="where to save the workbook (e.g. $RUNNER_TEMP/Master.xlsx)")
    args = ap.parse_args()
    import requests

    try:
        token = get_token()
        with requests.Session() as s:
            s.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})
            site_id = resolve_site_id(s, env("SP_HOSTNAME"), env("SP_SITE_PATH"))
            item = resolve_item(s, site_id, env("SP_ITEM_ID", required=False), env("SP_FILE_PATH", required=False))
            print(f"File: {item.get('name')} ({item.get('size')} bytes, last modified {item.get('lastModifiedDateTime')})")
            # /content answers with a 302 to a short-lived download URL; requests drops the
            # Authorization header when it follows a redirect to another host.
            r = graph_get(s, f"{GRAPH}/sites/{site_id}/drive/items/{item['id']}/content", "the file content", stream=True)
            tmp = args.out + ".part"
            with open(tmp, "wb") as f:
                f.writelines(r.iter_content(1 << 16))
        with open(tmp, "rb") as f:
            if f.read(2) != b"PK":
                raise FetchError("Downloaded file is not an .xlsx workbook (no ZIP header).")
        size = os.path.getsize(tmp)
        if size < 10_000:
            raise FetchError(f"Downloaded workbook is suspiciously small ({size} bytes).")
        os.replace(tmp, args.out)
        print(f"Saved {size} bytes -> {args.out}")
    except FetchError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as e:
        print(f"ERROR: network problem talking to Microsoft Graph ({type(e).__name__}).", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
