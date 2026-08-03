# UniScheduler — API Inventory

> Generated from a full read of all 40 files under `api/src/routes/` plus `api/app.js`/`index.js`,
> on 2026-07-30, updated 2026-08-02 (added `routes/graduation.js`). Base URL prefix for every
> route below is `/api`. See
> [RBAC_MATRIX.md](RBAC_MATRIX.md) for what each permission string/role list means, and note that
> **two different `requirePermission()` functions exist** (legacy 2-arg `(module, 'read'|'write')`
> vs. new dotted `('Module.Action', opts)`) — the "Permission required" column states which is used.
>
> "Auth" = `requireAuth` (valid JWT) unless marked **public**. Where a route also carries a
> mount-level module gate (`requireModuleAccess`), that is noted once per file rather than
> repeated per row, since it applies uniformly.

## Auth endpoints (`app.js`, not under `routes/`)

| Method | Route | Purpose | Auth | Permission | Roles |
|---|---|---|---|---|---|
| POST | `/api/ping` | Health check | public | — | anyone |
| POST | `/api/auth/login` | Login → JWT (8h) | public, rate-limited | — | anyone with valid credentials |
| GET | `/api/auth/me` | Current session/user | requireAuth | — | self |
| PUT | `/api/auth/set-password` | Complete forced first-login password change | requireAuth, rate-limited | — | self |
| PUT | `/api/auth/profile` | Edit own name/email | requireAuth | — | self |
| PUT | `/api/auth/language` | Set own UI language | requireAuth | — | self |
| PUT | `/api/auth/change-password` | Change own password (requires current) | requireAuth, rate-limited | — | self |

## `routes/users.js` — mount `/api/users`
Mount gate: `requireModuleAccess('users')` (empty POLICY row); every route also has its own `requireRole('admin')`.

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/users` | List users, filterable by role | requireRole('admin') | admin |
| POST | `/api/users` | Create account + one-time temp password | requireRole('admin') | admin |
| POST | `/api/users/bulk-import` | Bulk CSV account creation | requireRole('admin') | admin |
| GET | `/api/users/:id` | Get one user | requireRole('admin') | admin |
| PUT | `/api/users/:id` | Update name/role/dept/college | requireRole('admin') | admin |
| PUT | `/api/users/:id/password` | Admin reset a user's password | requireRole('admin') | admin |
| DELETE | `/api/users/:id` | Delete user (blocked if it has history) | requireRole('admin') | admin |

## `routes/auditLog.js` — mount `/api/audit-log`
Mount gate: `requireModuleAccess('audit')` (empty POLICY row ⇒ admin only).

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/audit-log` | Last N audit rows (limit ≤ 500) | admin |

## `routes/colleges.js`, `departments.js`, `programs.js` — via `crudRouter` factory
Mount gate: `requireModuleAccess('departments', {openRead:true})` on all three.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/colleges`, `/api/departments`, `/api/programs` | List | any authenticated user (open read) |
| GET | `/.../:id` | Get one | any authenticated user (open read) |
| POST | `/api/colleges`, `/api/departments`, `/api/programs` | Create | admin (WRITE on `departments`) |
| PUT | `/.../:id` | Update | admin |
| DELETE | `/.../:id` | Delete | admin |

## `routes/studentTypes.js` — mount `/api/student-types`, via `crudRouter`
Mount gate: `requireModuleAccess('finance', {openRead:true})`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/student-types`, `/:id` | List/get student type categories | any authenticated user |
| POST/PUT/DELETE | `/api/student-types[/:id]` | Manage student type categories | bursar, admin (WRITE on `finance`) |

## `routes/terms.js` — mount `/api/terms`
Mount gate: `requireModuleAccess('terms')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/terms`, `/active/current`, `/:id` | List / active term / get one | registrar, dean, dept_head, exam_officer, records_officer, admissions_officer, bursar, viewer, faculty, student |
| POST | `/api/terms` | Create term | registrar, admin |
| PUT | `/api/terms/:id` | Update term | registrar, admin |
| POST | `/api/terms/:id/rollover` | Copy term structure into a new term | registrar, admin |
| DELETE | `/api/terms/:id` | Delete term | registrar, admin |

