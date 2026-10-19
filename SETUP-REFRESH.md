# Refresh data button: setup checklist (for John Picou / Israel Esparza)

**Status (Oct 19, 2026): PUBLISHED BUT INERT.** Approval: John Picou, channel not stated, 2026-10-19, as reported by Samantha Lujan; publish authorized by Samantha Lujan 2026-10-19. The code is in the repo and on Vercel, but none of the credentials below exist yet, so:

- `/api/status` answers `200 {configured:false}` and the **Refresh button stays hidden**; the dashboard looks and works exactly as before.
- `/api/refresh` answers `503 {configured:false}` and never contacts GitHub.
- The workflow has **no daily schedule** (commented out). A manual run stops at its first step with "Refresh is not set up yet" and never contacts SharePoint or commits anything.

Every value below is a placeholder; no real secret is stored anywhere in the repo.

## How it works

1. A staff member presses **Refresh** (next to Export PDF). One click starts the refresh; there is nothing to type.
2. The browser calls `/api/refresh`, a small Vercel serverless function. The GitHub token is stored only in Vercel's environment variables and is never sent to the browser.
3. The function checks that the request came from the dashboard itself (same origin), applies a short cooldown, asks GitHub whether a refresh is already queued or running, and only then starts the GitHub Actions workflow `refresh-data.yml`.
4. The workflow signs in to Microsoft Graph as a **read-only** app, downloads `Master.xlsx`, runs `build_data.py` and then a sanity check. It commits `data.json` to `main` only if the data actually changed.
5. Vercel redeploys, which takes about 1 to 2 minutes. The page polls `/api/status` and loads the new data in place.

## Decisions for John

- Approve the Entra app (section a) and choose a credential: client secret or **certificate (preferred)**.
- Approve a fine-grained GitHub token, or a GitHub App, for the Vercel function.
- Decide whether to turn on the daily 14:00 UTC schedule. It is **off** for now (commented out in `refresh-data.yml`); section f explains how to turn it on.
- Decide on site protection (section d). This matters because the repo and the site are both public.
- Accept the open Refresh button (next section).

### Decision for John: the Refresh button has no passcode

At Samantha's request the button has **no passcode**. That means **anyone who can open the dashboard can start a refresh**.

- **Worst case:** extra workflow runs. They are limited by a 60-second cooldown, a per-IP limit, a check with GitHub that refuses to start a new run while one is queued or running, and the workflow's `concurrency` group. Repeated clicks cannot stack runs.
- **What a caller cannot do:** change any data. The caller cannot choose what is downloaded, which branch is used, or what is committed. The Microsoft app is **read-only** and can see one SharePoint site only. The workflow commits `data.json` only if the data changed and passed the sanity check.
- **Recommendation:** put the site behind **Vercel Deployment Protection** or **Microsoft sign-in** (section d). This protects the button too. The bigger reason is that the repo and the site are public and `data.json` already includes client-survey comments and staff names. That concern existed before this feature.

---

## (a) Microsoft Entra app registration (read-only, one site only)

1. **Entra admin center → App registrations → New registration**
   - Name: `DSE Dashboard Refresh (read-only)`
   - Supported account types: **Accounts in this organizational directory only (single tenant)**
   - Redirect URI: **leave empty**
