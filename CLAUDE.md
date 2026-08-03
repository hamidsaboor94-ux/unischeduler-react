# UniScheduler — Claude guide

University management desktop app (admissions, enrollment, timetabling, LMS, grades, reports).
Trilingual: English, Pashto (`ps`), Dari (`prs`), with RTL. Sold with license-key activation.

**The requirements & progress ledger is [PROJECT-PROGRESS.md](PROJECT-PROGRESS.md).** Before
building a feature, find (or add) it there; after shipping, check it off there.

**`docs/` holds source-audited reference documentation — keep it in sync.** When a feature, role,
permission, module, or workflow changes, update the relevant file(s) as part of that change, not
as a separate pass:
- [docs/PRODUCT_DOCUMENTATION.md](docs/PRODUCT_DOCUMENTATION.md) — executive/sales-facing product
  documentation (roles, modules, workflows, security, licensing) for non-technical readers
  evaluating a purchase. Written in proposal language, not developer language; must never
  contradict PROJECT-PROGRESS.md on what's shipped vs. roadmap.
- [docs/FEATURE_INVENTORY.md](docs/FEATURE_INVENTORY.md) — per-module implementation status
- [docs/RBAC_MATRIX.md](docs/RBAC_MATRIX.md) — full role/permission/scope detail
- [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) — as-built architecture
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) / [docs/API_INVENTORY.md](docs/API_INVENTORY.md) — table/endpoint reference

If code and a doc disagree, the code is correct — fix the doc.

## Two-folder layout

| Part | Path |
|---|---|
| Frontend + Electron (this repo) | `c:\Users\LEMON_Soft\Desktop\UniScheduler-react` |
| Backend API (separate folder) | `c:\Users\LEMON_Soft\Desktop\uni scheduling\api` |

Backend: Express + built-in `node:sqlite` (Node ≥ 22.5, no native deps). Frontend: React 19 +
Vite, i18next, Recharts. Electron ships the backend by **copying** `api/src` into
`electron/backend/` via `scripts/copy-backend.mjs` — rerun it (or `npm run electron` / `dist`,
which do it for you) after any backend change, or the packaged app runs stale code.

## Commands

```bash
# Backend (run from "uni scheduling/api")
npm start          # API on http://localhost:4000
npm run seed       # demo data
npm test           # node --test test/*.test.js  ← run after backend changes

# Frontend (run from UniScheduler-react)
npm run dev        # Vite dev server on :5173
npm run lint       # oxlint
npm run electron   # build + copy backend + launch desktop app
npm run dist       # build Windows NSIS installer (output: C:/UniScheduler-release)
npm run ship       # full release pipeline (publishes to GitHub releases)
```

Electron first-launch flow: license activation window → embedded/client mode setup. Embedded
mode stores the SQLite DB under `%AppData%\Roaming\UniScheduler`; deleting `server-config.json`
or `license.json` there re-triggers the respective setup.

## Architecture notes

- **Roles**: 12 roles (`admin, registrar, admissions_officer, dept_head, dean, exam_officer,
  records_officer, bursar, viewer, advisor, faculty, student`) — see
  [docs/RBAC_MATRIX.md](docs/RBAC_MATRIX.md) for the full matrix. No self-registration — admin
  creates accounts, which get one-time temp passwords + forced first-login password change. Two
  authorization systems coexist by design (legacy `POLICY` in `api/src/permissions.js` +
  `middleware/permission.js`, and newer granular `requirePermission('Module.Action')` in
  `api/src/authz.js`); `dept_head`/`dean` are department/college-scoped via `api/src/scope.js`;
  faculty course-ownership checks in `api/src/ownership.js`.
- **Frontend state**: `src/context/AppDataContext.jsx` loads most collections up-front; pages are
  plain components switched by `NavigationContext` (no router). **Every page stays mounted** —
  when driving the UI via CDP/automation, query within the visible page, not the whole DOM.
- **API client**: `src/api.js`; base URL injected by Electron preload, falls back to
  `localhost:4000` in browser dev.
- **i18n**: namespaced JSON under `src/i18n/locales/{en,ps,prs}/`. Every user-visible string goes
  through `t()`; add keys to all three locales. RTL is handled with logical CSS properties
  (`margin-inline-start` etc.) — never `left`/`right` for layout.
- **DB**: schema created in `api/src/db.js` (`CREATE TABLE IF NOT EXISTS` + ad-hoc ALTERs).
  Gotcha: it builds SQL in template literals — a backtick inside SQL text breaks the file.
- **Email** (`api/src/mailer.js`) is optional: without `SMTP_HOST` every send silently no-ops.

## Testing conventions

- Backend tests live in `api/test/` and run with plain `node --test`.
- Never test against the real admin account (`admin@gmail.com`) — create a disposable account
  and restore state after.
