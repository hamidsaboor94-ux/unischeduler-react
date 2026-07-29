# UniScheduler — Project Progress & Requirements

> **Purpose:** This document is the single source of truth for what UniScheduler is, what has
> been built, and what remains to be built. We work *from* this document: every new feature is
> first written here as a requirement, and every finished feature is checked off here. When we
> think we're "done", we audit the app against this document.
>
> **Status legend:** ✅ Done · 🔶 Partially done · ⬜ Not started · ❓ Needs a decision (see §6)
>
> Last updated: 2026-07-27

---

## 1. What the system is

**UniScheduler** is a full university management system (not just a timetabler). It covers
admissions → enrollment → timetabling → teaching (assignments, materials, attendance, grades) →
reporting, with trilingual UI (English, Pashto, Dari).

*As built today*: a Windows desktop app (Electron) with embedded SQLite, plus an optional
shared-server mode for LAN use. *Decided direction (2026-07-19)*: **cloud/web delivery** —
hosted API with browser access — see §6 for what that implies.

### Architecture (as built)

| Layer | Location | Stack |
|---|---|---|
| Frontend | `UniScheduler-react/src` | React 19 + Vite, i18next, Recharts, custom CSS |
| Backend | `uni scheduling/api/src` | Express + `node:sqlite` (Node ≥ 22.5), JWT auth |
| Desktop shell | `UniScheduler-react/electron` | Electron + electron-builder (NSIS), auto-update via GitHub releases |
| Licensing | `electron/licensing.cjs`, `license-keys/` | RSA-signed license keys, activation window on first launch |

Two runtime modes chosen at first launch (`server-config.cjs`):
- **Embedded** — Express+SQLite runs inside the Electron process; DB in `%AppData%\UniScheduler`.
- **Client** — connects to a UniScheduler server elsewhere on the network (shared DB).

The backend source is copied into `electron/backend/` by `scripts/copy-backend.mjs` — must be
re-run after any change under `uni scheduling/api/src`.

### Roles

- **admin** — full system management; the only role that can create accounts (no self-registration).
- **faculty** — own courses: roster, attendance, assignments, announcements, materials, gradebook.
- **student** — catalog browsing, self-enrollment, schedule, grades, attendance, assignments, profile.

---

## 2. Requirements — DONE ✅

### 2.1 Authentication, accounts & security
- ✅ JWT login (8h expiry), no public self-registration; admin creates all accounts
- ✅ One-time temporary passwords + forced password change on first login
- ✅ Self-service password change (requires current password) and profile edit (name/email)
- ✅ Admin password reset for any user; bulk user import
- ✅ Auth rate limiting (login / set-password / change-password), production-strict defaults
- ✅ Role-based route guards (`requireRole`) throughout the API
- ✅ Audit log (admin-viewable) of administrative actions
- ✅ Auto-generated ID numbers per role (students, faculty)

### 2.2 Internationalization
- ✅ Trilingual UI: English, Pashto (`ps`), Dari (`prs`); per-user language persisted server-side
- ✅ RTL support via logical CSS properties; language switcher
- 🔶 Native-speaker review of Pashto/Dari translations (flagged, not fully verified)

### 2.3 Academic structure
- ✅ Departments (CRUD)
- ✅ Terms/semesters: CRUD, single active term, **term rollover** (copy structure into a new term)
- ✅ Teachers (CRUD), Rooms (CRUD, type + capacity)
- ✅ Faculty full profile: personal/employment details, repeatable education history, photo +
  document uploads (disk-backed via a swappable storage module), kept in separate
  `teacher_profiles`/`teacher_education`/`teacher_documents` tables (additive — `teachers` itself
  untouched); gated by the `teachers.Create`/`.Update`/`.Delete` permission
- ✅ Courses: CRUD, bulk import, department/term/teacher binding, capacity (`maxStudents`)
- ✅ Course prerequisites (manage + enforced at enrollment)
- ✅ Grading scale (configurable letter-grade bands) + GPA grade points
- ✅ Graduation requirement setting (credit threshold)

### 2.4 Scheduling & timetabling
- ✅ Weekly timetable slots (day, time, duration, room, course) with CRUD
- ✅ Slot exceptions (cancel / one-off changes for a specific date)
- ✅ Conflict detection (room/teacher/time collisions) + conflicts page
- ✅ Available-rooms and available-times finders; **conflict auto-resolve**
- ✅ Exams: CRUD + **exam auto-scheduling**
- ✅ **PDF timetable import** (parse → preview → confirm → reset) via pdf.js
- ✅ Weekly calendar view; personal schedule ("My Schedule") for students/faculty