## `routes/teachers.js` — mount `/api/teachers`, via `crudRouter` (scopeColumn: departmentId)
Mount gate: `requireModuleAccess('teachers', {openRead:true})`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/teachers`, `/:id` | List/get (dept-head/dean scoped on `:id`) | any authenticated user |
| POST/PUT/DELETE | `/api/teachers[/:id]` | Manage teacher scheduling records | dean, dept_head, admin |

## `routes/teacherProfile.js` — mount `/api/teacher-profile` (no mount gate; every route self-guards)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/teacher-profile` | HR summary list | inline `teachers.View` OR `finance.Update` | registrar, dean, dept_head, viewer, admin, or bursar |
| GET | `/api/teacher-profile/:teacherId` | Full profile bundle (self / scoped / payroll-only for bursar) | inline `teacherAccessLevel()` | self, dean/dept_head/admin (scoped), bursar (payroll fields only) |
| PUT | `/api/teacher-profile/:teacherId` | Update profile | custom `requireProfileUpdateAccess` | dean/dept_head/admin (scoped), or bursar for payroll-only body |
| POST | `/api/teacher-profile/:teacherId/photo` | Upload photo | `requirePermission('teachers.Update', scopeOf)` | dean, dept_head, admin |
| GET | `/api/teacher-profile/:teacherId/photo` | Fetch photo | requireAuth only | any authenticated user |
| POST | `/api/teacher-profile/:teacherId/education` | Add education record | `requirePermission('teachers.Create', scopeOf)` | dean, dept_head, admin |
| PUT/DELETE | `/api/teacher-profile/education/:id` | Update/delete education record | `requirePermission('teachers.Update'/'.Delete', scopeOf)` | dean, dept_head, admin |
| GET | `/api/teacher-profile/education/:id/certificate`, `/transcript` | Download files | inline `teacherAccessLevel === 'full'` | scoped staff |
| POST | `/api/teacher-profile/:teacherId/experience` | Add experience record | `requirePermission('teachers.Create', scopeOf)` | dean, dept_head, admin |
| PUT/DELETE | `/api/teacher-profile/experience/:id` | Update/delete experience record | `requirePermission('teachers.Update'/'.Delete', scopeOf)` | dean, dept_head, admin |
| GET | `/api/teacher-profile/experience/:id/document` | Download file | inline `'full'` check | scoped staff |
| POST | `/api/teacher-profile/:teacherId/certifications` | Add certification | `requirePermission('teachers.Create', scopeOf)` | dean, dept_head, admin |
| PUT/DELETE | `/api/teacher-profile/certifications/:id` | Update/delete certification | `requirePermission('teachers.Update'/'.Delete', scopeOf)` | dean, dept_head, admin |
| GET | `/api/teacher-profile/certifications/:id/document` | Download file | inline `'full'` check | scoped staff |
| POST | `/api/teacher-profile/:teacherId/documents` | Upload document | `requirePermission('teachers.Create', scopeOf)` | dean, dept_head, admin |
| GET | `/api/teacher-profile/documents/:id/file` | Download document | inline `'full'` check | scoped staff |
| DELETE | `/api/teacher-profile/documents/:id` | Delete document | `requirePermission('teachers.Delete', scopeOf)` | dean, dept_head, admin |
| PUT | `/api/teacher-profile/{education\|experience\|certifications\|documents}/:id/verify` and `/reject` (8 routes) | Verification workflow | `requirePermission('teachers.Update', scopeOf)` | dean, dept_head, admin |

