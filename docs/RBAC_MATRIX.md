# UniScheduler — RBAC / Authorization Matrix

> Generated from a full read of `api/src/permissions.js`, `api/src/authz.js`, `api/src/scope.js`,
> `api/src/ownership.js`, `api/src/middleware/auth.js`, `api/src/middleware/permission.js`,
> `api/src/appealsFlow.js`/`approvalEngine.js`, `api/src/db.js` (permission tables), and the
> frontend mirror `src/permissions.js`, on 2026-07-30.
>
> **Two authorization systems coexist in this codebase, both actively used.** This is not a bug —
> it's an intentional, in-progress migration (documented in PROJECT-PROGRESS.md §3.8). This
> document describes both, and flags every place they disagree or overlap, rather than pretending
> only one exists.

## 0. How to read this document

1. **§1 Roles** — the full role list (12), where it's defined, and what "scope" means for each.
2. **§2 Legacy POLICY matrix** — `api/src/permissions.js`'s `POLICY` object, the actual
   day-to-day source of truth for most routes today.
3. **§3 Granular permission system** — the newer `Module.Action` tables/middleware, which routes
   use it, and how it differs from POLICY.
4. **§4 Scope & ownership** — department/college scoping (Dean/Dept Head) and per-object
   ownership (Faculty/Advisor), layered on top of both systems above.
5. **§5 Direct role bypasses** — sensitive endpoints that skip both permission systems via a
   literal `requireRole('admin')` (or similar) check.
6. **§6 Known ambiguities** — things a reader must know to avoid drawing the wrong conclusion
   from the tables alone.

---

## 1. Roles

Defined in `api/src/permissions.js` `ROLES` (hand-mirrored in `src/permissions.js` — **not
generated**, so the two can drift; treat the backend as authoritative). No self-registration:
every account is admin-created (`POST /api/users`) or created via admissions approve-to-student.

| Role (DB/JWT value) | Display name | Scope kind |
|---|---|---|
| `admin` | Super Admin | none — implicitly WRITE on every module, always bypasses scope |
| `registrar` | Registrar | university-wide |
| `admissions_officer` | Admissions Officer | university-wide |
| `dept_head` | Department Head | **department-scoped** — confined to `users.departmentId` |
| `dean` | Dean | **college-scoped** — confined to every department in `users.collegeId` |
| `exam_officer` | Exam Officer | university-wide |
| `records_officer` | Records Officer | university-wide |
| `bursar` | Bursar | university-wide |
| `viewer` | Viewer | university-wide, read-only |
| `advisor` | Student Advisor | **ownership-scoped** — own advisees only, via `teachers` row → `student_profiles.advisorTeacherId` |
| `faculty` | Faculty | **ownership-scoped** — own courses only, via `teachers.userId` |
| `student` | Student | **self-scoped** — own records only |

Role-specific provisioning at account creation (`accounts.js`): `faculty`/`advisor` also get a
linked `teachers` row (advisor reuses the `teachers` table purely as an identity/linkage
mechanism, not because they teach); `student` also gets a `student_profiles` row.

`STAFF_ROLES` (a targeting-audience grouping used only by the Notices system, `noticeConstants.js`):
`admin, registrar, admissions_officer, dept_head, dean, exam_officer, records_officer, bursar,
viewer` — explicitly excludes `faculty`/`student`/`advisor`. Not a general-purpose role group.

---

## 2. Legacy POLICY matrix (`api/src/permissions.js`)

**This is the real source of truth today** — the file's own header comment says so, and most
routes still gate through it. 24 modules, 3 levels: `NONE` (absent from the table) / `READ` /
`WRITE`. `admin` is implicitly `WRITE` everywhere and is omitted from the table below.