### 2.5 Enrollment
- ✅ Student self-enrollment from catalog with: capacity check, **waitlist**, prerequisite check,
  time-conflict prevention, duplicate prevention
- ✅ Drop course; admin/registrar enrollment management (individual or bulk-by-semester, capacity-
  aware, audit-logged); per-student enrollment list
- ✅ Prerequisite eligibility engine (`api/src/eligibility.js`, single source of truth for both the
  catalog and enroll enforcement): AND/OR prerequisite groups + corequisite (concurrent-enrollment)
  type, section/term-aware "one logical course" completion history, admin cycle rejection +
  audit log, program/department/term/financial-hold/credit-cap gates, atomic capacity check.
  Student Catalog page shows Eligible / Currently Enrolled / Completed / Not Yet Eligible / Not
  Offered with per-prerequisite ✓/✗ and a locked-course reason. `GET /students/me/eligible-courses`.
  Verified end-to-end live (browser): prereq lock → complete prereq → live unlock → enroll.
  Fixed a pre-existing bug found along the way: `AppDataContext`'s unconditional
  `fetchTeacherProfileSummaries()` call 403'd for student/faculty (no `teachers:View`), silently
  aborting the whole data load — courses/rooms/slots/exams/notifications stayed empty for every
  student session with no visible error. Now gated the same way as the other role-scoped fetches.

### 2.6 Admissions (public applications)
- ✅ Public application form (no login) with document upload
- ✅ Admin review queue: view, edit, status changes, approve → auto-creates student account
- ✅ Optional SMTP email to applicants (credentials + status changes); no-ops if unconfigured

### 2.7 Teaching / LMS
- ✅ Assignments: faculty create; students submit files; faculty view/grade submissions
- ✅ Announcements (per-course, faculty/admin post, students see)
- ✅ Course materials (file upload/download)
- ✅ Attendance: faculty bulk marking per session; student "My Attendance" view
- ✅ Gradebook: weighted grade items + per-student scores; department grade summary;
  student "My Grades" with GPA
- ✅ Two unread mechanisms: notification bell + per-course activity dots
- ✅ Course quick-actions for faculty (assignments/announcements/roster/attendance/gradebook)
- ✅ Faculty landing Dashboard *(2026-07-28)* — replaces the generic scheduling stat cards with
  My Courses/My Students/My Exams (scheduled + unscheduled) stat cards, today's sections only
  (own courses, real times/rooms), and a "Needs your attention" panel of the teacher's own
  unscheduled exams. No new backend surface — reuses the existing server-side course/exam
  ownership scoping. The cancelled-class reschedule action (narrowly scoped, not the broad
  timetable-write permission) was already shared across roles via DashboardPage's notice banner.

### 2.8 Student records
- ✅ Student profile (admin-managed fields vs self-editable fields split)
- ✅ Student document uploads; profile print stylesheet
- ✅ Student landing Dashboard *(2026-07-26)* — replaces My Schedule as the post-login page;
  summarizes GPA, fee balance/hold status, attendance rate, and enrolled-course count as stat
  cards, plus today's classes, recent announcements, and quick links to the full pages. Purely a
  read-only aggregation of existing `/finance/me`, `/grades/me` (via `/student-profile/:id`'s GPA),
  `/attendance/me`, and `/notices/me/list` endpoints — no new backend surface.
- ✅ Student Management upgrade *(2026-07-27)* — the Students page is now a full management
  surface, built on top of the same day's Academic Progression work (`studentStatus`,
  `semesterStatus`/`semester_records`) rather than duplicating it:
  - `GET /students` gained real server-side pagination (`page`/`pageSize`, first such pattern in
    the API) and new filters — College, Program, Student Type, Batch, Student Status, enrolled
    Course, admission date range — alongside the existing department/enrollment-status/semester/
    search (search now also matches phone). `GET /students/export` mirrors the same filters
    unpaginated (capped) for CSV export; `PUT /students/bulk` does scoped, audit-logged bulk
    edits (student status / department / program) for permitted roles.
  - New `student_profiles.batch` (free-text cohort label — deliberately not a full batches table,
    since the real Programs/Curriculum entity model is still §3.1 future work) and `.photoPath`
    (mirrors `teacher_profiles.photoPath`) columns; a new `studentStorage.js` + photo upload/fetch
    routes on `routes/studentProfile.js`, same pattern as `facultyStorage.js`.
  - Frontend: table/card view toggle, filter panel, checkbox-based bulk selection + toolbar
    (status update, dept/program reassignment, CSV export of filtered or selected rows, "Send
    Announcement" which pre-seeds the existing Notices "Specific Users" targeting — no new
    targeting logic needed), per-row quick actions (profile/edit/academic record/finance) wired
    into the existing StudentProfilePage/StudentDetailPage/FinancePage via `sectionFocus`. Student
    photo now shows as an avatar across Students/StudentDetail/StudentProfile (falls back to
    initials).
  - Not done this pass: a dedicated per-student add/drop enrollment UI ("Manage Enrollment" reuses
    the existing read-only StudentDetailPage enrollment list by design — enrollment editing stays
    course-centric via `EnrollStudentsModal`), and virtualized rendering (pagination caps page size
    instead, sufficient at the tested scale).
