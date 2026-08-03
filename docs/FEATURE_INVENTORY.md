# UniScheduler — Feature Inventory

> Generated from a full source audit (routes, database schema, frontend pages) on 2026-07-30,
> updated 2026-08-02 (added Graduation / Degree Issuance), cross-checked against
> [PROJECT-PROGRESS.md](../PROJECT-PROGRESS.md)'s requirements ledger.
> **This document describes what exists in code today**, not the roadmap — for planned/future
> work and open decisions, see PROJECT-PROGRESS.md §3/§6. Where the two disagree, this file
> follows the code.

---

## Authentication & Accounts

**Status**: Completed

**Implemented**:
- JWT login (8h expiry), no public self-registration — every account admin-created
- One-time temporary passwords + forced password change on first login (`mustChangePassword`)
- Self-service password change (requires current password) and profile edit (name/email)
- Admin password reset for any user; bulk CSV account import
- Auth rate limiting (login / set-password / change-password)
- 12-role system (`admin, registrar, admissions_officer, dept_head, dean, exam_officer,
  records_officer, bursar, viewer, advisor, faculty, student`) — see [RBAC_MATRIX.md](RBAC_MATRIX.md)
- Auto-generated ID numbers per role (`users.idNumber`)
- Per-user language persistence (`users.language`)

**Missing**: silent JWT refresh (8h session currently ends abruptly, forcing re-login mid-work).

**Database**: `users`, `permissions`, `role_permissions`, `user_roles`, `user_scopes`
**API**: `POST /auth/login`, `GET /auth/me`, `PUT /auth/set-password`, `PUT /auth/profile`,
`PUT /auth/language`, `PUT /auth/change-password`, `/users/*`
**Frontend**: `AuthScreen.jsx`, `SetPasswordScreen.jsx`, `UsersPage.jsx`,
`modal/CreateAccountForm.jsx`, `modal/ResetPasswordForm.jsx`, `modal/ProfileModal.jsx`

---

## Internationalization

**Status**: Completed (native-speaker translation review still open)

**Implemented**:
- Trilingual UI: English, Pashto (`ps`), Dari (`prs`); per-user language persisted server-side
- RTL support via logical CSS properties (never `left`/`right` for layout)
- 16 i18n namespace files per locale, confirmed 1:1 parity across all three

**Missing**: native-speaker review pass for Pashto/Dari translation accuracy (flagged, not verified).

**Database**: `users.language`
**API**: `PUT /auth/language`
**Frontend**: `src/i18n/`, `LanguageSwitcher.jsx`

---

## Academic Structure

**Status**: Partial (core CRUD complete; full programs/curriculum/sections model incomplete)

**Implemented**:
- Departments (CRUD), Colleges (CRUD, currently hidden in UI via a feature flag —
  single-institution deployment)
- Programs — basic entity exists (`programs` table: department, degree level, total credits,
  number of semesters) with CRUD routes, wired into student profiles, courses, and fee scoping
- Curriculum Management — **Phase 1 only** (2026-08-02): schema for a versioned,
  semester-by-semester curriculum plan (`curriculum`/`curriculum_semester`/`elective_group`/
  `curriculum_course`/`student_curriculum`, plus a generic `holds` table) and one read-only
  report (`GET /api/reports/curricula/:id/structure`) rendering Program → Version → Semester →
  Courses. No authoring UI, no validators (prerequisite/credit-limit/elective-count checks against
  a curriculum), and no students are assigned yet (`student_curriculum` intentionally left empty
  pending a grandfather-rule decision) — see PROJECT-PROGRESS.md §3.1. Still **no** degree-audit
  view (taken vs. required vs. remaining).
- Terms/semesters: CRUD, single active term, term rollover (copy structure into a new term),
  registration window fields (`registrationOpensAt/ClosesAt`) exist on the table but are not yet
  enforced at enrollment
