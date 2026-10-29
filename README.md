# Adsphire Click Reconciliation — Render edition

Complete standalone source for daily Affise advertiser/offer clicks versus AppsFlyer clicks for your selected PIDs and agency PRTs.

## Deploy on Render (recommended: Blueprint)

1. Unzip this folder and upload its **contents** to a private GitHub repository. `package.json`, `server.js`, and `render.yaml` must be at the repository root.
2. In Render choose **New → Blueprint**, then connect that repository.
3. Render reads `render.yaml`. It creates a **Starter Node web service** and a **1 GB persistent disk mounted at `/var/data`**. Review the paid service/disk before deploying.
4. Set `DASHBOARD_PASSWORD` to your own strong private password (at least 12 characters). Render generates `SESSION_SECRET` and `ENCRYPTION_SECRET` automatically.
5. Deploy and open your service URL. Sign in with `DASHBOARD_PASSWORD`.
6. Open **Connections**, enter your Affise API domain/key and each AppsFlyer agency PRT + V2 API token, then click **Save connections & tokens** once.
7. Add app mappings, select agencies/PIDs and correct app timezone, then fetch your dates.

### Manual Web Service setup

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Node version | 24 (`NODE_VERSION=24`) |
| Build command | `npm ci && npm run check` |
| Start command | `npm start` |
| Health check | `/healthz` |
| Instance | Paid instance supporting a persistent disk |
| Disk mount | `/var/data` |
| Disk size | 1 GB initially |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |
| `DASHBOARD_PASSWORD` | Your private password, 12+ characters |
| `SESSION_SECRET` | A unique random secret, 32+ characters |
| `ENCRYPTION_SECRET` | A different unique random secret, 32+ characters |

Use `npm run generate-secrets` locally to generate the two secret values for manual setup. Store them directly in Render environment variables, not GitHub. Keep `ENCRYPTION_SECRET` unchanged across redeploys, or existing saved API tokens cannot be decrypted. API tokens themselves are entered and saved through the dashboard.

Render's free web services do **not** support persistent disks. A free service without a persistent disk will lose saved files across restarts/redeploys. This edition deliberately uses a disk rather than an external database. Keep it as **one service instance / one Node process**; mutations are serialized for safe report updates.

For a custom domain, set `PUBLIC_URL=https://your-domain.example`. Otherwise the service uses Render's automatically supplied `RENDER_EXTERNAL_URL`. Origins must match so credential-save requests pass CSRF checks.

## Local run

Requires Node 22+ (Node 24 recommended). No third-party runtime dependencies.

```bash
npm ci
cp .env.example .env
npm run generate-secrets
```

Edit `.env`: replace the password and both placeholder secret values. Then run:

```bash
node --env-file=.env server.js
```

Open `http://localhost:3000`. `npm start` uses environment variables already supplied by your shell or Render; it does not automatically load `.env`.

## What is included

- Daily Affise raw clicks, filtered by advertiser and optional offer IDs.
- Agency V2 AppsFlyer aggregate Pull API, filtered to configured app, owned PIDs and agency scope.
- Multiple agency tokens and per-agency breakdowns.
- Saved API credentials encrypted with AES-256-GCM; plaintext tokens are never sent back to the browser.
- Password login, signed HttpOnly sessions, origin checks, and login-attempt limiting.
- Persistent mappings, daily reports, encrypted credentials, and AF cache/cooldown.
- Daily click difference, gap percentage, trends, CSV import/export and AF response diagnostics.
- Numeric Clicks values still appear if other rows contain blank/N/A clicks. Incomplete subtotals are labelled and excluded from gap percentages.
- JSON settings/history backup and restore.

This package retains the latest hosted dashboard's AF fetch/parsing logic. Hosting it on Render does not change AppsFlyer's API permissions, reporting scope, or external report quotas. No unattended fetch schedule is enabled.

## Move existing mappings/history from the ChatGPT-hosted version

API credentials are **not bundled in this source ZIP**. Re-enter them once after moving to Render.

To copy mappings and report history from your original publicly readable Site, run locally:

```bash
node scripts/migrate-from-sites.mjs --from=2026-10-01 --to=2026-10-29
```