- ✅ Automatic semester progression *(2026-07-27)* — new `semester_records` table: one append-only
  row per student per semester attempt (status, credits attempted/earned, term GPA, CGPA snapshot,
  failed courses, completion date), never overwritten (a repeat/failed semester opens a new row).
  `academicProgression.js` evaluates a student's currently-open semester against real final grades
  only (never calendar dates): all-graded + 0 failures → Passed + auto-advance; failures within an
  admin-configurable `maxFailedCoursesForProgression` policy (`/settings/semester-progression-policy`,
  default 1) still advance (flagged Probation, failed courses tracked as repeats — one failed course
  never fails the whole semester by default); over the threshold → Failed, blocked pending a manual
  decision; not yet fully graded → Awaiting Results. Reaching a program's `totalCredits` (or its new
  `numberOfSemesters` cap) after a pass marks the student Graduation Eligible instead of opening a
  new semester. `students.Progress` permission (registrar/records_officer/admin) gates
  evaluate/override/bulk-evaluate-term endpoints (`/api/progression/*`); every manual override
  requires a reason and is audit-logged with before/after state. Student Profile page gained an
  "Academic Progression" panel (current semester, academic year, batch/admission year, semester
  status, GPA/credits/failed-course stats, full semester history table, Evaluate/Override actions)
  and a lightweight `studentStatus` field (Active/Graduated/Suspended/Withdrawn/On Leave) — a
  partial, display-focused implementation of the fuller "Student status lifecycle" item in §3.1,
  not a replacement for it (no status-change history/effects like blocked enrollment yet).

### 2.9 Administration & operations
- ✅ Reports (admin): room utilization, course popularity, teacher workload, enrollment trends (charts)
- ✅ Backup export / restore (whole database)
- ✅ Branding: institution name + logo upload, shown in-app
- ✅ Global search; toasts; dark/light theme; dashboard
- ✅ Account data export (`accountExport.js`)

### 2.10 Desktop delivery & commercial
- ✅ Electron packaging: NSIS one-click installer, desktop/start-menu shortcuts
- ✅ Auto-updates via GitHub releases (`hamidsaboor94-ux/unischeduler-releases`), `ship.mjs` pipeline
- ✅ RSA license-key activation gate (keygen + `make-license.mjs` tooling)
- ✅ Embedded vs client (shared LAN server) mode with first-launch setup UI

### 2.11 Quality
- ✅ Backend test suite (`node --test`): auth, accounts, CRUD, enrollment, scheduling,
  timetable import, role scoping, rate limiting, audit log, notices (13 test files)
- ✅ Linting (oxlint) on the frontend

### 2.12 University-wide announcements & targeted notifications *(2026-07-26)*
- ✅ New `notices`/`notice_target_groups`/`notice_recipients`/`notice_attachments` tables
  (`api/src/db.js`) — additive, entirely separate from the pre-existing per-course
  `announcements` table (courseId → students, no title/scheduling), which is untouched and still
  used by course quick-actions.