## `routes/rooms.js` — mount `/api/rooms`, via `crudRouter`
Mount gate: `requireModuleAccess('rooms', {openRead:true})`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/rooms[/:id]` | List/get rooms | any authenticated user |
| POST/PUT/DELETE | `/api/rooms[/:id]` | Manage rooms | registrar, admin |

## `routes/courses.js` — mount `/api/courses`
Mount gate: `requireModuleAccess('courses', {allowOwnerWrite:true})`.

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/courses` | List (dept/faculty-ownership scoped) | mount READ | registrar, dean, dept_head, exam_officer, records_officer, viewer, faculty, student |
| GET | `/api/courses/:id` | Get one (scoped + ownership) | mount READ | same |
| POST | `/api/courses` | Create course | `requirePermission('courses.Create')` | registrar, dean, dept_head, admin |
| POST | `/api/courses/bulk-import` | Bulk create courses | `requirePermission('courses.Create')` | registrar, dean, dept_head, admin |
| PUT | `/api/courses/:id` | Update course | `requirePermission('courses.Update', scopeOf)` + `canManageCourse` | registrar, dean, dept_head, admin (faculty excluded even for own course) |
| DELETE | `/api/courses/:id` | Delete course | `requirePermission('courses.Delete', scopeOf)` | registrar, dean, dept_head, admin |
| GET | `/api/courses/:id/prerequisites` | List prerequisites | mount READ | as list above |
| GET | `/api/courses/:id/slots` | List timetable slots for course | mount READ | as list above |
| POST | `/api/courses/:id/prerequisites` | Add prerequisite | `requirePermission('courses.Update', scopeOf)` | registrar, dean, dept_head, admin |
| DELETE | `/api/courses/:id/prerequisites/:prereqId` | Remove prerequisite | `requirePermission('courses.Update', scopeOf)` | registrar, dean, dept_head, admin |
| GET | `/api/courses/:id/roster` | Enrolled students | `canManageCourse` | admin, registrar, dean, dept_head, owning faculty |
| GET | `/api/courses/:id/eligible-students` | Eligible-to-enroll students | `canModifyEnrollment` | registrar, admin, owning faculty |

## `routes/slots.js` — mount `/api/slots`
Mount gate: `requireModuleAccess('timetable')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/slots[/:id]` | List/get timetable slots | registrar, dean, dept_head, exam_officer, viewer, faculty, student |
| POST | `/api/slots` | Create slot | registrar, dean, dept_head, admin (scoped) |
| PUT | `/api/slots/:id` | Update slot | registrar, dean, dept_head, admin (scoped) |
| DELETE | `/api/slots/:id` | Delete slot | registrar, dean, dept_head, admin (scoped) |

## `routes/slotExceptions.js` — mount `/api/slot-exceptions` (self-guarded, no mount gate)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/slot-exceptions` | List exceptions | `requirePermission('timetable','read')` (legacy) | registrar, dean, dept_head, exam_officer, viewer, faculty, student |
| POST | `/api/slot-exceptions` | Create cancellation/reschedule | `requirePermission('timetable','write')` (legacy) | registrar, dean, dept_head, admin |
| PUT | `/api/slot-exceptions/:id/reschedule` | Reschedule a cancelled session | `requireRole('admin','faculty')` + `canManageCourse` | admin, owning faculty (cancelled sessions only) |
| DELETE | `/api/slot-exceptions/:id` | Delete exception | `requirePermission('timetable','write')` (legacy) | registrar, dean, dept_head, admin |

## `routes/notifications.js` — mount `/api/notifications` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/notifications` | Own notifications | self (any role) |
| PUT | `/api/notifications/read-all` | Mark all read | self |
| PUT | `/api/notifications/:id/read` | Mark one read | self |

## `routes/attendance.js` — mount `/api/attendance`
Mount gate: `requireModuleAccess('attendance')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/attendance/me` | Own attendance | self (student) |
| GET | `/api/attendance` | Course attendance (student blocked) | viewer, faculty (own course, inline check) |
| POST | `/api/attendance/bulk` | Mark session attendance | `requireRole('admin','faculty')` + `canManageCourse` |