The script reads the original Site's settings and **already-saved reports**; it does not call AppsFlyer or Affise. The default source is your existing Adsphire Click Reconciliation URL. Use `--site=https://your-site.chatgpt.site` for another compatible Site. It writes `backups/sites-migration.json` and excludes API tokens. If the source requires authentication, the script stops without bypassing login.

On Render, open **Connections → Settings & history backup**, choose that JSON and click **Import backup**. Import replaces settings and merges report history by date + mapping ID. Re-enter the API tokens and save them. Report date windows are fetched from the source in chunks of up to 31 days.

For future moves, use **Download backup** in the Render dashboard. JSON backups exclude credentials. A full private filesystem backup of `/var/data` includes encrypted credentials and requires the same `ENCRYPTION_SECRET` to restore.

## Files

| File | Purpose |
| --- | --- |
| `server.js` | Render HTTP server, password login, disk storage, backups |
| `src/dashboard.html` | Complete dashboard HTML, CSS and client-side JavaScript |
| `src/app.js` | Affise/AppsFlyer adapters, mapping validation, reports, encryption, cache |
| `render.yaml` | Render Blueprint and persistent disk configuration |
| `.env.example` | Environment-variable names and local-run example |
| `scripts/migrate-from-sites.mjs` | Optional settings/history transfer from the original Site |
| `scripts/generate-secrets.mjs` | Generates secrets for manual configuration |
| `scripts/check-*.mjs` | API, parsing, credential, caching and redirect regression checks |
| `scripts/server.test.mjs` | Standalone server login/persistence/backup checks |

## Validation

```bash
npm run check
npm test
```

Tests use mocked upstream responses and temporary local storage. They cover PID/agency filtering, N/A rows and numeric subtotals, repeat-request caching, safe redirects, credential encryption, login, spoofed-header rejection, restart persistence and backups. A live Render deployment is not included in this ZIP.

## API and data notes

- An AppsFlyer app ID is an Android package name or `id` + numeric iOS App Store ID. An iOS bundle identifier alone is not the AppsFlyer app ID.
- If an Affise advertiser has more than one app, use distinct offer IDs for each mapping.
- Keep UA/RT, dates and timezones consistent when checking numbers against AppsFlyer.
- AF uses `partners_by_date_report/v5`, grouped by date/media source/campaign. Only your selected PID values are summed; unrelated PIDs are excluded.
- Requests for an identical recent report reuse cached results for 65 seconds for 1–2 day ranges, or 1 hour for longer ranges. A 65-second per-app/report cooldown applies across changed ranges. Recent errors are also cached for 65 seconds.
- Saved values keep their actual fetch timestamp. Only complete, successful rows participate in gap calculations.
- “Limit reached for partners-daily-report” is retained from the upstream AF response. Caching reduces unnecessary calls; it cannot reset an already exhausted AF quota.

Official references:

- https://render.com/docs/web-services
- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec
- https://support.appsflyer.com/hc/en-us/articles/207034346-Pull-API-aggregate-data
- https://dev.appsflyer.com/hc/reference/get_app-id-partners-by-date-report-v5-1
- https://help-center.affise.com/en/articles/6796615-api-for-statistics-admins

## Bulk CSV mapping upload

App mappings → Bulk upload mappings → Download CSV template. Fill one mapping per row, select the CSV, click Preview CSV, then Import mappings. Import appends new mappings and leaves existing settings, saved tokens and history intact. Any invalid row blocks the entire import; correct it and preview again.

Columns: `name,advertiser_id,app_id,pids,offer_ids,mode,timezone,agency_prts`.
Use semicolons between list values (`pid_a;pid_b` or `agency_a;agency_b`). Standard quoted comma-separated fields are also supported. `offer_ids` is optional; blank `mode` defaults to `ua`, blank `timezone` to `UTC`. Agency PRTs must already exist in Connections. Maximum 100 mappings total and 1 MB per upload. Overlapping app/PID/mode/timezone scopes or Affise offer scopes are rejected. This imports mapping configuration; no report fetch is triggered.

### Updating an existing Render service
Replace the repository code with this ZIP's contents, commit and push, then deploy the latest commit. Keep existing environment variables, encryption secret and persistent disk unchanged. No data migration is needed. The new bulk upload panel appears under App mappings.