- ✅ Server-side targeting engine (`api/src/noticeTargeting.js`): audience = Students / Faculty /
  Staff / Roles / Specific Users, each with a whitelisted filter set resolved against real data
  (department/college/program/semester/section/enrollment status/course for students; department/
  college/designation/employment type/status/course for faculty; role + department/college for
  staff). Multiple target groups per announcement, deduplicated to one notification per person.
  Department Head/Dean targeting is confined to their own scope server-side (reuses `scope.js`),
  never merely hidden in the UI.
- ✅ Recipient snapshot at publish time (`api/src/noticePublish.js`) — a scheduled/published
  announcement's audience is frozen, not re-evaluated live; delivers via the existing
  `notifications` table/bell (`notice_published` type) plus its own richer per-recipient
  delivered/read/acknowledged tracking.
- ✅ Full lifecycle: draft → schedule/publish → expire/archive/cancel, duplicate (always restarts
  as an unpinned draft), edit-after-publish with an explicit opt-in "notify recipients about this
  update" (never implicit resend). Reliable scheduling/expiry via an in-process interval sweep
  (`api/src/noticeScheduler.js`), not dependent on a browser being open.
- ✅ Optional attachments (disk-backed, same pattern as `course_materials`), optional
  acknowledgment requirement with aggregate + per-recipient analytics, optional in-app action
  button (destination is a real `NavigationContext` section, never a raw URL).
- ✅ New `announcements` permission module (`Announcement.View/Create/Update/Delete/Publish/
  Schedule/Archive/ManageRecipients/ViewAnalytics`) — Registrar/Dean/Dept Head get write (scope-
  limited for the latter two), Viewer read-only; every role, regardless of this policy, can
  always read/acknowledge notices addressed to them via self-scoped `/notices/me/*` endpoints
  (same pattern as `/finance/me`).
- ✅ Frontend: `Announcements` page (sidebar item for every role) with a Manage view (tabs,
  search, compact create/edit card with a live recipient-count preview) for permitted roles, and
  a personal "My Announcements" feed for everyone; bell-notification click jumps straight to the
  specific announcement.
- Deferred: Email/SMS/push delivery channels (architecture supports adding them; only in-app is
  implemented per the "prioritize in-app first" decision), a rich WYSIWYG editor (message support
  is a small XSS-safe markdown-like subset — bold/italic/lists/links — not a toolbar).

---

## 3. Requirements — TO DO (recommended)

Priorities: **P1** = core gap for a real university deployment · **P2** = strong value, next wave ·
**P3** = later / depends on direction. Items marked ❓ need your decision first (§6).

### 3.1 Registrar & academic records
- ⬜ **P1 — Transcript generation**: official per-student transcript (all terms, courses, grades,
  GPA per term + cumulative), printable/PDF, with branding.
- ⬜ **P1 — Academic calendar**: term dates, holidays, registration window, add/drop deadline,
  exam period; enrollment endpoints should enforce the registration window.
- 🔶 **P1 — Student status lifecycle**: active / on-leave / suspended / graduated / withdrawn,
  with status history and effects (e.g. blocked enrollment). *(2026-07-27: the status values and
  a display field exist — `student_profiles.studentStatus`, editable, shown on Student Profile —
  as a byproduct of automatic semester progression (§2.8). Still missing: change history, and any
  actual effects like blocking enrollment/finance actions for a Suspended/Withdrawn student.)*
- ⬜ **P1 — Programs / majors & curriculum** *(decided 2026-07-19: full model)*: named degree
  programs per department with a semester-by-semester curriculum plan; degree-audit view
  (taken vs required vs remaining).
- ⬜ **P1 — Course sections** *(decided 2026-07-19: full model)*: multiple sections of the same
  course in one term (different teacher/time), enrollment per section.
- ⬜ **P2 — Credit-load rules**: min/max credits per student per term, enforced at enrollment.
- ⬜ **P2 — Repeat/retake policy**: how a retaken course affects GPA (replace vs average).
- ⬜ **P3 — Graduation clearance workflow**: checklist (credits, GPA, documents, finance) → mark
  graduated → appears in alumni list.

### 3.2 Scheduling engine
- ⬜ **P1 — Teacher availability constraints**: per-teacher available days/times; conflict
  detection and auto-tools must respect them.
- ⬜ **P1 — Full automatic timetable generation** *(decided 2026-07-19: must-have)*: one-click
  generator that places all course slots for a term given rooms, teacher availability, and
  course hours (constraint solver; today only exams auto-schedule and conflicts auto-resolve).
  Depends on teacher availability + room features landing first.