## `routes/exams.js` — mount `/api/exams`
Mount gate: `requireModuleAccess('exams', {allowOwnerWrite:true})`.

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/exams[/:id]` | List/get exams (dept/enrollment/financial-hold scoped) | mount READ | registrar, exam_officer, dean, dept_head, viewer, faculty, student |
| POST | `/api/exams` | Create exam | `requirePermission('exams','write')` (legacy) | registrar, exam_officer, dean, dept_head, admin |
| PUT | `/api/exams/:id` | Update exam | `requirePermission('exams','write')` + `canManageExam` | registrar, exam_officer, dean, dept_head, admin (faculty excluded) |
| DELETE | `/api/exams/:id` | Delete exam | `requirePermission('exams','write')` + `canManageExam` | same |
| POST | `/api/exams/auto-schedule` | Auto-schedule exams for a term | `requirePermission('exams','write')`, scoped roles blocked | registrar, exam_officer, admin |

## `routes/conflicts.js` — mount `/api/conflicts`
Mount gate: `requireModuleAccess('conflicts')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/conflicts` | List detected conflicts | registrar, exam_officer, viewer |
| GET | `/api/conflicts/available-rooms` | Room-availability finder | registrar, exam_officer, viewer |
| GET | `/api/conflicts/available-times` | Time-slot finder | registrar, exam_officer, viewer |
| POST | `/api/conflicts/auto-resolve` | Auto-resolve conflicts | admin only (empty WRITE row) |

## `routes/reports.js` — mount `/api/reports`
Mount gate: `requireModuleAccess('reports')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/reports` | Dashboard analytics | registrar, records_officer, viewer |
| GET | `/api/reports/entities` | List reportable entities | registrar, records_officer, viewer |
| GET | `/api/reports/run` | Run ad-hoc report (whitelist-driven) | same (READ only, any GET) |
| GET | `/api/reports/export/pdf`, `/export/xlsx` | Export ad-hoc report | same |
| GET | `/api/reports/export/dashboard/pdf`, `/export/dashboard/xlsx` | Export analytics dashboard | same |
| GET | `/api/reports/definitions[/:id]` | List/get saved reports | same |
| GET | `/api/reports/definitions/:id/run` | Run saved report | same |
| GET | `/api/reports/definitions/:id/export/pdf`, `/export/xlsx` | Export saved report | same |
| GET | `/api/reports/curricula` | List curriculum versions (picker) | registrar, records_officer, viewer |
| GET | `/api/reports/curricula/:id/structure` | Curriculum Structure report: Program → Version → Semester → Courses | registrar, records_officer, viewer |
| POST | `/api/reports/definitions` | Save new report definition | records_officer, admin (WRITE) |
| PUT | `/api/reports/definitions/:id` | Update saved report | records_officer, admin |
| DELETE | `/api/reports/definitions/:id` | Delete saved report | records_officer, admin |

## `routes/settings.js` — mount `/api/settings` (bare, self-guarded)

| Method | Route | Purpose | Auth | Permission | Roles |
|---|---|---|---|---|---|
| GET | `/api/settings/branding` | Public branding (name/color) | public | — | anyone |
| GET | `/api/settings/branding/logo` | Public branding logo | public | — | anyone |
| PUT | `/api/settings/branding` | Update branding | requireAuth | `requirePermission('branding','write')` | admin only |
| POST/DELETE | `/api/settings/branding/logo` | Upload/remove logo | requireAuth | `requirePermission('branding','write')` | admin only |
| GET | `/api/settings/grading-scale`, `/graduation-requirement`, `/semester-progression-policy` | Read config | requireAuth | `requirePermission('gradingScale','read')` | records_officer, viewer, admin |
| PUT | `/api/settings/grading-scale`, `/graduation-requirement`, `/semester-progression-policy` | Update config | requireAuth | `requirePermission('gradingScale','write')` | records_officer, admin |

## `routes/enrollments.js` — mount `/api/enrollments`
Mount gate: `requireModuleAccess('enrollment', {allowOwnerWrite:true})`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/enrollments/me` | Own enrollments | self (student) |
| POST | `/api/enrollments` | Self-enroll (student) or staff-enroll | student (self), registrar, admin (via `canModifyEnrollment`) |
| DELETE | `/api/enrollments/:id` | Drop/withdraw (soft-delete) | self (student), registrar, admin |
| POST | `/api/enrollments/bulk` | Bulk enroll (by semester, capacity-aware) | registrar, admin |

