# One Account Timeline

[![Sync Confluence status](https://github.com/dcbrigham/one-account-timeline/actions/workflows/sync-confluence-status.yml/badge.svg)](https://github.com/dcbrigham/one-account-timeline/actions/workflows/sync-confluence-status.yml)

Interactive Gantt-style visualisation of the One Account migration programme at Doctolib. Renders every campaign (push, email, in-app banner, Promocard, Connect broadcast, plus program-wide moments) across phases, movements, channels, and markets — with live content status pulled from Confluence Page Properties.

**Live:** [dcbrigham.github.io/one-account-timeline](https://dcbrigham.github.io/one-account-timeline/)

The timeline is also embedded as an iframe inside the "One Account: Launch Assets" Confluence page, which is the canonical hub for the programme.

---

## How it works

```
Confluence leaf pages (status in Page Properties)
        │
        ▼
GitHub Actions workflow (cron daily 05:00 UTC + manual trigger)
        │
        ▼
scripts/sync.js
        │ • Fetches all descendants of the Launch Assets parent
        │ • Extracts per-language status rows from each Page Properties macro
        │ • Computes weakest-link rollups
        ▼
status.json (committed to repo)
        │
        ▼
GitHub Pages redeploys → index.html fetches status.json on load
```

The timeline UI is a single self-contained HTML file. No build step, no framework, no external runtime dependencies beyond the GitHub Pages CDN.

---

## Repository layout

```
.
├── index.html                                # The timeline UI. All JS/CSS inline.
├── status.json                               # Generated daily by the workflow.
├── package.json                              # Just declares Node 20+ + type:module.
├── scripts/
│   └── sync.js                               # Confluence → status.json sync.
└── .github/
    └── workflows/
        └── sync-confluence-status.yml        # Daily cron + workflow_dispatch.
```

---

## Configuration

The workflow needs two repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ATLASSIAN_EMAIL` | Email of the Atlassian user whose token is used |
| `ATLASSIAN_API_TOKEN` | Token from [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

Optional environment overrides for `sync.js`:

| Variable | Default | Purpose |
|---|---|---|
| `CONFLUENCE_PARENT_ID` | `3970269743` | Parent page ID to scan for leaves |
| `CONFLUENCE_BASE` | `https://doctolib.atlassian.net` | Confluence site URL |

If the token holder leaves the org or rotates the token, the workflow will start failing — regenerate at the link above and overwrite the secret.

---

## Conventions sync.js relies on

- Every leaf page must be named `OneAccount-<something>` and live under `CONFLUENCE_PARENT_ID`.
- Every leaf must contain a Page Properties macro with id `campaign-status`.
- Inside that macro, each row is `[label cell] | [status cell]`. The status cell holds a Confluence status lozenge whose `text` attribute is one of:
  - `Not started`
  - `In progress`
  - `Ready`
  - `Live`
  - `Cancelled`
- Anything else gets dropped from the rollup. The leaf still appears on the timeline, but as "Not started".

Folder pages (anything that isn't a leaf) are ignored by `sync.js`.

---

## Refresh

**Automatic.** Daily at 05:00 UTC (~07:00 Paris in winter, ~06:00 in summer).

**Manual.** Either:
- Click `↻ Refresh now` inside the timeline header → opens this repo's Actions tab → click "Run workflow"
- Or: Actions tab → Sync Confluence status → Run workflow

Either way, the workflow takes ~30 seconds. Reload the timeline (`⟳ Reload page` button) once it finishes.

To change the cadence, edit the `cron:` line in `.github/workflows/sync-confluence-status.yml`.

---

## Local development

```bash
# Run the sync locally (writes status.json to the working directory)
export ATLASSIAN_EMAIL="you@doctolib.com"
export ATLASSIAN_API_TOKEN="your-token-here"
node scripts/sync.js

# Serve the timeline locally
python3 -m http.server 8000
# then visit http://localhost:8000
```

Open `index.html` directly via `file://` works for HTML/CSS preview, but `fetch('status.json')` is often blocked by browsers under `file://` — use a local server if you want the full experience.

---

## Extending the timeline

### Add a new channel

1. Create folder pages + leaves in Confluence following the naming convention (e.g. `OneAccount-B-M1-SMS-NL`).
2. Edit `index.html`:
   - Add an entry to the `channels` array
   - Add a chip to the channels legend row
   - Add the channel name to the `channelName` map in `pageKeyFor()`
   - Add events to `discreteEvents` or `continuousBars` depending on cadence type

### Add a new market

1. Create leaf pages for the new market under every applicable channel folder in Confluence.
2. Edit `index.html`:
   - Add an entry to the `markets` array
   - Add a chip to the markets legend row
   - Update `normalizeMarket()` if the market needs to merge with another (the way GB/IE merge into UK)

### Add a new status value

Three coordinated edits:
1. `scripts/sync.js` — add to `STATUS_RANK` with a rank between existing values
2. `index.html` CSS — add `.event-marker.status-<slug>` and `.event-bar.status-<slug>` rules
3. `index.html` legend — add a status chip with `data-status="<slug>"`

---

## Known caveats

- **Public repo.** Free GitHub Pages requires public visibility. The HTML is `noindex`'d for search engines, but anyone with the URL can view it. The page contains no customer data — just campaign IDs, dates, and rollup statuses.
- **Personal account.** Repo lives under a personal GitHub account. If/when Pages permission is enabled on the Doctolib org, the repo can be transferred and the Confluence iframe URL updated.
- **Node 20 deprecation.** GitHub Actions emits a warning that `actions/checkout@v4` and `actions/setup-node@v4` use Node.js 20, which is being phased out by GitHub in late 2026. Cosmetic; the workflow still runs. Bump the actions versions when GitHub releases v5 of each.
- **Two-click refresh.** The in-timeline "Refresh now" button opens GitHub Actions in a new tab where you click "Run workflow". A one-click in-timeline refresh would require a small serverless function to hold a GitHub token — deliberately omitted to avoid extra infrastructure.

---

## License

Internal tool. Not affiliated with or endorsed by GitHub. Not for redistribution.