- Teachers (CRUD), Rooms (CRUD, type + capacity)
- Faculty full HR profile: personal/employment details, repeatable education/experience/
  certification history with verification workflow, photo + document uploads
- Courses: CRUD, bulk import, department/term/teacher binding, capacity
- `course_offerings` table exists (term-specific teacher/room/section/cap binding, backfilled
  from `courses`) as groundwork for multi-section courses, but sections are not yet a first-class
  enrollment unit — enrollment is still keyed to `courses`, not `course_offerings`
- Course prerequisites (AND/OR groups + corequisite type), enforced at enrollment
- Grading scale (configurable letter-grade bands) + GPA grade points
- Graduation requirement setting (credit threshold)

**Missing**: curriculum authoring UI + validators, degree-audit model, real multi-section course
support (enrollment per section), academic calendar (holidays/add-drop deadline/exam period) with
enforcement, credit-load min/max rules, repeat/retake GPA policy.

**Database**: `departments`, `colleges`, `programs`, `terms`, `teachers`, `teacher_profiles`,
`teacher_education`, `teacher_experience`, `teacher_certifications`, `teacher_documents`,
`rooms`, `courses`, `course_offerings`, `course_prerequisites`, `curriculum`,
`curriculum_semester`, `elective_group`, `curriculum_course`, `student_curriculum`, `holds`,
`settings` (gradingScale, graduationRequirement)
**API**: `/departments`, `/colleges`, `/programs`, `/terms`, `/teachers`, `/teacher-profile/*`,
`/rooms`, `/courses/*`, `/settings/grading-scale`, `/settings/graduation-requirement`,
`/reports/curricula[/:id/structure]`
**Frontend**: `DepartmentsPage.jsx`, `SemestersPage.jsx`, `TeachersPage.jsx`,
`TeacherProfilePage.jsx`, `FacultyOnboardingPage.jsx`, `RoomsPage.jsx`, `CoursesPage.jsx`,
`GradingScalePage.jsx`

---

## Scheduling & Timetabling

**Status**: Partial (manual + assisted scheduling done; full auto-generation not built)

**Implemented**:
- Weekly timetable slots (day, time, duration, room, course) with CRUD
- Slot exceptions (cancel / one-off reschedule for a specific date)
- Conflict detection (room/teacher/time collisions) + dedicated Conflicts page
- Available-rooms and available-times finders; conflict auto-resolve
- Exams: CRUD + exam auto-scheduling
- PDF timetable import (client-side pdf.js parse → preview → confirm → reset)
- Weekly calendar view; personal schedule ("My Schedule") for students/faculty

**Missing**: per-teacher availability constraints (not modeled or enforced), full one-click
automatic timetable generation (constraint solver placing all course slots for a term — today
only exams auto-schedule and conflicts auto-resolve, not the full weekly grid), room feature
tagging (lab/projector/capacity type) for constraint matching, makeup-class scheduling tied to a
cancelled slot.

**Database**: `timetable_slots`, `slot_exceptions`, `exams`, `rooms`
**API**: `/slots/*`, `/slot-exceptions/*`, `/exams/*`, `/conflicts/*`, `/timetable-import/*`
**Frontend**: `TimetablePage.jsx`, `ExamsPage.jsx`, `ConflictsPage.jsx`, `WeeklyCalendar.jsx`,
`MySchedulePage.jsx`

---

## Enrollment & Eligibility

**Status**: Completed

**Implemented**:
- Student self-enrollment from catalog: capacity check, waitlist, prerequisite check,
  time-conflict prevention, duplicate prevention
- Drop/withdraw course (soft-delete: `status='dropped'` + `deletedAt`); admin/registrar
  enrollment management (individual or bulk-by-semester, capacity-aware, audit-logged)
- Prerequisite eligibility engine (`api/src/eligibility.js`) — single source of truth for both
  catalog display and enroll-time enforcement: AND/OR prerequisite groups, corequisite
  (concurrent-enrollment) support, section/term-aware completion history, program/department/
  term/financial-hold/credit-cap gates, atomic capacity check