## `routes/grades.js` — mount `/api/grades`
Mount gate: `requireModuleAccess('grades')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/grades/items` | List grade items for course | records_officer, faculty (own course), viewer (read), admin |
| POST | `/api/grades/items` | Create grade item | records_officer, faculty (own course), admin |
| PUT | `/api/grades/items/:id` | Update grade item | records_officer, faculty (own course), admin |
| DELETE | `/api/grades/items/:id` | Delete grade item | records_officer, faculty (own course), admin |
| PUT | `/api/grades/score` | Enter/update a student's score | records_officer, faculty (own course), admin |
| GET | `/api/grades` | Full gradebook for a course | records_officer, faculty (own course), viewer, admin |
| GET | `/api/grades/department-summary` | Cross-course grade rollup | records_officer, viewer, admin (faculty/student blocked) |
| GET | `/api/grades/me` | Own final grades | self (student) |

## `routes/assignments.js` — mount `/api/assignments` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/assignments` | List for a course | enrolled student, or staff via `canManageCourse` |
| POST | `/api/assignments` | Create assignment | admin, faculty (own course) |
| GET | `/api/assignments/:id/submissions` | Roster of submissions | admin, faculty (own course) |
| POST | `/api/assignments/:id/submissions` | Student submits | student (must be enrolled) |
| GET | `/api/assignments/:id/submissions/:studentId/file` | Download submission file | owner student, or staff via `canManageCourse` |
| PUT | `/api/assignments/:id/submissions/:studentId` | Grade a submission | admin, faculty (own course) |

## `routes/announcements.js` (per-course — distinct from `notices.js`) — mount `/api/announcements` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/announcements` | List for a course | enrolled student, or staff via `canManageCourse` |
| POST | `/api/announcements` | Post announcement | admin, faculty (own course) |

## `routes/notices.js` (university-wide — distinct from per-course announcements) — mount `/api/notices` (bare)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/notices/meta/targeting-options`, `/meta/users-search` | Targeting reference data | `requirePermission('announcements.Create')` | registrar, dean, dept_head, admin |
| POST | `/api/notices/preview-recipients` | Preview resolved audience | `requirePermission('announcements.Create')` | registrar, dean, dept_head, admin |
| GET | `/api/notices` | List notices (manage view) | `requirePermission('announcements.View')` | registrar, dean, dept_head, viewer, admin |
| POST | `/api/notices` | Create draft notice | `requirePermission('announcements.Create')` | registrar, dean, dept_head, admin |
| GET | `/api/notices/:id` | Get one notice | `requirePermission('announcements.View')` + `canManageNotice` | scoped managers |
| PUT | `/api/notices/:id` | Edit notice | `requirePermission('announcements.Update')` + `canManageNotice` | scoped managers |
| POST | `/api/notices/:id/duplicate` | Duplicate as new draft | `requirePermission('announcements.Create')` + `canManageNotice` | scoped managers |
| POST | `/api/notices/:id/publish` | Publish now | `requirePermission('announcements.Publish')` + `canManageNotice` | scoped managers |
| POST | `/api/notices/:id/schedule`, `/cancel-schedule` | Schedule/cancel scheduled publish | `requirePermission('announcements.Schedule')` + `canManageNotice` | scoped managers |
| POST | `/api/notices/:id/archive` | Archive | `requirePermission('announcements.Archive')` + `canManageNotice` | scoped managers |
| DELETE | `/api/notices/:id` | Delete | `requirePermission('announcements.Delete')` + `canManageNotice` | scoped managers |
| GET | `/api/notices/:id/recipients` | Recipient list | `requirePermission('announcements.ManageRecipients')` + `canManageNotice` | scoped managers |
| GET | `/api/notices/:id/analytics` | Delivery/read/ack analytics | `requirePermission('announcements.ViewAnalytics')` + `canManageNotice` | scoped managers |
| POST | `/api/notices/:id/attachments` | Add attachment | `requirePermission('announcements.Update')` + `canManageNotice` | scoped managers |
| DELETE | `/api/notices/:id/attachments/:attId` | Remove attachment | `requirePermission('announcements.Update')` + `canManageNotice` | scoped managers |
| GET | `/api/notices/:id/attachments/:attId/file` | Download attachment (manage side) | inline (manager OR recipient) | scoped managers or recipients |
| GET | `/api/notices/me/list` | My notices feed | requireAuth (self) | any role |
| GET | `/api/notices/me/unread-count` | Unread count | requireAuth (self) | any role |
| GET | `/api/notices/me/:id` | Get one (recipient view) | requireAuth (self) | any role, if recipient |
| PUT | `/api/notices/me/:id/read` | Mark read | requireAuth (self) | any role |
| PUT | `/api/notices/me/:id/acknowledge` | Acknowledge | requireAuth (self) | any role |
| GET | `/api/notices/me/:id/attachments/:attId/file` | Download attachment (recipient side) | requireAuth + recipient check | any role, if recipient |