- ⬜ **P2 — Room features**: tag rooms (lab, projector, capacity type) and match course needs.
- ⬜ **P3 — Makeup classes**: schedule a replacement session tied to a cancelled slot exception,
  notifying the enrolled students.

### 3.3 Finance *(decided 2026-07-19: full module in scope)*
- ⬜ **P1 — Tuition & fees module**: fee structures per program/term, student invoices, payment
  recording (cash/receipt no.), balance & defaulter reports, finance clearance flag (blocks
  enrollment/graduation when unpaid, configurable). Likely needs a new `finance` role (or
  admin sub-permission) — decide when designing the module.

### 3.4 Communication
- ⬜ **P2 — Email beyond admissions**: reuse the existing SMTP mailer for schedule changes,
  grade posting, announcements (digest), waitlist promotion.
- ⬜ **P3 — SMS gateway** (local providers — relevant where email penetration is low). ❓
- ⬜ **P3 — In-app messaging** (student ↔ faculty threads).

### 3.5 Exams & assessment
- ⬜ **P2 — Exam seating & invigilation**: assign invigilators, capacity-aware room splits,
  printable seating/attendance sheets.
- ⬜ **P2 — Grade publishing workflow**: draft → published so students don't see half-entered
  grades; lock a term's grades after publication.
- ⬜ **P3 — Online quizzes** inside the app. ❓ (big scope; likely out for a desktop-first tool)

### 3.6 Reporting & documents
- ⬜ **P1 — Printable outputs**: timetable per room / per teacher / per department (print CSS or
  PDF), class rosters, attendance sheets — universities live on printed lists.
- ⬜ **P2 — Attendance analytics**: per-student percentage vs a configurable threshold,
  exam-eligibility (e.g. barred under 75%), faculty/admin warnings.
- ⬜ **P2 — Exportable CSV/Excel** for every major table (users, enrollments, grades…).
- ⬜ **P3 — Custom certificate/letter templates** (enrollment certificate, character letter).

### 3.7 Platform, security & operations
- ⬜ **P1 — Scheduled automatic backups** (embedded mode: rotate N copies locally; warn on
  failure) — a single SQLite file on one PC is the biggest data-loss risk today.
- ⬜ **P1 — DB migration strategy**: versioned migrations instead of ad-hoc `CREATE TABLE IF NOT
  EXISTS` + ALTERs, so updates never corrupt production data.
- ⬜ **P2 — Server deployment story** for client mode: a documented/packaged way to run the API
  as a Windows service on the "server PC" (currently implicit), plus JWT secret handling.
- ⬜ **P2 — Frontend test coverage**: at least smoke tests for critical flows (login, enroll,
  grade entry); CI to run API + frontend tests.
- 🔶 **P2 — Pagination/virtualization** for large tables (users, enrollments) — matters at
  real-university scale (thousands of students). *(2026-07-27: the Students page now does real
  server-side pagination — see §2.8 — the first table in the app to get it. Users/enrollments and
  everything else still load unpaginated.)*
- ⬜ **P1 — Web (browser) deployment** *(decided 2026-07-19: cloud/web is the target)*: host the
  API + serve the React build over HTTPS so students/faculty log in from any browser. Implies:
  production CORS allowlist, real JWT secret management, uploaded-file storage strategy,
  SQLite-at-scale review (consider WAL/Postgres), and deciding per-university hosting vs
  multi-tenant SaaS (open question §6.1b).
- ⬜ **P3 — Session refresh**: silent token renewal so an 8h JWT doesn't log users out mid-work.

### 3.8 Centralized authorization *(2026-07-22)*
Fixed three reported symptoms of scattered role checks (faculty reaching admin course-edit,
raw 403s in toasts, and a Registrar-enrollment claim that turned out to already work — verified
live before assuming it needed a fix):
- ✅ **Central `requirePermission('Module.Action')`** (`api/src/authz.js`) — granular permissions
  tables (`permissions`, `role_permissions`, `user_roles`, `user_scopes`), additive and seeded
  from the existing module-level POLICY so day-one access is unchanged. Coexists with the legacy
  `can()`/`requireModuleAccess` — routes migrate one at a time, starting with `courses.js`'s
  write routes (Create/Update/Delete), including server-side department scope validation.