- Student Catalog shows Eligible / Currently Enrolled / Completed / Not Yet Eligible / Not
  Offered with per-prerequisite ✓/✗ and a locked-course reason

**Missing**: registration window enforcement at the enrollment endpoint (the `terms` table has
the date fields but they aren't checked yet — see Academic Structure); credit-load min/max
enforcement; repeat/retake GPA policy.

**Database**: `enrollments`, `course_prerequisites`, `courses`
**API**: `/enrollments/*`, `/students/me/eligible-courses`, `/courses/:id/eligible-students`
**Frontend**: `CatalogPage.jsx`, `EnrollmentPage.jsx`, `MySchedulePage.jsx`,
`modal/EnrollStudentsModal.jsx`

---

## Admissions

**Status**: Completed (email delivery deferred, not built out)

**Implemented**:
- Public application form (no login) with document upload, rate-limited
- Admin review queue: view, edit, status changes, approve → auto-creates student account
- Optional SMTP email to applicants (credentials + status changes) — code exists in
  `mailer.js` but no-ops silently without `SMTP_HOST` configured (deliberately deferred)
- Financial aid fields on an application (`aidType/aidBasis/aidValue/aidReason`) feeding into
  `student_financial_aid` at approval time

**Missing**: SMTP is not actually configured/deployed anywhere yet — email delivery is dormant
code, not a live feature for end users.

**Database**: `applications`, `application_documents`
**API**: `/applications/*`
**Frontend**: `ApplicationsPage.jsx`, `PublicApplicationForm.jsx`, `PublicEntryScreen.jsx`,
`modal/ApplicationApproveModal.jsx`, `modal/ApplicationStatusChangeModal.jsx`

---

## Teaching / LMS

**Status**: Completed

**Implemented**:
- Assignments: faculty create; students submit files/text; faculty view/grade submissions
- Announcements (per-course, faculty/admin post, students see) — distinct table/system from the
  university-wide Notices module below
- Course materials (file upload/download)
- Attendance: faculty bulk marking per session; student "My Attendance" self-service view
- Gradebook: weighted grade items + per-student scores; department grade summary; student
  "My Grades" view with GPA
- Two independent unread mechanisms: notification bell (`notifications`) and per-course
  activity dot (`course_activity_reads`) — by design, not a bug
- Course quick-actions for faculty (assignments/announcements/roster/attendance/gradebook)
- Faculty landing dashboard (My Courses/My Students/My Exams stat cards, today's sections,
  "Needs your attention" unscheduled-exam panel) — no new backend surface, reuses existing
  ownership-scoped queries

**Missing**: grade-publishing draft→published workflow (students currently see grades as soon
as entered, no lock-after-publication step); email notification digest for grade posting.

**Database**: `assignments`, `assignment_submissions`, `announcements`, `course_materials`,
`course_activity_reads`, `grade_items`, `grade_scores`, `notifications`
**API**: `/assignments/*`, `/announcements/*` (course-scoped), `/materials/*`, `/attendance/*`,
`/grades/*`, `/course-activity/*`, `/notifications/*`
**Frontend**: `GradebookPage.jsx`, `AttendancePage.jsx`, `MyAttendancePage.jsx`,
`MyGradesPage.jsx`, `modal/CourseActionsModal.jsx`, `modal/RosterModal.jsx`,
`components/FacultyDashboard.jsx`

---

## Student Records

**Status**: Partial (profile/documents/transcript/progression/graduation done; status-change
history and enforcement effects still open)

**Implemented**:
- Student profile (admin-managed fields vs. self-editable fields split), document uploads,
  profile print stylesheet
- Student landing dashboard — GPA, fee balance/hold status, attendance rate, enrolled-course
  count, today's classes, recent announcements
- Student Management: server-paginated, filterable directory (college/program/student type/
  batch/status/course/admission date/search), CSV export, scoped bulk edits (status/department/
  program), photo avatar support, table/card view toggle
- Automatic semester progression: append-only `semester_records` ledger per attempt,
  `academicProgression.js` evaluates real final grades (never calendar dates) into
  Passed/Probation/Failed/Awaiting Results/Graduation Eligible, admin-configurable
  `maxFailedCoursesForProgression` policy, manual override with mandatory reason + audit log
- A lightweight `studentStatus` display field exists
  (Active/Graduated/Suspended/Withdrawn/On Leave) on the profile — a partial implementation of
  the fuller status-lifecycle item below; the `Graduated` value is now reachable only through the
  gated confirm flow in the **Graduation / Degree Issuance** module below, not a direct edit
- Transcript generation: per-term + cumulative GPA, self-service and staff drill-down views,
  print-based output (no PDF library — `window.print()` + print CSS)
- Student Advisor role: assigned-advisee roster and read access, scoped via
  `student_profiles.advisorTeacherId`

**Missing**: full student status lifecycle — status **change history** and actual **effects**
(e.g. blocking enrollment/finance actions for a Suspended/Withdrawn student) are not implemented;
`studentStatus` today is just an editable display field with no workflow behind it (aside from the
now-gated `Graduated` transition). Also missing: a dedicated per-student add/drop enrollment UI
(currently reuses the course-centric enroll modal by design).

**Database**: `student_profiles`, `student_documents`, `semester_records`
**API**: `/student-profile/*`, `/progression/*`, `/students/*`, `/transcript/*`
**Frontend**: `StudentProfilePage.jsx`, `StudentsPage.jsx`, `StudentDetailPage.jsx`,
`TranscriptPage.jsx`, `AdviseesPage.jsx`, `components/StudentDashboard.jsx`,
`components/StudentAvatar.jsx`, `components/StudentPhotoUpload.jsx`

---

## Graduation / Degree Issuance

**Status**: Completed (2026-08-02)

**Implemented**:
- Eligibility worklist (`GET /api/graduation/eligible`): every student with
  `semesterStatus = 'Graduation Eligible'` and not already `Graduated`, each row annotated with
  live financial-clearance state (`financiallyCleared`, `outstandingBalance`, `blockedReason`) by
  reusing `finance.js`'s existing balance-computation logic, not reimplementing it
- Confirm & confer (`POST /api/graduation/confirm/:studentId`): single-transaction action that
  re-reads eligibility and financial balance fresh from the DB (never trusts the client) — 409 if
  not eligible, 422 with `code: 'FINANCE_HOLD'` (and zero partial writes) if a balance is
  outstanding — then sets `studentStatus='Graduated'`, records the degree, and writes an
  `audit_log` entry (`graduation-confer`); idempotent — a repeat call for an already-graduated
  student returns the existing record (200) instead of erroring or double-issuing
- Certificate PDF (`GET /api/graduation/certificate/:studentId`): pdfkit-generated diploma
  (landscape A4, branded with org name/color/logo from Settings); self-or-staff access, same
  self-or-module-read pattern as `transcript.js`; 404 before conferral
- New `graduation_records` table — one canonical row per conferred degree, with a generated
  unique certificate number (`CERT-<year>-<row id>`); the previously-dead
  `student_profiles.graduationStatus`/`graduationDate`/`degreeAwarded` columns are now actually
  written, mirrored from this table
- New `graduation` RBAC module (registrar, records_officer — WRITE only; no other role, including
  admin's usual READ-granted roles, has any access)
- Closed a pre-existing gap: `studentStatus` could previously be set to `'Graduated'` with no
  eligibility check via `PUT /api/student-profile/:studentId` or `PUT /api/students/bulk`; both
  now reject that value (400 Bad Request) — `Graduated` is reachable only through the confirm
  endpoint above

**Missing**: no dedicated alumni directory/list view — a graduated student is visible only through
the existing Student Management directory, filtered by status.

**Database**: `graduation_records`; `student_profiles.graduationStatus`/`graduationDate`/`degreeAwarded`
**API**: `/graduation/*`
**Frontend**: `GraduationPage.jsx`; `StudentProfilePage.jsx` (conferred-degree display +
certificate download)

---

## Finance

**Status**: Completed (core module — full per the 2026-07-19 "full finance module" decision)

**Implemented**:
- Hierarchical fee-rate resolution: `fee_rules` at University/College/Department/Program ×
  Student Type granularity, with a legacy `term_fee_config` per-credit fallback still supported
- Fixed fee items per term (admission/library/lab/etc.), scoped and student-type-aware
- Student financial aid (percentage or fixed, active/revoked, tied to admissions aid decisions)
- Charge generation per term (`finance_transactions` type `'charge'`, itemized in
  `finance_charge_lines` with a snapshot of which rule computed each rate)
- Payments (recording, void/reversal, receipts with snapshot), installment plans
  (`fee_plans`/`fee_plan_installments`/`installments`) with overdue/upcoming tracking
- Full ledger (`finance_transactions`: charge/payment/adjustment/refund/aid) as the source of
  truth for balances — never a derived/cached balance
- Student self-service fee statement (`/finance/me`), staff full statement view, receipt download
- Bursar landing dashboard: aging report, today's collections, recent activity, term summary,
  overdue/upcoming installments — dedicated aggregate endpoints, not raw table dumps
- Financial-hold gating referenced by the eligibility engine (enrollment) and exam access

**Missing**: nothing tracked as outstanding in PROJECT-PROGRESS.md for this module beyond
general platform items (e.g. printable receipts already covered; no further finance-specific
gaps flagged).

**Database**: `fee_rules`, `fee_items`, `term_fee_config`, `student_financial_aid`, `payments`,
`finance_transactions`, `finance_charge_lines`, `fee_plans`, `fee_plan_installments`,
`installments`, `scholarships` (legacy, superseded), `student_types`
**API**: `/finance/*`, `/student-types/*`
**Frontend**: `FinancePage.jsx`, `MyFeesPage.jsx`, `components/finance/*`,
`components/BursarDashboard.jsx`, `ReceiptView.jsx`, `FeeConfigDrawer.jsx`

---

## University-wide Announcements & Notices

**Status**: Completed (in-app channel only — other delivery channels deferred)

**Implemented**:
- Targeting engine: audience = Students/Faculty/Staff/Roles/Specific Users, each with a
  whitelisted, server-validated filter set (department/college/program/semester/section/
  enrollment status/course for students; equivalent for faculty/staff); multiple target groups
  per notice, deduplicated to one notification per person; Dean/Dept Head targeting confined to
  their own org scope server-side
- Recipient snapshot frozen at publish time (not re-evaluated live), delivered via the shared
  `notifications` bell plus its own richer per-recipient delivered/read/acknowledged tracking
- Full lifecycle: draft → schedule/publish → expire/archive/cancel, duplicate (always restarts
  as an unpinned draft), edit-after-publish with an explicit opt-in "notify recipients" resend
- Reliable scheduling/expiry via an in-process interval sweep (`noticeScheduler.js`), not
  dependent on a browser session being open
- Optional disk-backed attachments, optional acknowledgment requirement with analytics, optional
  in-app action button (points at a real app section, never a raw URL)
- Dedicated `announcements.*` granular permission module (View/Create/Update/Delete/Publish/
  Schedule/Archive/ManageRecipients/ViewAnalytics)

**Missing**: email/SMS/push delivery channels (architecture supports adding them; only in-app is
implemented), a rich WYSIWYG editor (message support is a small XSS-safe markdown-like subset).

**Database**: `notices`, `notice_target_groups`, `notice_recipients`, `notice_attachments`
**API**: `/notices/*`
**Frontend**: `AnnouncementsPage.jsx`, `NoticeComposer.jsx`, `NoticeTargetingBuilder.jsx`

---

## Custom Report Builder & Export

**Status**: Completed

**Implemented**:
- Deterministic, whitelist-driven query engine (`reportEntities.js`/`reportBuilder.js`) — six
  reportable entities (students, courses, enrollments, attendance, finance transactions,
  admissions applications); no raw SQL/table/column name from the client, filter values always
  parameterized
- Saved, reusable report definitions (`report_definitions`), re-validated against the current
  whitelist on every run
- Running a report is a GET (available to read-only roles); saving/editing/deleting a
  definition needs write access
- PDF export (pdfkit, hand-drawn bar/line charts, 300-row cap per file with a note pointing at
  Excel for more) and Excel export (exceljs, real typed uncapped rows) sharing one renderer
  (`reportExport.js`) over the same `{title, columns, rows, chart}` shape the query engine
  already returns — never a second query path
- The live Analytics tab (5 named dashboard charts: room utilization, course popularity, teacher
  workload, enrollment trends, admissions summary) shares the same query/export path via
  `dashboardAnalytics.js`/`dashboardExport.js`
- Export routes are all GETs behind the same read permission as viewing — no new permission
  needed to export what you can already view

**Missing**: nothing tracked as outstanding for this module.

**Database**: `report_definitions`
**API**: `/reports/*`
**Frontend**: `ReportsPage.jsx`, `components/reports/CustomReportBuilder.jsx`

---

## Approvals (generic engine) / Appeals

**Status**: Partial (engine is generic and complete; only one flow — Appeals — is wired up)

**Implemented**:
- Generic multi-step approval-chain engine (`approvalEngine.js`): request types register an
  ordered reviewer-role chain (`approval_chain_steps`), requests move through steps
  (`approval_requests`), each decision recorded (`approval_decisions`)
- One registered flow today: **Appeals** (`appealsFlow.js`) — 2-step chain (course's own
  instructor → registrar), submit/view/decide/cancel/resubmit
- Reviewer eligibility checked against the requester's full role set (primary + secondary
  `user_roles`) — the one place secondary roles are actually consumed

**Missing**: no other request types are registered on the engine yet (e.g. leave requests,
grade-change requests) despite the engine supporting them generically.

**Database**: `approval_requests`, `approval_chain_steps`, `approval_decisions`
**API**: `/approvals/*`
**Frontend**: `ApprovalsPage.jsx`, `MyAppealsPage.jsx`

---

## Administration & Operations

**Status**: Partial (core admin tools complete; scheduled/automated backups not built)

**Implemented**:
- Reports (admin): room utilization, course popularity, teacher workload, enrollment trends
  (recharts)
- Backup export / restore (whole database, manual/admin-triggered)
- Branding: institution name + logo upload, shown in-app, one-time setup flow for a fresh admin
- Global search; toast notifications; dark/light theme; role-based landing dashboard
- Account data export (`accountExport.js`)
- Audit log (admin-viewable), with actor role + before/after JSON state on migrated routes
- System health check endpoint (admin-only)
- Super Admin system reset (wipes operational data, requires a typed confirmation phrase)

**Missing**: scheduled automatic backups (currently manual-only — a single SQLite file is the
biggest data-loss risk today), versioned DB migration system (schema changes are still ad hoc
`CREATE TABLE IF NOT EXISTS` + `ALTER`), production server-deployment story for client/LAN mode
(no packaged Windows-service story yet), silent JWT refresh, error/empty/loading-state audit
across all pages, user manual / in-app help.

**Database**: `audit_log`, `settings`
**API**: `/audit-log`, `/backup/*`, `/settings/branding*`, `/system-health`,
`/super-admin/system-reset`
**Frontend**: `AuditLogPage.jsx`, `BackupPage.jsx`, `BrandingSettingsPage.jsx`, `GlobalSearch.jsx`,
`ToastContainer.jsx`

---

## Centralized Authorization (RBAC infrastructure)

**Status**: Partial (deliberately incomplete — an in-progress migration, not a stalled one)

**Implemented**: see [RBAC_MATRIX.md](RBAC_MATRIX.md) for full detail —
- Central `requirePermission('Module.Action')` system (`authz.js`) with granular permission
  tables, seeded from the legacy POLICY so day-one access is unchanged; coexists with the legacy
  `can()`/`requireModuleAccess`; routes migrate one at a time (`courses.js` write routes,
  `notices.js`, `progression.js`, `teacherProfile.js` migrated so far)
- Richer audit log (`role`/`oldValue`/`newValue` columns), immutable (no update/delete route)
- Soft-delete for enrollments (`status='dropped'` + `deletedAt`) instead of hard delete
- Frontend UI-gap fix: write forms (Room/Department/Term/CreateAccount) disable inputs/hide Save
  for roles without write access, matching the pattern `CourseForm.jsx` already had; friendlier
  403 messaging in `api.js`
- 2026-07-28 hardening pass: fixed teacher/student profile PII exposure, Viewer over-reach on
  finance/audit, `?section=` navigation gap; full 12-role security audit completed

**Missing**: migrating the remaining ~15 `requireRole`/inline-role-check routes to the granular
system; full `Module.Action` verb coverage beyond CRUD (e.g. a `Grades.Approve` workflow state
doesn't exist yet); `user_scopes` table is seeded but not actually read/enforced anywhere (see
RBAC_MATRIX.md §6); the underlying `?section=` URL-param client-trust issue is mitigated
(consistent disabling + server-side checks) but not structurally fixed.

**Database**: `permissions`, `role_permissions`, `user_roles`, `user_scopes`, `audit_log`
**API**: cross-cutting (`authz.js` middleware used across multiple route files)
**Frontend**: `src/permissions.js` (hand-maintained mirror), write-form components across pages

---

## Desktop Delivery & Commercial

**Status**: Completed (desktop); web/cloud delivery not started

**Implemented**:
- Electron packaging: NSIS one-click installer, desktop/start-menu shortcuts
- Auto-updates via GitHub Releases, `ship.mjs` release pipeline
- Ed25519-signed offline license-key activation gate (`licensing.cjs` + keygen/`make-license.mjs`
  tooling)
- Embedded vs. client (shared LAN server) runtime mode, chosen at first launch, persisted to
  `server-config.json`

**Missing**: web/browser deployment (hosted API + HTTPS + production CORS + secrets management +
multi-tenant decision) — tracked as a P1 gap and the single biggest open architectural decision
(PROJECT-PROGRESS.md §6.1b: per-university instance vs. multi-tenant SaaS, still undecided).

**Database**: n/a (deployment-layer feature)
**API**: n/a
**Frontend**: `electron/main.cjs`, `electron/preload.cjs`, `electron/licensing.cjs`,
`electron/server-config.cjs`, `activation.html`, `server-setup.html`

---

## Quality (tests & linting)

**Status**: Partial (backend well-covered; frontend has none)

**Implemented**:
- Backend test suite: `node --test`, 30 files under `api/test/` covering auth, accounts, CRUD,
  enrollment (+ registrar variant + withdrawal), scheduling, timetable import, role scoping,
  authz, rate limiting, audit log/trail, notices, progression, students, finance, transcript,
  graduation, teacher profile, report builder/export, system reset, registration window,
  slot-exception reschedule
- Frontend linting via `oxlint` (`react/rules-of-hooks: error`)

**Missing**: no frontend test framework configured at all (no vitest/jest/testing-library in
`package.json`) — zero automated frontend tests, no CI wiring for either suite found in-repo.

**Database**: n/a
**API**: n/a
**Frontend**: n/a — this is the gap itself

---
*Last generated: 2026-07-30. Every shipped feature must be checked off here (and in
PROJECT-PROGRESS.md) at completion time — see the workflow rules in this repo's CLAUDE.md and the
top of [RBAC_MATRIX.md](RBAC_MATRIX.md).*