## `routes/courseActivity.js` — mount `/api/course-activity` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/course-activity/status` | Per-course unread-activity dot status | student (self) |
| PUT | `/api/course-activity/:courseId/viewed` | Mark course activity viewed | student (self, enrolled) |

## `routes/materials.js` — mount `/api/materials` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/materials` | List for a course | enrolled student, or staff via `canManageCourse` |
| POST | `/api/materials` | Upload material | admin, faculty (own course) |
| DELETE | `/api/materials/:id` | Delete material | admin, faculty (own course) |
| GET | `/api/materials/:id/file` | Download file | enrolled student, or owning staff |

## `routes/studentProfile.js` — mount `/api/student-profile` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/student-profile/advisees` | Advisor's assigned advisees | advisor (self-scoped) |
| GET | `/api/student-profile/:studentId` | Get profile | self, admin, advisor-of, or `students:read` roles (scoped) |
| PUT | `/api/student-profile/me` | Edit own self-editable fields | student (self) |
| PUT | `/api/student-profile/:studentId` | Edit admin-managed fields (`studentStatus: 'Graduated'` rejected — 400 — only reachable via `POST /api/graduation/confirm/:studentId`) | admin |
| POST | `/api/student-profile/:studentId/documents` | Upload document | admin |
| GET | `/api/student-profile/documents/:id/file` | Download document | self or admin |
| DELETE | `/api/student-profile/documents/:id` | Delete document | admin |
| POST | `/api/student-profile/:studentId/photo` | Upload photo | admin |
| GET | `/api/student-profile/:studentId/photo` | Fetch photo | self, admin, advisor-of, or `students:read` roles |

## `routes/curricula.js` — mount `/api/curricula` (self-guarded)

Curriculum CRUD/version activation and archival; semester/course/elective-group authoring;
clone, validate, compare, assigned-student listing; unassigned-student review; student assignment
history and curriculum audit. Uses granular `Curriculum.*` permissions.

## `routes/progression.js` — mount `/api/progression` (bare)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/progression/:studentId/history`, `/current` | Semester progression history/current status | inline (self, admin, or advisor-of) | self, admin, advisor |
| POST | `/api/progression/:studentId/evaluate` | Evaluate a student's current semester | `requirePermission('students.Progress')` | registrar, records_officer, admin |
| POST | `/api/progression/:studentId/override` | Manually override progression outcome | `requirePermission('students.Progress')` | registrar, records_officer, admin |
| POST | `/api/progression/evaluate-term/:termId` | Bulk-evaluate a whole term | `requirePermission('students.Progress')` | registrar, records_officer, admin |

## `routes/graduation.js` — mount `/api/graduation` (bare, self-guarded — no mount-level gate)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/graduation/eligible` | List students with `semesterStatus='Graduation Eligible'` (not yet Graduated), each annotated with live financial-clearance status (reuses `finance.js`'s balance computation) | `requirePermission('graduation','read')` (legacy) | registrar, records_officer, admin |
| POST | `/api/graduation/confirm/:studentId` | Confirm degree: one transaction re-checks eligibility (409 if not `Graduation Eligible`) and outstanding balance (422 `code: 'FINANCE_HOLD'`, no partial writes) server-side, then sets `studentStatus='Graduated'`, inserts a `graduation_records` row with a generated certificate number, and writes an `audit_log` entry (`graduation-confer`); idempotent — retrying for an already-graduated student returns the existing record (200) | `requirePermission('graduation','write')` (legacy) | registrar, records_officer, admin |
| GET | `/api/graduation/certificate/:studentId` | Download pdfkit-generated diploma PDF (landscape A4, org branding); 404 before conferral | inline (self, or `graduation:read` roles) — same self-or-module-read pattern as `transcript.js`'s `canViewTranscript` | self (once graduated), registrar, records_officer, admin |