2. Write down the **Application (client) ID** and the **Directory (tenant) ID**.
3. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Sites.Selected`** → **Grant admin consent for Visit Anaheim**.
   Do NOT add `Sites.Read.All` or `Files.Read.All`. Those would let the app read every site.
   (An even narrower option for John to consider is `Lists.SelectedOperations.Selected`, which limits the app to a single library.)
4. **Certificates & secrets**:
   - Preferred: upload a certificate (public key) and keep the private key PEM for GitHub.
   - Alternative: create a client secret that expires in 6 to 12 months.
5. Give the app **read** access to the BusinessIntelligence-Apps site only. Use an admin account that has `Sites.FullControl.All`, for example in Graph Explorer.
   - Get the site id:
     ```
     GET https://graph.microsoft.com/v1.0/sites/visitanaheimorg.sharepoint.com:/sites/BusinessIntelligence-Apps?$select=id,displayName
     ```
   - Grant read:
     ```
     POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
     Content-Type: application/json

     {
       "roles": ["read"],
       "grantedToIdentities": [
         { "application": { "id": "<APPLICATION-CLIENT-ID>", "displayName": "DSE Dashboard Refresh (read-only)" } }
       ]
     }
     ```
   - Check it: `GET https://graph.microsoft.com/v1.0/sites/{site-id}/permissions`. You should see one entry with `roles: ["read"]`.
   - PowerShell alternative (PnP): `Grant-PnPAzureADAppSitePermission -AppId <client-id> -DisplayName "DSE Dashboard Refresh (read-only)" -Site https://visitanaheimorg.sharepoint.com/sites/BusinessIntelligence-Apps -Permissions Read`

The script downloads the file using the id `{5190F585-22F9-43F3-8539-0303AD6DA8CB}`. That id is the SharePoint UniqueId. If Graph does not accept it directly, the script looks the file up by its path and checks that the UniqueId matches. It refuses to continue if Master.xlsx was replaced by a different file.

## (b) GitHub repo `bi-visitanaheim/dse-dashboard`: secrets and variables

Go to **Settings → Secrets and variables → Actions**.

| Kind | Name | Value |
|---|---|---|
| Secret | `MS_TENANT_ID` | Directory (tenant) ID |
| Secret | `MS_CLIENT_ID` | Application (client) ID |
| Secret | `MS_CLIENT_CERT_PEM` + `MS_CLIENT_CERT_THUMBPRINT` | **preferred**: certificate private key (PEM) and its thumbprint |
| Secret | `MS_CLIENT_SECRET` | only if you are not using a certificate |
| Variable | `SP_HOSTNAME` | `visitanaheimorg.sharepoint.com` |
| Variable | `SP_SITE_PATH` | `/sites/BusinessIntelligence-Apps` |
| Variable | `SP_FILE_PATH` | `DS&E/Destination Services and Events Dashboard KPIs/Master.xlsx` |
| Variable | `SP_ITEM_ID` | `{5190F585-22F9-43F3-8539-0303AD6DA8CB}` |
| Variable | `REFRESH_SCHEDULE_ENABLED` | `true` (set it to `false` to pause the daily run) |

If the variables are not set, the workflow falls back to the values shown above.

Also check two settings:
- **Settings → Actions → General → Workflow permissions** must allow the workflow to write. The workflow file itself asks only for `contents: write`.
- If `main` has branch protection that blocks pushes from `github-actions[bot]`, either allow the bot or change the workflow to open a pull request instead.

## (c) Vercel project: environment variables (Production)

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | Fine-grained personal access token. Resource owner: `bi-visitanaheim`. Repository access: **only `dse-dashboard`**. Permissions: **Actions: Read and write** and **Contents: Read-only**; Metadata: Read is added automatically. Expiry: 90 days. A GitHub App is a stronger alternative. |
| `GITHUB_REPO` | `bi-visitanaheim/dse-dashboard` |
| `GITHUB_WORKFLOW_FILE` | `refresh-data.yml` |
| `GITHUB_REF` | `main` |

These four are the only Vercel env vars the feature uses. A custom domain needs no extra setting, because the function accepts requests from whatever host is serving the dashboard.

After adding them, **redeploy**, because environment variables only take effect on a new deployment.

If any of these is missing, `/api/status` answers `200 {configured:false, enabled:false}`, `/api/refresh` answers `503 {configured:false}`, and the button stays hidden. Nothing breaks. (This is the state as published on Oct 19, 2026.)

