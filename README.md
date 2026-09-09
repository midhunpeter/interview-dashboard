# Interview Prep Dashboard

## Run the dashboard

From the project directory, start the app with:

```bash
npm install
npm run dev
```

Keep that Terminal window open while using the dashboard. On this Mac, open:

<http://192.168.1.156:5173/>

Because the LAN address can change, you can always open the current address from a second Terminal window with:

```bash
open -a Safari "http://$(ipconfig getifaddr en0):5173/"
```

Alternatively, double-click **Start Interview Dashboard.command** to run the same server startup command.

Do not open `index.html` directly: modern browsers block Vite/React modules from loading through a `file://` address.

For a production check:

```bash
npm run build
```

Dashboard content is stored in `data/interview-prep.db`. The SQLite database and its tables are created automatically on first run.

## Docker

```bash
docker compose up
```

The Compose service mounts `./data` into the container, so dashboard content survives rebuilds and restarts.

## API

The REST API is available below `/api` on the same host and port as the dashboard. Opportunities are managed at `/api/workspaces`, with interview rounds nested at `/api/workspaces/:workspaceId/rounds`. Drill trees can be general preparation or associated with a round through `round_id`. Story and question banks, Case Frameworks, reliability incidents, translation-map rows, and knowledge items expose `roundIds` and accept `?round_id=` filtering; untagged items remain general preparation. The combined `/api/prep-items?workspace_id=...` feed returns stories and workspace-scoped Case Frameworks, with optional round and type filters. The API also includes Scheduling Machine notes and cross-table search at `/api/search?q=...`.

## Complete backups and recovery

In **Settings → Local Data & Backup**, Export saves a backend snapshot of **all workspaces**, regardless of the current opportunity or round filter. Pending edits are saved first. The versioned JSON envelope uses `format: "interview-dashboard-complete"`, `version: 1`, `exportedAt`, `tables`, and `sequences`. It includes every application table: settings, workspaces, sections, rounds, all content types, drill follow-ups, application metadata, round tags, preserved legacy answers, and images with their original bytes encoded as base64. Row IDs, timestamps, relationships and SQLite identifier sequences are retained. Synchronization revisions are internal; a restore always creates a fresh dataset generation.

Import validates the whole file before any replacement. Its confirmation lists counts across the entire backup: **it replaces every workspace, not just the visible view**. Validation checks table/field types, identifiers, uniqueness, migration markers, JSON arrays, references, image encoding/signatures and size. The import limit is 256 MB of JSON, with up to 12 MB decoded per image; requests over the limit are rejected explicitly. Only the backup endpoints use this larger body limit. Base64 adds about one third to image sizes; very large datasets may need an offline SQLite backup instead.

Before restore or reset, the server uses SQLite's online backup API (including committed WAL data) and verifies the resulting database. Recovery files are retained in `data/recovery/`, or beside a custom `DATABASE_PATH`. The successful operation shows the recovery file path. If the recovery backup fails, replacement does not start. Replacement is a single SQLite transaction, including metadata, relationships, images and identifier sequences; any failure rolls everything back. The browser reloads canonical server state only after commit, clearing identity, revision, filter and autosave caches. Other tabs' pre-restore writes are rejected even if record IDs happen to match again.

Old exports containing `schemaVersion`, `items` and `drillTrees` are **browser-state exports, not complete backups**. They can omit other workspaces, rounds, filtered-out records and image bytes. Automatic import rejects them with an explanation. Keep those files for manual extraction/recovery rather than converting them into a supposedly complete backup.

Recovery databases are not automatically deleted. Store copies somewhere safe; JSON and SQLite backups are unencrypted and contain your preparation text and images. For offline recovery from a `.db` file, stop **all** dashboard processes first, preserve the current database and its `-wal`/`-shm` files together, and start the app using a copy of the verified recovery database via `DATABASE_PATH`. Never overwrite an active SQLite database or copy only its main file while it is running.

```bash
DATABASE_PATH=/absolute/path/to/recovery-copy.db npm run dev
```

`GET /api/backup`, `POST /api/backup/preview`, and `POST /api/backup/restore` serve this workflow. Restore and `POST /api/reset` require `X-Confirm-Replacement: replace-all-workspaces` and the current `X-Dataset-Generation`. `RECOVERY_DIRECTORY` can override the recovery directory. Reset uses the same recovery/transaction safeguards and creates one empty opportunity with no preparation sections.

## Legacy Case Framework answers

Startup migration `case-legacy-preservation-v1` archives the original Understand / Define / Solve / Prove answers before removing the old columns. It reads both database columns and application metadata, retains their text verbatim, and labels each source separately (including disagreeing values). Seven-stage answers are not remapped or overwritten. A verified recovery database is created before legacy content is changed; archive writes, column changes and the completion marker commit together. Repeated startups do not duplicate or modify archived answers.

Affected Case Framework forms have a read-only **Legacy answers** section; their combined previews and review cards also include those answers. The archive and original metadata are included in complete backups. **Answers already erased by an earlier destructive migration cannot be reconstructed** from this database; they require an older SQLite backup or export.

## Autosave and conflicts

Autosave tracks stable item/tree identities, queues only new or changed records, and sends changed fields where practical. Deletions must be explicitly requested; an item missing from a round-filtered view is never treated as deleted. Section edits retain existing row IDs. Workspace/filter switches drain pending saves before replacing the view, and importing/resetting pauses editing while it finishes. A completed older request cannot mark newer unsaved edits as saved.

Every API write carries `X-Dataset-Generation`. Updates/deletes also require `If-Match` with the `_revision` returned by the read endpoint (`X-Record-Revision` for singleton/section responses, including empty lists). The server checks the expected version and applies the write in one immediate SQLite transaction. Triggers advance logical revisions for metadata, round tags, follow-ups, legacy answers and images as well as the record itself. Image writes additionally require `If-Match-Owner`; their responses expose `X-Owner-Path` and `X-Owner-Revision`. Synchronous write handlers should be registered through the server's `writes` wrapper so neither checks nor deferred-until-commit responses can be bypassed accidentally.

If another tab changed the same record, the server returns HTTP 409 and autosave stops. The conflict dialog keeps your draft and compares it with the latest saved record. Choose **Download unsaved draft**, **Load saved version**, or explicitly **Retry my changes against this version**. A second intervening edit causes another conflict, not an automatic overwrite. Loading the saved version discards only that conflicting pending operation; unrelated pending edits are retained and saved. After a dataset replacement, retry is deliberately disabled: download your draft before loading the restored dataset and manually reapply any wanted text. Drafts are held in browser memory, not durable offline storage—do not close/reload a conflicted tab without downloading them.

## Regression tests

```bash
npm test
npm run build
```

Tests start the real Express API on a temporary loopback port and use real SQLite databases in an OS temporary directory. They set `DATABASE_PATH` **before** loading application code and never mutate `data/interview-prep.db`. Coverage includes complete multi-workspace round trips/reopening/image bytes, filter-independent export, malformed-import rejection, injected restore rollback, recovery failure, legacy migration/idempotence, two-client writes/conflicts, explicit deletion, queued drafts, restore generation invalidation and imports above the old 20 MB request limit. No additional runtime dependencies are needed. Docker still uses the same server/build and `./data` volume; recovery files are retained in that volume too.