## `routes/students.js` — mount `/api/students` (bare)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/students/me/eligible-courses` | Eligibility-checked catalog for self | inline `role==='student'` | student (self) |
| GET | `/api/students` | Paginated/filterable student directory | `requirePermission('students','read')` (legacy) | registrar, records_officer, admissions_officer, dean, dept_head, bursar, viewer, admin |
| GET | `/api/students/export` | CSV export (same filters, capped) | `requirePermission('students','read')` | same |
| PUT | `/api/students/bulk` | Bulk scoped edit (status/dept/program; `studentStatus: 'Graduated'` rejected — 400 — same carve-out as `student-profile.js` above) | `requirePermission('students','write')` | registrar, records_officer, admin |
| GET | `/api/students/:id/overview` | 360° student overview | `requirePermission('students','read')` + dept scope | scoped staff roles |

## `routes/finance.js` — mount `/api/finance` (bare, mixes legacy `requireRole` and `requirePermission(module,'read'/'write')`)

| Method | Route | Purpose | Permission | Roles |
|---|---|---|---|---|
| GET | `/api/finance/settings`, `/terms/:termId/config`, `/terms/:termId/fee-rules`, `/terms/:termId/fee-plan` | Read fee configuration | `requirePermission('finance','read')` | bursar, admin |
| GET | `/api/finance/students` | Billing worklist | `requirePermission('finance','read')` | bursar, admin |
| GET | `/api/finance/reports/aging`, `/today-collections`, `/recent-activity`, `/term-summary`, `/overdue-installments`, `/upcoming-installments` | Bursar dashboard reports | `requirePermission('finance','read')` | bursar, admin |
| GET | `/api/finance/students/:studentId/preview` | Preview a student's charge calc | `requirePermission('finance','read')` | bursar, admin |
| PUT | `/api/finance/settings`, `/terms/:termId/config` | Update fee policy config | `requireRole('admin')` | admin only (bursar deliberately excluded) |
| POST/PUT/DELETE | `/api/finance/terms/:termId/fee-items[/:id]`, `/fee-rules[/:id]` | Manage fee items/rules | `requireRole('admin')` | admin only |
| PUT | `/api/finance/terms/:termId/fee-plan` | Update installment plan | `requireRole('admin')` | admin only |
| POST | `/api/finance/terms/:termId/generate-charges` | Generate charges for a term | `requirePermission('finance','write')` | bursar, admin |
| POST | `/api/finance/students/:studentId/payments` | Record payment | `requirePermission('finance','write')` | bursar, admin |
| DELETE | `/api/finance/payments/:id` | Void a payment | `requirePermission('finance','write')` | bursar, admin |
| POST/DELETE | `/api/finance/students/:studentId/scholarships[/:id]` | Manage legacy scholarships | `requirePermission('finance','write')` | bursar, admin |
| POST/PUT/DELETE | `/api/finance/students/:studentId/aid`, `/aid/:id` | Manage financial aid awards | `requirePermission('finance','write')` | bursar, admin |
| GET | `/api/finance/students/:studentId` | Full statement | inline `canViewStatement` | self, or `finance:read` roles |
| GET | `/api/finance/payments/:id/receipt` | Download receipt | inline (self or `finance:read`) | self, or `finance:read` roles |
| GET | `/api/finance/me` | Own finance snapshot | requireAuth (self) | any role (non-students get an empty stub) |

## `routes/transcript.js` — mount `/api/transcript` (bare)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/transcript/me` | Own transcript | self (student) |
| GET | `/api/transcript/students/:studentId` | Staff drill-down transcript | self, or `students:read` roles (registrar, records_officer, admissions_officer, dean, dept_head, bursar, viewer, admin) |

## `routes/approvals.js` — mount `/api/approvals` (bare; dynamic per-request-type authz)

