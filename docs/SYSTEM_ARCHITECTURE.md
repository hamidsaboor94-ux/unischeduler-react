# UniScheduler — System Architecture

> Source of truth for the *current, as-built* architecture. Generated from a full code audit on
> 2026-07-30, updated 2026-08-02 (Graduation / Degree Issuance module). If this document and the
> code disagree, the code is correct — fix this file.
> See [PROJECT-PROGRESS.md](../PROJECT-PROGRESS.md) for requirements/roadmap; this document is
> purely descriptive of what exists today.

## 1. Application overview

UniScheduler is a full university management system: admissions → enrollment → timetabling →
teaching (assignments, materials, attendance, grades) → finance → reporting, with a trilingual
UI (English, Pashto `ps`, Dari `prs`, RTL-aware). Shipped today as a Windows desktop app
(Electron + embedded SQLite), with an optional shared-server ("client") mode for LAN use.

Two physically separate codebases:

| Part | Path | Stack |
|---|---|---|
| Frontend + Electron shell | `UniScheduler-react/` | React 19 + Vite, i18next, Recharts |
| Backend API | `uni scheduling/api/` | Express + `node:sqlite` (Node ≥ 22.5), JWT auth |

The backend is developed in its own folder and **copied** into `UniScheduler-react/electron/backend/`
by `scripts/copy-backend.mjs` before every Electron build/run — the packaged app never reads the
backend from its original location.

## 2. Technology stack

- **Backend**: Node.js ≥ 22.5, Express, `node:sqlite` (built-in, no native driver dependency),
  JWT (`jsonwebtoken`), rate limiting middleware, `pdfkit` (PDF export), `exceljs` (Excel export),
  `pdf.js` (server-side/parse use for timetable import — parsing itself is client-side; see below).
- **Frontend**: React 19, Vite, i18next (3-locale), Recharts (analytics charts), `pdf.js` (client-side
  PDF parsing for timetable import), plain CSS (no CSS framework) with logical properties for RTL.
- **Desktop shell**: Electron + electron-builder (NSIS installer), electron-updater (GitHub Releases
  auto-update), Ed25519-signed offline license activation.
- **Testing**: Backend — `node --test` (30 files under `api/test/`). Frontend — **no test framework
  configured** (no vitest/jest/testing-library in `package.json`); linting only (`oxlint`).
- **Database**: single-file SQLite via `node:sqlite`, schema managed by idempotent
  `CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER TABLE ADD COLUMN` ("ensureColumn") migrations in
  `api/src/db.js` — there is no versioned migration system (tracked as a gap; see
  PROJECT-PROGRESS.md §3.7).

## 3. Frontend architecture

- **No router.** `src/context/NavigationContext.jsx` holds a single `activeSection` string that
  selects which page component is visible. Every page component **stays mounted at all times**
  regardless of role or section — `AppShell.jsx` is responsible for showing/hiding via CSS, not
  mount/unmount. This matters for any DOM-querying automation: query within the visible section,
  not assume other pages are absent from the DOM.
- `activeSection` is mirrored into the URL as `?section=name` for bookmarkability and integrated
  with `window.history.pushState`/`popstate` so browser Back/Forward works. An optional
  `sectionFocus` payload (e.g. `{ studentId: 12 }`) can ride alongside a navigation to tell a page
  to open on a specific item; it lives only in the history entry's state, not URL-encoded.
- Role-gating of navigation happens client-side in `NavigationContext` via `canAccessSection()`
  (mirrors backend policy) — this is a UX convenience only; all real authorization is enforced
  server-side (see §6).
- **Central data store**: `src/context/AppDataContext.jsx` loads most reference/collection data
  up front after login (`performLoad()`), gated per-collection by the same client-side `can()`
  policy mirror used for navigation, so unauthorized roles never issue requests they'd be denied
  for. Holds auth/session phase (`checking → login/setpw/branding-setup → ready`), active term
  selection, and a generic `afterMutate()` helper (mutate → toast → reload).
- **API client**: `src/api.js` — one `API_BASE` resolved from (in order) an Electron-injected
  global, a Vite env var, or `localhost:4000/api` fallback for browser dev. Attaches
  `Authorization: Bearer <jwt>` from `tokenStorage.js` to every request; translates bare 403s into
  a friendly message. ~150 typed wrapper functions cover every backend route.