- ✅ **Richer audit log**: `audit_log` gained `role`/`oldValue`/`newValue` columns; `logAudit()`
  takes optional before/after state (wired into the migrated courses.js routes). Still immutable
  — no update/delete route exists.
- ✅ **Soft-delete for enrollments**: `DELETE /enrollments/:id` now marks `status='dropped'` +
  `deletedAt` instead of removing the row. Scoped narrowly to this one route — NOT the
  course-deletion cascade, which still needs a real delete to avoid an FK violation.
- ✅ **Frontend UI-gap fix**: every page stays mounted with no role check in the nav layer
  (`?section=` URL param trusts the client) — `RoomForm`/`DepartmentForm`/`TermForm`/
  `CreateAccountForm` now disable inputs and hide Save for a role without write access,
  matching the pattern `CourseForm.jsx` already had. `api.js` gives a clear message instead of
  a bare "Forbidden" when a 403 does surface.
- ⬜ Not done this pass: migrating the other ~15 `requireRole`/inline-role-check routes to the
  new system, full `Module.Action` verbs beyond CRUD (e.g. `Grades.Approve` — no workflow state
  exists yet to back it), and fixing the underlying URL-param navigation trust issue itself
  (still relies on server-side checks + now-consistent client-side disabling, not a real fix to
  `NavigationContext`'s lack of role gating).

### 3.9 Polish / debt
- ⬜ Native-speaker review pass for Pashto/Dari strings (carry-over from 2.2)
- ⬜ Replace boilerplate `README.md` in `UniScheduler-react` with a real project README
- ⬜ Error/empty/loading states audit across all pages
- ⬜ User manual (per role, ideally trilingual) + in-app help

---

## 4. How we work from this document

1. **Discuss** — resolve the ❓ decisions in §6; reprioritize §3 together.
2. **Implement** — pick items top-down by priority; each item gets designed, built, tested.
3. **Check off** — when an item ships (code + test + verified in the running app), flip it to ✅
   with a one-line note of where it lives.
4. **Audit** — periodically compare the running app against §2 to catch regressions or
   undocumented behavior; anything found is added here first.

---

## 5. Roadmap (agreed direction)

Decisions of 2026-07-19 set an ambitious scope: cloud/web delivery, full finance, full academic
model (programs + sections), and a real auto-scheduler. Suggested order of attack — foundations
before features, because programs/sections and web deployment change the ground everything else
stands on:

1. **Foundations**: DB migrations (3.7) → programs/majors + course sections schema (3.1) →
   academic calendar (3.1). Do these first; retrofitting them later is far more expensive.
2. **Web deployment** (3.7): hosted API + browser build, HTTPS, secrets, file storage, backups.
3. **Registrar wave**: transcripts, degree audit, student lifecycle, printable outputs.
4. **Finance module** (3.3) — after programs exist, since fee structures hang off them.
5. **Scheduling engine**: teacher availability + room features → automatic timetable generation.
6. Continuous: email notifications, exports, tests/CI, i18n review, user manual.

---

## 6. Open questions

### Decided (2026-07-19)
| # | Question | Decision |
|---|---|---|
| 1 | Deployment target | **Cloud / web app** — browser access for students & faculty; desktop app becomes secondary |
| 2 | Finance module | **Yes — full module** (fees, invoices, payments, balances, clearance) |
| 3 | Academic model | **Full model** — programs/majors + curriculum + degree audit + multi-section courses |
| 4 | Automatic timetable generation | **Must-have** (after teacher availability + room features) |

### Still open
| # | Question | Why it matters |
|---|---|---|
| 1b | Cloud model: one hosted instance **per university**, or one **multi-tenant SaaS** serving many? | Multi-tenancy changes auth, schema, licensing, and pricing fundamentally — biggest unanswered question |
| 1c | Does the Electron desktop app stay supported (as a client to the cloud), or is it retired? | Determines whether embedded mode / installer / auto-update keep being maintained |
| 5 | Online quizzes/exams — in scope? | Big LMS expansion vs staying scheduling-centric |
| 6 | SMS notifications for the target market? | Needs a local gateway provider + credits |
| 7 | Who are the real target customers (private universities in Afghanistan? size?) | Calibrates scale targets, hosting location, language priority |
| 8 | Database at cloud scale: stay on SQLite or migrate to PostgreSQL? | `node:sqlite` is fine per-instance; multi-tenant or high-concurrency hosting favors Postgres |