| Method | Route | Purpose | Roles |
|---|---|---|---|
| POST | `/api/approvals` | Submit a request (self-service) | any authenticated user (subjectId = caller) |
| GET | `/api/approvals/mine` | Own submitted requests | self |
| GET | `/api/approvals/pending` | Requests pending my review | role-dependent, via `engine.listPendingForReviewer` |
| GET | `/api/approvals/:id` | Get one request | owner, admin, a prior reviewer, or current-step reviewer |
| POST | `/api/approvals/:id/decide` | Approve/reject/return | current-step reviewer or admin (engine-internal) |
| POST | `/api/approvals/:id/cancel` | Cancel own request | owner |
| POST | `/api/approvals/:id/resubmit` | Resubmit after return | owner |

## `routes/applications.js` — mount `/api/applications` (bare)

| Method | Route | Purpose | Auth | Permission | Roles |
|---|---|---|---|---|---|
| GET | `/api/applications/departments` | Department list for public form | public | — | anyone |
| POST | `/api/applications` | Submit application | public, rate-limited | — | anyone |
| POST | `/api/applications/admin` | Admin-side application creation | requireAuth | `requirePermission('admissions','write')` (legacy) | admissions_officer, admin |
| GET | `/api/applications[/:id]` | List/get applications (dept-scoped) | requireAuth | `requirePermission('admissions','read')` | registrar, admissions_officer, dean, dept_head, viewer, admin |
| PUT | `/api/applications/:id`, `/:id/status` | Edit / change status | requireAuth | `requirePermission('admissions','write')` | admissions_officer, admin |
| POST | `/api/applications/:id/approve` | Approve → auto-create student account | requireAuth | `requirePermission('admissions','write')` | admissions_officer, admin |
| POST | `/api/applications/:id/documents` | Upload document | requireAuth | `requirePermission('admissions','write')` | admissions_officer, admin |
| DELETE | `/api/applications/:id/documents/:docId` | Delete document | requireAuth | `requirePermission('admissions','write')` | admissions_officer, admin |
| GET | `/api/applications/:id/documents/:docId/file` | Download document | requireAuth | `requirePermission('admissions','read')` | registrar, admissions_officer, dean, dept_head, viewer, admin |

## `routes/timetableImport.js` — mount `/api/timetable-import`
Mount gate: `requireModuleAccess('timetable')`; every route also has `requireRole('admin')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| POST | `/api/timetable-import/parse` | Parse uploaded PDF timetable | admin |
| POST | `/api/timetable-import/confirm` | Confirm parsed import | admin |
| POST | `/api/timetable-import/reset` | Reset/undo import | admin |

## `routes/backup.js` — mount `/api/backup`
Mount gate: `requireModuleAccess('backup')` (empty POLICY row) + explicit `requireRole('admin')` per route.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/backup/export` | Export full database | admin |
| POST | `/api/backup/restore` | Restore database from export | admin |

## `routes/systemHealth.js` — mount `/api/system-health`
Mount gate: `requireAuth` + `requireRole('admin')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/system-health` | System health check | admin |

## `routes/registrarDashboard.js` — mount `/api/registrar-dashboard`
Mount gate: `requireAuth` + `requireRole('registrar','admin')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| GET | `/api/registrar-dashboard` | Registrar aggregate dashboard data | registrar, admin |

## `routes/superAdmin.js` — mount `/api/super-admin`
Mount gate: `requireAuth` + `requireRole('admin')`.

| Method | Route | Purpose | Roles |
|---|---|---|---|
| POST | `/api/super-admin/system-reset` | Wipe operational data (requires confirmation phrase) | admin |

## `routes/crudRouter.js`
Not itself mounted — a factory consumed by `colleges.js`, `departments.js`, `programs.js`,
`studentTypes.js`, `teachers.js`, `rooms.js`. Provides the standard `GET /`, `GET /:id`,
`POST /`, `PUT /:id`, `DELETE /:id` shape; the factory itself only requires `requireAuth` —
real authorization comes entirely from each consumer's mount-level `requireModuleAccess(...)` gate.

---
*Last generated: 2026-07-30, updated 2026-08-02 (added `routes/graduation.js`). Update this file
immediately whenever a route, permission check, or mount gate changes — per the workflow rules in
this repo's CLAUDE.md.*