| Module | READ | WRITE |
|---|---|---|
| dashboard | registrar, admissions_officer, dean, dept_head, exam_officer, records_officer, bursar, viewer, advisor, faculty, student | — |
| reports | viewer | registrar, records_officer |
| timetable | exam_officer, viewer, faculty, student | registrar, dean, dept_head |
| rooms | dean, dept_head, exam_officer, viewer | registrar |
| courses | exam_officer, records_officer, viewer, faculty, student | registrar, dean, dept_head |
| teachers | registrar, viewer | dean, dept_head |
| students | admissions_officer, dean, dept_head, bursar, viewer | registrar, records_officer |
| departments | registrar, dean, dept_head, admissions_officer, exam_officer, records_officer, viewer | — |
| terms | dean, dept_head, exam_officer, records_officer, admissions_officer, bursar, viewer, faculty, student | registrar |
| exams | viewer, faculty, student | registrar, exam_officer, dean, dept_head |
| enrollment | faculty, student | registrar |
| attendance | viewer, student | faculty |
| grades | viewer, student | records_officer, faculty |
| gradingScale | viewer | records_officer |
| admissions | registrar, dean, dept_head, viewer | admissions_officer |
| conflicts | registrar, exam_officer, viewer | — |
| finance | — *(viewer's read removed 2026-07-28 hardening)* | bursar |
| users | — | *(admin only — empty row)* |
| audit | — *(viewer's read removed 2026-07-28 hardening)* | *(admin only — empty row)* |
| backup | — | *(admin only — empty row)* |
| branding | — | *(admin only — empty row)* |
| announcements | viewer | registrar, dean, dept_head |
| approvals | registrar, faculty *(page-shell visibility only — real per-request eligibility is dynamic, see §4)* | — |
| graduation | — | registrar, records_officer |

**`advisor` has almost no POLICY footprint** — it appears only in `dashboard`'s READ row. All of
its real capability (viewing/acting on assigned advisees) is bespoke `req.user.role === 'advisor'`
ownership code in `studentProfile.js`/`progression.js`, not expressible in this matrix — see §4.

`requireModuleAccess(module, opts)` (the middleware enforcing this table, `middleware/permission.js`)
supports two opt-outs used by several routers:
- `opts.openRead: true` — any authenticated user may **read**, regardless of the table above.
  Used for: `departments` (+ colleges, programs — mounted through the same gate), `teachers`,
  `rooms`, `finance` (for the `student-types` reference-data router only).
- `opts.allowOwnerWrite: true` — lets a role with only READ access still hit write routes, because
  the route itself does an ownership check instead. Used for: `courses`, `exams`, `enrollment`
  (lets faculty/students self-serve within their own scope).

---

## 3. Granular permission system (`api/src/authz.js` + DB)

Curriculum uses `Curriculum.View/Create/Update/Delete/Activate/Archive/AssignStudent/Compare/AuditStudent/OverrideRegistrationRecommendation`.
Write grants are seeded for Registrar and Records Officer; Dean, Department Head, and Viewer
receive read-only access under the existing fixed-role conventions.

Newer, additive system. **Not yet used by most routes** — only `courses.js` (write routes),
`notices.js`, `progression.js`, and `teacherProfile.js` call it as of this audit.

**Tables** (`db.js`):
- `permissions (id, module, action)`, UNIQUE `(module, action)` — seeded for every POLICY module
  with 4 CRUD actions (`View, Create, Update, Delete`), plus extras: `announcements` gets
  `Publish, Schedule, Archive, ManageRecipients, ViewAnalytics`; `students` gets `Progress`.
- `role_permissions (role, permissionId)` — seeded **from** POLICY at every server start: a
  WRITE-level role in POLICY gets all CRUD+extra actions; a READ-level role gets only `View`.
  One-way sync — editing this table directly would be overwritten on next restart unless the seed
  function itself is changed.
- `user_roles (userId, role)` — **secondary/additive** roles on top of the JWT's one primary
  `users.role`. Actually consumed only by `approvalEngine.js`'s reviewer-queue matching today.
- `user_scopes (userId, scopeType, scopeId)` — exists, is seeded (mirrors `users.departmentId`/
  `collegeId`), but **is not read or enforced by any code today**. `scope.js` still uses
  `users.departmentId`/`collegeId` directly. Treat as inert infrastructure, not a live control.

**Middleware**: `requirePermission('Module.Action', opts)` — checks `hasPermission()` (which
special-cases `admin` to always pass, then checks `role_permissions` unioned across the user's
primary + secondary roles). `opts.scopeOf` (a function of the request) adds a department/college
scope check on top, e.g. `courseScopeOf`, `teacherScopeOf`, `relatedScopeOf('teacher_education')`.

**Permission strings actually referenced in route code** (10 route files):
- `courses.Create`, `courses.Update` (scopeOf: courseScopeOf), `courses.Delete` (scopeOf) — courses.js
- `announcements.Create`, `.View`, `.Update`, `.Publish`, `.Schedule`, `.Archive`, `.Delete`,
  `.ManageRecipients`, `.ViewAnalytics` — notices.js
- `students.Progress` — progression.js
- `teachers.Update`, `.Create`, `.Delete` (with scopeOf variants: `teacherScopeOf`,
  `relatedScopeOf('teacher_education'|'teacher_experience'|'teacher_certifications'|'teacher_documents')`)
  — teacherProfile.js (plus a bespoke `requireProfileUpdateAccess` that lets **Bursar** through via
  `finance.Update` alone, for payroll-only field edits — a cross-module exception)

**⚠️ Naming collision**: `requirePermission` is the name of **two unrelated functions** with
different call signatures, imported from different files, and route files mix both without any
visual distinction at the call site:
- `middleware/permission.js`: `requirePermission(module, 'read'|'write')` — legacy 2-arg form.
  Used by: `applications.js`, `exams.js`, `finance.js`, `graduation.js`, `settings.js`,
  `slotExceptions.js`, `students.js`.
- `authz.js`: `requirePermission('Module.Action', opts)` — new dotted-string form.
  Used by: `courses.js`, `notices.js`, `progression.js`, `teacherProfile.js`.

When reading or writing route code, **always check the import line**, not just the call shape.

---

## 4. Scope & ownership (layered on top of both systems above)

### Department/college scope (`scope.js`) — enforced, JWT-carried
- `dept_head` → exactly one department (`users.departmentId`), resolved to a 1-element id array
  **at login time** and stamped into the JWT as `departmentIds`. Scope is a login-time snapshot —
  changing a dept head's department requires them to log in again to pick it up.
- `dean` → every department whose `collegeId` matches `users.collegeId`, resolved similarly.
- All other roles → `null` (unrestricted).
- Fails closed: an empty/missing scope array matches nothing, never "everything."
- Applied on top of POLICY/authz grants — e.g. a Dean has `courses:WRITE` by POLICY, but `scope.js`
  still confines *which* courses (only their college's departments).

### Ownership (`ownership.js`) — faculty per-object checks, not role policy
- `canManageCourse(req, course)`: `admin` always passes; a non-faculty/student role with
  `courses:write` qualifies if the course's department is in their scope (registrar =
  university-wide, dept_head/dean = their scope); **faculty** qualify only if their linked
  `teachers.userId` matches `course.teacherId` — i.e. only their own courses.
- `canManageExam(req, exam)`: same pattern, resolved through the exam's course.
- `isInvigilator`: faculty get read-only visibility if `exam.invigilatorId` matches their teacher id.
- `canModifyEnrollment`: enrollment writes (enroll/withdraw someone else) are **admin or registrar
  only** — faculty never get roster-modification rights even for their own course.

### Advisor scope — bespoke, not in ownership.js
An advisor may view/act on a student only if `student_profiles.advisorTeacherId` equals the
teacher id linked to their own `teachers.userId`. Implemented ad hoc in `studentProfile.js` and
`progression.js` (`req.user.role === 'advisor'` + a lookup), a separate mechanism from faculty
course ownership even though both key off the `teachers` table.

### Approval-chain scope (`approvalEngine.js` + `appealsFlow.js`)
Generic multi-step reviewer-role engine, currently backing one flow: **Appeals**.
- Step 1: `role: 'faculty'`, narrowed by a custom `canAct()` to specifically the appealed course's
  own instructor (via `canManageCourse`) — not just any faculty member.
- Step 2: `role: 'registrar'` — any registrar, or admin.
- Only the role owning the *current* step (or admin) may decide (`canReviewCurrentStep`), checked
  against the requester's full role set (primary + `user_roles` secondary roles). The original
  requester may always view/cancel their own request regardless of step.

---

## 5. Direct role bypasses (skip both permission systems entirely)

These endpoints use a literal `requireRole(...)` check in `app.js` or the route file itself, with
**no** corresponding POLICY or `role_permissions` row — by design, not a POLICY omission bug:

| Endpoint(s) | Role(s) required |
|---|---|
| `POST/GET/PUT/DELETE /api/users*` | `admin` |
| `GET /api/audit-log` | `admin` (via mount-level `requireModuleAccess('audit')`, empty POLICY row) |
| `GET/POST /api/backup/*` | `admin` |
| `POST /api/timetable-import/*` | `admin` |
| `GET /api/system-health` | `admin` |
| `POST /api/super-admin/system-reset` | `admin` |
| `GET /api/registrar-dashboard` | `registrar`, `admin` |
| `PUT /api/settings/branding*` | `admin` (POLICY `branding` row is empty) |
| Admin-only fields on `PUT /api/student-profile/:studentId`, document/photo routes | `admin` |
| `POST/PUT/DELETE /api/assignments*`, `/api/materials*`, per-course `/api/announcements*` | `admin`, `faculty` (+ ownership check) |
| `POST /api/attendance/bulk` | `admin`, `faculty` (+ ownership check) |
| `PUT /api/slot-exceptions/:id/reschedule` | `admin`, `faculty` (+ ownership check, cancelled sessions only) |
| Finance policy-config routes (`PUT /finance/settings`, term config, fee-items/fee-rules/fee-plan CRUD) | `admin` only — **deliberately excludes Bursar**, who otherwise has full `finance:write` |

---

## 6. Known ambiguities (read before trusting a table cell literally)

1. **Two `requirePermission` functions, same name, different signature** — see §3. Always check
   the import.
2. **`user_scopes` is inert** — seeded, never read. Don't treat it as an enforcement mechanism.
3. **`role_permissions`/`permissions` are seeded from POLICY one-way, not live-synced** — most
   routes still gate via the in-memory POLICY object (`can()`/`levelFor()`), not these DB tables.
   The two representations mostly agree because of the seed step, but they are not the same
   mechanism, and a route migrated to `authz.js` could theoretically diverge from POLICY if POLICY
   changes without a corresponding reseed understanding.
4. **`advisor` has no meaningful POLICY row** — don't read "advisor: no access" from §2's table;
   its access is entirely the bespoke ownership check in §4.
5. **Frontend `src/permissions.js` is hand-maintained, not generated** from the backend — a drift
   risk. It is UX-only (hides nav items/buttons); the backend is what actually enforces access, so
   a frontend/backend mismatch is a UX bug, not a security hole, but should still be fixed if found.
6. **§5's bypass list is intentionally invisible to a POLICY-only reading** of the system — a
   matrix built purely from `permissions.js` would incorrectly suggest nobody can manage backups,
   users, or run a system reset.
7. **`finance` and `audit` POLICY rows were tightened 2026-07-28** (removing `viewer`'s prior read
   access) as part of an RBAC hardening pass; `db.js`'s `seedAuthzTables()` carries a one-time
   `DELETE FROM role_permissions WHERE role='viewer' AND module IN ('finance','audit')` cleanup for
   this — historical, not a general resync mechanism.

---
*Last generated: 2026-07-30, updated 2026-08-02 (added the `graduation` module — see
`routes/graduation.js`). Update this file immediately whenever a role, permission, module, or
scope rule changes — per the workflow rules in this repo's CLAUDE.md and the top of this document.*
