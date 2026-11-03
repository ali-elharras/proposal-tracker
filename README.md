# IEE

Internal sales and operations system for Grasshoppers and Team Up.
- `backend/`: FastAPI, SQLAlchemy and Alembic. See `backend/README.md`.
- `frontend/`: React and Vite. See `frontend/README.md`.
- `contracts/`: the shared rule scenarios, checked by both test suites.

## Start everything (development, Windows)

One-time setup: create the backend environment (see `backend/README.md`, Setup) and run `npm install` in `frontend/`.

Then, from this folder:

```
./start-dev.ps1                        # the REAL data (backend/eventflow-real.db): the default
./start-dev.ps1 -Data demo             # the demo data (backend/eventflow.db), for presentations
./start-dev.ps1 -Data demo -ResetDemo  # rebuild the demo database from scratch first
./start-dev.ps1 -Data present          # a fresh copy of the real data ("Presentation copy")
./start-dev.ps1 -Data test [-Fresh]    # your persistent test copy of the real data ("Test copy")
```

Open http://127.0.0.1:5173. The script:
1. prepares the chosen database (migrates it; demo data is loaded on the first demo run only, later runs keep your changes);
2. starts the backend on http://127.0.0.1:8000 in its own window, with the development identity on;
3. starts the frontend in API mode in the current window.

Or, as two commands in two terminals:

```
# 1. backend (from backend/)
$env:EVENTFLOW_ENV='development'; $env:EVENTFLOW_DEV_IDENTITY='true'
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m app.seed mark-demo; .venv\Scripts\python -m app.seed demo   # first run only
.venv\Scripts\python -m app.serve

# 2. frontend (from frontend/)
npm run dev -- --host 127.0.0.1
```

## Data source

`VITE_DATA_SOURCE` chooses where the screens get their data:

| Value | Meaning |
|---|---|
| `api` | The default for `npm run dev`. The tracker, request pages, actions and the request form use the backend, so changes survive a reload. |
| `demo` | The in-memory demo store, with no backend needed (`$env:VITE_DATA_SOURCE='demo'; npm run dev`). Changes reset on reload. |

In API mode every page uses live data from the backend. Personal to-dos (My Work) are live too; the old sample tasks appear only on the demo database. The Opportunities and Tasks pages are switched off for everyone (open opportunities are listed on each client).

The **"Dev identity"** switcher at the bottom of the menu chooses which team member and role the requests are sent as. This is not authentication.

## Required before go-live

These are not done yet, on purpose:
- **Real authentication** to replace the development identity (`backend/app/identity.py`).
- **Virus scanning of uploaded proposal files.** Uploads are currently checked for real file type (PDF/PPTX) and size (25 MB) only. *(Decision 6, Phase 4A.)*
- PostgreSQL deployment, with file storage moved to cloud storage behind `backend/app/storage.py`.
