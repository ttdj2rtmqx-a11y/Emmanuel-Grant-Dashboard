# Emmanuel Grant Dashboard

A local dashboard for the Emmanuel Grant Agent. It tracks grant opportunities, daily priorities, deadlines, application value, and next actions.

The dashboard can also download an application draft for each grant. The draft is matched to the grant agency/program, autocompleted from `data/emmanuel-profile.json`, and marks unknown public details with `[VERIFY ...]` so they can be reviewed before submission.

## Run

```bash
npm start
```

Open `http://localhost:4173`.

## Daily Updates

The dashboard updates in three ways:

- The server refreshes `data/grants.json` when it starts.
- The server refreshes again when the dashboard is loaded on a new local date.
- `.github/workflows/daily-update.yml` can refresh and commit the data once per day when this folder is pushed to GitHub.

Manual refresh:

```bash
npm run update
```

Dry run:

```bash
npm run update:dry-run
```

## External Grant Feed

By default, the dashboard uses `data/grants.json`. To import from a JSON feed, set `GRANT_FEED_URL` before running the update script or server:

```bash
GRANT_FEED_URL="https://example.com/grants.json" npm run update
```

The importer accepts an array or an object with `opportunities`, `grants`, `items`, `data`, or `results`. Supported fields include `title`, `agency`, `deadline`, `amount`, `url`, `summary`, `tags`, and common snake_case variants.

## Checks

```bash
npm run check
```

## Application Drafts

Open any grant in the dashboard and choose **Download AI draft**. The public GitHub Pages dashboard generates the file in the browser. The local server also exposes:

```bash
/api/applications/:opportunityId/download
```

Update `data/emmanuel-profile.json` with verified public information about Emmanuel to improve autocomplete coverage.
