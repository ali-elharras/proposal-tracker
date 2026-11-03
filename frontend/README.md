# IEE frontend

React 19 + Vite 6 + React Router. No UI, chart or state libraries.

## Run

```
npm install
npm run dev        # http://127.0.0.1:5173, API mode (needs the backend; see ../README.md)
npm run build      # production build into dist/ (demo mode unless VITE_DATA_SOURCE=api)
npm test           # domain rules + shared contract scenarios
```

`/api/*` requests are proxied to the FastAPI backend on http://127.0.0.1:8000. Because the proxy talks to the backend from this computer, the backend's loopback-only development identity works, and no CORS setup is needed.

`VITE_DATA_SOURCE=api|demo` selects the data source (`src/data/source.js`):
- in development the default is `api`;
- `demo` uses the in-memory store and needs no backend.

## Pages

| Page | What it shows |
|---|---|
| My Work | Everyone's first page: New, your turn, to-dos, waiting on others, recently finished (Marketing, Operations, HR: what waits on them). |
| Dashboard | Role dashboards on live data: key counts, needs attention, the pipeline chart. |
| Proposals | The tracker. |
| Clients | List with "New client"; profile with Overview · Contacts · Events · History, Edit, "New proposal" for that client, contacts, new opportunities, and (under More) Transfer owner (Commercial Head) and Archive. |
| Opportunities | Switched off for everyone (pageAccess); open opportunities show on each client. |
| Tasks | Switched off for everyone; personal to-dos live on My Work. |
| Analytics | Anyone with "See analytics" (data from `/api/analytics`). |
| Team & Users | Anyone with "Manage accounts": "New account", each person's page (Edit, Deactivate / Reactivate, History). |
| Settings | Anyone with "Manage accounts", in tabs: Routing · Dropdown lists · Occasions · Reference (read-only configuration). |

- **Old addresses:** `/my-work`, `/operations` and `/dashboard` redirect to Home.
- **Where the data comes from:** dashboards and Analytics use every request the viewer may see (`useAllRequests`). That is `GET /api/proposal-requests?include=history`, fetched per tracker scope, 100 per page (the server's limit), with further pages fetched as needed.
- **Calculations:** the live numbers come from `src/domain/scorecard.js` and `src/domain/events.js`.

## Design system (v2)

- `src/styles/tokens.css`: every colour, radius, shadow and size as a token. Light is the default for everyone;
  dark only when someone picks it at the bottom of the menu (`index.html` applies the choice before the first paint).
- `src/styles/v2.css`: the look of every shared element (buttons, cards, fields, tables, tabs, panels, KPI cards,
  the pipeline chart); loaded last. Phones get stacked table rows (each cell under its column name).
- Pages use `PageLayout` (title, subtitle, `meta` line, actions, `crumbs` for pages inside a section).

## API mode (Phase 4A)

- **`src/api/client.js`:** a small fetch wrapper.
  - It sends the development identity headers chosen in the "Development identity — not a login" switcher.
  - It turns API errors into typed errors (401, 403, 404, 409, 422).
- **`src/api/ApiProvider.jsx`:** holds the identity, users, clients, config and `/api/me`.
  - After each write it bumps a revision, so the screens refetch.
- **`src/api/hooks.js`:** the same hook names and return shapes as `src/demo/hooks.js`.
  - Actions, edit rights, upload rights and tracker counts come from the server.
  - In API mode, permissions and transitions are never computed locally.
- **`src/data/hooks.js`:** the module every screen imports. It picks the demo or API hooks once, at build time.
- **Times:** shown in Africa/Cairo, whatever the computer's own time zone (`src/lib/format.js`).

## Structure

- `src/styles/tokens.css`: design tokens (colours, status tones, type, spacing). CSS uses logical properties so RTL is possible later.
- `src/navigation.js`: sidebar structure, role-aware page descriptions, Admin gating.
- `src/domain/`: business rules and fixed lists:
  - `status.js`: **STATUS_CONFIG**, the only place proposal statuses / opportunity stages are defined.
  - `routing.js`: **brand → Account Manager** routing rule.
  - `roles.js`, `brands.js`, `catalog.js`.
- `src/demo/`: the **single shared demo store**:
  - `seed.js`: fictional clients/numbers, real team names; dates are relative to today.
  - `DemoStore.jsx`: React context; resets on reload except the selected demo user/role.
  - `hooks.js`: `useCurrentUser`, `useClients`, `useOpportunities`, `useProposalRequests`, `useTasks`, ...
    Components read data only through these hooks so they can be swapped for API calls later.
- `src/components/layout/`: app shell, `PageLayout`, demo "Viewing as" switcher.
- `src/components/ui/`: reusable building blocks.
- `src/components/dashboard/`: dashboard widgets from the earlier UI phase, not currently rendered;
  to be reconnected to the shared store in the dashboard step.
- `src/lib/format.js`: `EGP 125,000`, `20 Oct 2026`, Sunday-start weeks.

## Clients and opportunities (CRM 1)

- **Rules:** `src/domain/crm.js` (who may do what, field checks, manual stage moves, duplicate
  warnings, the transfer plan). The backend runs the same rules (`app/domain/crm.py`), checked
  by the contract file's `crmCases`.
- **Screens:** every form opens in a side panel (`components/ui/SidePanel.jsx`, forms in
  `components/crm/`), with optional fields under "More details". Rare actions sit in the
  "More" menu. Only actions the server's `permissions` allow are shown; otherwise one calm line
  says whose record it is.
- **Saving:** an edit sends only the fields that were changed in the panel. After a 409 the
  panel keeps what was typed and offers Reload; saving again then cannot overwrite someone
  else's change to other fields.
- **Demo mode** (`VITE_DATA_SOURCE=demo`) is read-only for clients and opportunities.

## Accounts, roles and privileges

- **Rules:** `src/domain/access.js` (who sees what, by active role and the person's privileges; which pages
  they get) and `src/domain/accounts.js` (account fields, ids, safeguards, routing). The backend runs the same
  rules (`app/domain/access.py`, `accounts.py`), checked by the contract file's `accountCases`.
- **Menu and pages:** each menu item names its page (`navigation.js`); the menu and `RoleGate` follow
  `pages` from `/api/me` (demo mode: `pageAccess()`). The server refuses the data as well.
- **Homes:** Executives get a read-only Home (pipeline, won and lost this month, requests waiting longest);
  Marketing and Operations get "Nothing is waiting on you".
- **People:** pickers and the identity switcher list active people only; names of deactivated people still
  resolve in history (`useLookups().usersById`).
- **Demo mode** shows the same visibility and pages but cannot change accounts or routing.
