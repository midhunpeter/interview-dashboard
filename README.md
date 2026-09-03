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

The REST API is available below `/api` on the same host and port as the dashboard. Opportunities are managed at `/api/workspaces`, with interview rounds nested at `/api/workspaces/:workspaceId/rounds`. Drill trees can be general preparation or associated with a round through `round_id`. The API also includes story and question banks, Scheduling Machine notes, reliability incidents, the translation map, knowledge items, and cross-table search at `/api/search?q=...`.