- **Pages** (`src/pages/`, 35 files) are the unit of feature; **Components** (`src/components/`,
  ~31 top-level + `modal/` (34 files, the app's modal library), `finance/`, `reports/`,
  `students/`, `teacher/`, `ui/` subfolders) are shared building blocks. See
  [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) for the full page list.
- **i18n**: `src/i18n/locales/{en,ps,prs}/`, 16 namespace files each, confirmed 1:1 parity across
  all three locales. RTL handled via logical CSS properties (`margin-inline-start` etc.), never
  `left`/`right` for layout.

## 4. Backend architecture

- Express app (`api/src/app.js`) mounts ~40 route modules under `routes/`, each under an
  `/api/<resource>` prefix. Full endpoint-by-endpoint inventory: [API_INVENTORY.md](API_INVENTORY.md).
- Cross-cutting modules: `middleware/auth.js` (JWT verification, `requireAuth`, `requireRole`),
  `middleware/permission.js` (legacy module-policy gate), `authz.js` (newer granular
  `Module.Action` permission system), `scope.js` (department/college scope resolution),
  `ownership.js` (faculty course/exam ownership checks), `validate.js` (input validation
  helpers), `notify.js`/`notificationTypes.js` (notification creation).
- Domain logic modules outside `routes/`: `eligibility.js` (enrollment prerequisite engine),
  `academicProgression.js` (semester pass/fail/probation evaluation), `scheduling.js` (conflict
  detection), `reportBuilder.js`/`reportEntities.js` (whitelist-driven custom report query
  engine), `reportExport.js`/`dashboardExport.js` (PDF/Excel rendering), `approvalEngine.js`
  (generic multi-step approval-chain engine, currently backing the appeals flow via
  `appealsFlow.js`), `noticeTargeting.js`/`noticePublish.js`/`noticeScheduler.js` (university-wide
  announcement targeting/publishing/scheduled-sweep), `pdfTimetableParser.js` (server-side parse
  step for imported timetable PDFs), `mailer.js` (optional SMTP — silently no-ops without
  `SMTP_HOST`).
- Two full authorization systems coexist by design (migration in progress) — see §6 and
  [RBAC_MATRIX.md](RBAC_MATRIX.md) for the detailed breakdown and the ambiguities this creates.

## 5. Authentication flow

1. `POST /api/auth/login` (public, rate-limited) — email/password → JWT (8h expiry). No public
   self-registration; every account is created by an admin (`POST /api/users` or the admissions
   approve-to-student flow), issued a one-time temporary password.
2. `mustChangePassword` flag on the user forces a password-change screen
   (`PUT /api/auth/set-password`) before any other action; this route is itself exempted from the
   lock so the user can escape it.
3. JWT payload carries `id`, `role`, and (for scoped roles) a resolved `departmentIds` array
   computed at login time by `scope.js` — scope is a login-time snapshot, not re-evaluated
   per-request.
4. `requireAuth` middleware verifies the JWT on every protected route; `GET /api/auth/me`
   round-trips the current user for session restoration on app load.
5. Self-service: `PUT /api/auth/profile` (name/email), `PUT /api/auth/change-password` (requires
   current password, rate-limited), `PUT /api/auth/language`.
6. Auth endpoints (`login`, `set-password`, `change-password`) are rate-limited with
   production-strict defaults.

## 6. Authorization architecture

Two coexisting systems (both actively used — see [RBAC_MATRIX.md](RBAC_MATRIX.md) for full
detail):

1. **Legacy module-policy system** (`api/src/permissions.js` — its own header calls it "the
   single source of truth" today). A flat `POLICY` object maps `role → module → NONE|READ|WRITE`
   across 24 modules. Enforced at route-mount time by `requireModuleAccess(module, opts)`
   (`middleware/permission.js`), with `openRead`/`allowOwnerWrite` opt-outs for reference data and
   faculty/student self-service respectively. Mirrored (hand-maintained, not generated) in
   frontend `src/permissions.js` for client-side UX gating only.
2. **Newer granular system** (`api/src/authz.js` + DB tables `permissions`/`role_permissions`/
   `user_roles`/`user_scopes`, defined in `db.js`). Adds `Module.Action` granularity (e.g.
   `courses.Update`) and server-side department/college scope checks (`scopeOf`). Seeded
   *from* the legacy POLICY at every startup, so the two stay in sync one-way, not live. Routes
   migrate one at a time; `courses.js`, `notices.js`, `progression.js`, `teacherProfile.js` use it
   today, the rest still use the legacy path or direct `requireRole()`.

Additional layers on top of both: `scope.js` (department-head/dean org-unit scoping, JWT-carried),
`ownership.js` (faculty can only manage their own courses/exams), and per-object ad hoc checks
(e.g. Student Advisor → own advisees only, via `student_profiles.advisorTeacherId`).

Some sensitive endpoints (backup, user management, system reset, timetable import, system health)
bypass both policy systems entirely via a direct `requireRole('admin')` guard — deliberate, not
an oversight.

## 7. Data flow

1. Frontend renders from `AppDataContext`'s up-front-loaded collections (departments, terms,
   courses, rooms, etc.) plus page-local fetches for anything not loaded globally (e.g. a single
   student's finance statement).
2. Every mutation goes through `src/api.js` → Express route → `requireAuth` → authorization
   middleware (§6) → (for scoped roles) a scope/ownership check → SQLite read/write → JSON
   response.
3. Most successful mutations are followed by `AppDataContext.afterMutate()`, which shows a toast
   and unconditionally reloads the relevant collections rather than optimistically patching local
   state (the exception is notification read/dismiss, which is optimistic).
4. File uploads (photos, documents, materials, attachments, receipts) are stored on disk via a
   swappable storage module per domain (`facultyStorage.js`, `studentStorage.js`,
   `noticeAttachmentStorage.js`, plus inline handling in a few routes) and served back through an
   authenticated file-fetch route, never a public static path.

## 8. Deployment architecture

- **Desktop (Electron)**: `main.cjs` gates the app behind offline Ed25519 license verification
  (`licensing.cjs`), then resolves a runtime mode via `server-config.cjs`, persisted to
  `<userData>/server-config.json`:
  - **Embedded** — Express+SQLite run in-process on a random localhost port; DB lives under
    `%AppData%\Roaming\UniScheduler`.
  - **Client** — no local backend; connects to a UniScheduler server elsewhere on the LAN so
    multiple installs share one database.
  First-launch flow: license activation window → embedded/client mode setup window → app.
  `preload.cjs` injects the resolved API base URL into the renderer via `contextBridge`.
- **Packaging**: `npm run dist`/`release` = `vite build` → `copy-backend.mjs` → `electron-builder
  --win` (NSIS one-click installer). Auto-updates via `electron-updater` against a GitHub
  Releases repo (`hamidsaboor94-ux/unischeduler-releases`).
- **Web/browser**: not deployed today — the backend is a plain Express app and *could* serve a
  browser client, but there is no hosted deployment, no production CORS allowlist work, and no
  multi-tenant story yet. Tracked as a P1 gap in PROJECT-PROGRESS.md §3.7.

## 9. Storage strategy

- **Database**: single SQLite file (`node:sqlite`), `PRAGMA foreign_keys = ON`. No connection
  pooling concerns (single-process, single-file). No read replicas, no backup automation (manual
  export/restore only, admin-triggered via `/api/backup`).
- **File uploads**: disk-backed, one storage helper module per domain, each producing a
  DB-tracked row (filename, mime type, uploader) pointing at a path outside the web root; files
  are only ever served through an authenticated download route that re-checks access on each
  fetch — no public static file serving of uploads.
- **Client-side**: JWT stored via `tokenStorage.js`; no client-side data persistence beyond
  in-memory React context (a full reload re-fetches everything through `AppDataContext.boot()`).

## 10. Major modules

See [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) for the complete, per-module implementation
status. At a glance, the modules are: Authentication & Accounts, Academic Structure (departments/
programs/terms/courses/rooms/teachers), Scheduling & Timetabling, Enrollment & Eligibility,
Admissions, Teaching/LMS (assignments, materials, announcements, attendance, gradebook),
Student Records (profile, documents, transcript, academic progression), Graduation & Degree
Issuance (eligibility worklist, financial-clearance-gated confirmation, certificate PDF), Finance
(fees, payments, installments, aid), University-wide Notices, Custom Report Builder + PDF/Excel
export, Approvals (generic chain engine, currently backing Appeals), Administration & Operations
(audit log, backup, branding, global search), and the Electron/licensing/desktop-delivery layer.

---
*Last generated: 2026-07-30, from a full source audit (not from PROJECT-PROGRESS.md's roadmap
narrative), updated 2026-08-02 (Graduation / Degree Issuance module). Keep this in sync per the
workflow rules in the top of RBAC_MATRIX.md / repo CLAUDE.md: update after any architectural
change, not just at audit time.*