`vercel.json` does not need any change, and no `package.json` is needed: the functions are CommonJS and use Node's built-in `fetch`.

## (d) Strongly recommended: protect the site

The GitHub repo and the Vercel site are both **public**. `data.json` contains client-survey comments and staff names. This is already true today and does not depend on this feature. Options for John:

- **Vercel Deployment Protection**: either *Vercel Authentication* (only team members) or *Password Protection*. This protects `/api/*` as well.
- Put the site behind **Microsoft sign-in**, for example an Entra-protected custom domain or a proxy.
- Make the GitHub repo **private**. The workflow and Vercel keep working.
- Optional: add a Vercel Firewall rate-limit rule on `/api/refresh`. The function's own limits (one new refresh per 60 seconds, 10 requests per IP per 10 minutes) are best-effort only, because each serverless instance keeps its own count. The check with GitHub for a queued or running refresh, and the workflow's `concurrency` group, apply everywhere.

## (e) Testing the first run

1. The files are already in the repo (published Oct 19, 2026). Add the secrets and variables from section b. Do **not** add the Vercel env vars yet.
2. Go to **GitHub → Actions → "Refresh data" → Run workflow** (branch `main`). The log should show, in order:
   - `Signed in to Microsoft Graph`
   - `Site: Business Intelligence-Apps`
   - `File: Master.xlsx`
   - the row counts for each dataset
   - `changed: true` or `changed: false`
3. If the run says `changed: true`, check that one bot commit changed only `data.json` and that Vercel redeployed. Vercel deploys bot pushes; confirm this on this first run.
4. Add the Vercel env vars from section c and redeploy. Open the site: the **Refresh** button should appear next to Export PDF, with "Last refreshed ..." beside it.
5. Press **Refresh** once. You should see "Refreshing...", then either "Updated <time>" or "No newer data in Master.xlsx". The button stays disabled while the refresh runs.
6. Open the dashboard in a second tab and press **Refresh** there while the first one runs. You should see "already running" (or "please wait a minute" if the request reached the same server instance within 60 seconds). GitHub Actions should show only one run.

## (f) Rotating secrets and turning off the schedule

- **Entra credential**: add the new secret or certificate in Entra, update the GitHub secret, run the workflow once, then delete the old credential.
- **GitHub token**: create the new token, update `GITHUB_TOKEN` in Vercel, redeploy, then revoke the old token.
- **Turn on the daily schedule** (off as published): after the first manual run succeeds, edit `.github/workflows/refresh-data.yml` and un-comment the two lines
  ```
  # schedule:
  #   - cron: "0 14 * * *"
  ```
  so they read `  schedule:` / `    - cron: "0 14 * * *"` (two-space indent under `on:`). 14:00 UTC is 7:00 AM PDT / 6:00 AM PST.
- **Pause the daily schedule** later: set the repo variable `REFRESH_SCHEDULE_ENABLED` to `false`, or comment the two lines out again.
- **Turn off the whole feature quickly**: delete `GITHUB_TOKEN` (or `GITHUB_WORKFLOW_FILE`) from Vercel and redeploy. The button hides itself. Revoke the token in GitHub too if you are not putting it back.

## (g) Rollback

1. In GitHub, delete `.github/workflows/refresh-data.yml`, `api/refresh.js`, `api/status.js`, `scripts/fetch_master.py`, `scripts/check_data.py` and `refresh.js`.
2. Re-upload the previous production `index.html`, `app.js` and `style.css` from the `dse-dashboard` folder. The dashboard works without them changed: if `refresh.js` is missing, the button simply stays hidden.
3. Remove the Vercel env vars and revoke the GitHub token.
4. Remove the app's site permission (`DELETE https://graph.microsoft.com/v1.0/sites/{site-id}/permissions/{permission-id}`) or delete the Entra app.
5. To undo a bad data refresh, revert the bot commit on GitHub (*Revert*), or upload the previous `data.json`.
