# UniScheduler — University Management System (UMS)
## Product Documentation

**Prepared for:** University leadership evaluating UniScheduler for institutional deployment —
Vice Chancellors, Rectors, Deans, Registrars, Bursars, and IT decision-makers.

**Prepared by:** LEMON_Soft

**Document status:** Generated and maintained directly from the production source code and
database schema, not written independently of the product. It is refreshed every time a module,
role, or workflow changes, so the description below always matches the software as it exists
today. Where a capability is planned but not yet delivered, this document says so explicitly
rather than describing it as complete.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Objectives & Design Principles](#3-objectives--design-principles)
4. [User Roles & Responsibilities](#4-user-roles--responsibilities)
5. [Core Workflows](#5-core-workflows)
6. [Feature Modules](#6-feature-modules)
7. [Scheduling Engine](#7-scheduling-engine)
8. [Security Architecture](#8-security-architecture)
9. [Reporting & Business Intelligence](#9-reporting--business-intelligence)
10. [Technical Architecture](#10-technical-architecture)
11. [Database Overview](#11-database-overview)
12. [APIs & Integration Layer](#12-apis--integration-layer)
13. [Deployment Options](#13-deployment-options)
14. [Screenshots](#14-screenshots)
15. [Implementation Process](#15-implementation-process)
16. [Data Migration](#16-data-migration)
17. [Integrations](#17-integrations)
18. [Scalability](#18-scalability)
19. [Benefits](#19-benefits)
20. [Licensing](#20-licensing)
21. [Support & Maintenance](#21-support--maintenance)
22. [Frequently Asked Questions](#22-frequently-asked-questions)
23. [Future Roadmap](#23-future-roadmap)
24. [Appendices](#24-appendices)

---

## 1. Executive Summary

UniScheduler is a complete university management system covering the full academic lifecycle —
**admissions, enrollment, timetabling, teaching, grading, student records, finance, and
institution-wide reporting** — in a single, unified platform rather than a patchwork of
spreadsheets and disconnected tools.

It is built around three commitments that matter to an institution evaluating a system of
record:

- **One source of truth.** A student's admission record, enrollment history, attendance, grades,
  fee balance, and transcript all live in one database and are visible consistently to every
  authorized role, instead of being re-entered across disconnected office systems.
- **Role-appropriate access, not all-or-nothing access.** Twelve distinct roles — from Vice
  Chancellor-level administrators down to individual students — see and can act on exactly the
  data their position requires, enforced on the server, not just hidden in the interface.
  Department Heads and Deans are automatically confined to their own department or college;
  faculty see only their own courses; students see only their own records.
  See [§8 Security Architecture](#8-security-architecture).
- **Built for a trilingual institution.** The entire interface — every label, form, and
  notification — is available in English, Pashto, and Dari, with full right-to-left layout
  support, not bolted on as an afterthought.

**Delivered today:** a self-contained Windows desktop application (with an optional shared
network-server mode so an entire campus can run against one database) covering the complete
academic lifecycle from admissions through degree confirmation and certificate issuance, a full
finance and fee-collection module, teaching and gradebook tools, a targeted institution-wide
announcement system, and a self-service custom report builder with PDF/Excel export.

**On the roadmap:** browser-based (cloud) access so students and faculty can log in from any
device without installing software, a full programs-and-curriculum model with degree audits, and
one-click automatic timetable generation. These are scoped and prioritized — see
[§23 Future Roadmap](#23-future-roadmap) — not vague aspirations.

---

## 2. System Overview

UniScheduler replaces the mix of spreadsheets, paper forms, and single-purpose tools that most
institutions accumulate over time with one connected system spanning the entire student
lifecycle:

```
  Public Applicant          Admitted Student                 Graduate
        │                          │                              │
        ▼                          ▼                              ▼
  ┌───────────┐   approve   ┌─────────────┐   term-over-term   ┌────────────┐
  │ Admissions │ ─────────▶ │  Enrollment  │ ──────────────────▶ │ Transcript │
  │ (public    │            │ & Academic   │   (auto semester    │ & Records  │
  │  intake)   │            │  Progress    │    progression)     │            │
  └───────────┘            └──────┬───────┘                     └────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
       ┌─────────────┐     ┌──────────────┐      ┌──────────────┐
       │ Timetabling  │     │  Teaching &  │      │   Finance &  │
       │ & Exams      │     │  Gradebook   │      │   Fee Ledger │
       └─────────────┘     └──────────────┘      └──────────────┘
              │                    │                     │
              └────────────────────┼────────────────────┘
                                    ▼
                     ┌───────────────────────────┐
                     │ Institution-wide Reporting,│
                     │ Announcements & Audit Log  │
                     └───────────────────────────┘
```

Every box above is a live, working module today (see [§6](#6-feature-modules) for detail on
each), all reading from and writing to the same underlying database — a fee payment recorded by
the Bursar is immediately reflected in the eligibility check a Registrar sees when approving
enrollment; a grade entered by a faculty member immediately feeds a student's GPA, transcript, and
academic-progression status.

---

## 3. Objectives & Design Principles

UniScheduler was designed against a specific set of goals that shape every module:

1. **Eliminate duplicate data entry.** A student's information is entered once (at admission) and
   flows forward into enrollment, attendance, grading, finance, and the transcript — never
   re-keyed by a different office.
2. **Make access control a first-class feature, not an afterthought.** Every institution has
   sensitive data (grades, finances, personal records) and a real organizational hierarchy
   (colleges → departments → courses). The system enforces that hierarchy automatically rather
   than relying on staff discipline or shared logins.
3. **Support the languages the institution actually operates in.** English-only software is a
   barrier in many markets; UniScheduler treats Pashto and Dari as first-class languages with full
   right-to-left support, not a translated skin over an English product.
4. **Prefer configuration over customization.** Grading scales, fee structures, academic
   progression policy, and notification targeting are all admin-configurable settings rather than
   values hard-coded for one institution, so the same product serves institutions with different
   policies without a code fork.
5. **Be transparent about what is and is not built.** This documentation — and the roadmap in
   [§23](#23-future-roadmap) — deliberately separates "shipped today" from "planned next," so an
   evaluating institution can make an informed decision rather than discover gaps after purchase.

---

## 4. User Roles & Responsibilities

UniScheduler ships with **twelve built-in roles**. Every account is created by an administrator —
there is no public self-registration for staff or student accounts (students may submit a public
*admissions application*, which becomes an account only once approved). New accounts receive a
one-time temporary password and are required to set their own password on first login.

| Role | Typical Job Title | What They Can Do |
|---|---|---|
| **Super Admin** | System Administrator | Full control of the system: user accounts, licensing, backups, branding, system reset, and every module. The only role that can create/delete other accounts. |
| **Registrar** | Registrar | University-wide academic operations: courses, terms, enrollment management, academic-progression decisions, transcripts, and confirming a student's graduation and degree. |
| **Admissions Officer** | Admissions Officer | Manages the public application intake queue: review, request documents, approve (which auto-creates the student account) or reject. |
| **Dean** | Dean of a College | Everything a Department Head can do, automatically extended across every department in their college. Can also target institution-wide announcements to their college. |
| **Department Head** | Head of Department (HoD) | Manages courses, teachers, and rooms *within their own department only* — the system enforces this boundary automatically, it is not a matter of hiding menu items. |
| **Exam Officer** | Exam/Assessment Officer | Owns the exam schedule: creating, auto-scheduling, and resolving exam conflicts across the institution. |
| **Records Officer** | Registrar's Office / Records | Student records, grading scale configuration, graduation/degree confirmation, and the custom report builder. |
| **Bursar** | Finance Officer / Bursar | The finance module end-to-end: fee structures, invoices, payments, receipts, installment plans, and the Bursar dashboard (collections, aging, overdue accounts). |
| **Viewer** | Board Member / Auditor / Observer | Read-only access across most modules — built for stakeholders who need visibility without operational access. |
| **Student Advisor** | Academic Advisor | Read access to their assigned advisees' academic records, scoped automatically to only the students formally assigned to them. |
| **Faculty** | Instructor / Lecturer | Their own courses only: roster, attendance, assignments, course materials, announcements, and the gradebook. Cannot see or touch another instructor's course. |
| **Student** | Enrolled Student | Self-service: browse the catalog and enroll, view personal schedule/grades/attendance/transcript/fee statement, submit assignments, receive announcements, file appeals, and — once graduated — download their own degree certificate. |

**How scope is enforced (not just displayed):** Department Heads and Deans are not merely shown a
filtered menu — every request they make is checked on the server against the department(s) or
college they actually belong to. A Department Head cannot view or modify another department's
courses even by guessing a URL or automating the interface; the restriction is enforced at the
data layer. The same applies to faculty (their own courses only) and students (their own records
only). Full detail in [§8 Security Architecture](#8-security-architecture) and
[Appendix A](#appendix-a-role-permission-matrix).

Institutions that need a role not listed here (e.g., a Librarian, a Hostel/Dorm Warden) can have
one added as a configuration change — the permission system was built to support new roles
without a rewrite.

---

## 5. Core Workflows

The modules in [§6](#6-feature-modules) combine into complete, end-to-end institutional
workflows. Four of the most common are illustrated below.

### 5.1 From public applicant to enrolled student

1. A prospective student submits a public application (no login required) with supporting
   documents, optionally requesting financial aid.
2. An Admissions Officer reviews the application, requests any missing documents, and records a
   decision.
3. On **approval**, the system automatically creates the student's account, issues a one-time
   password, and (if a financial-aid decision was recorded) applies it to the student's fee
   profile — no re-typing of the applicant's information into a separate student system.
4. The new student logs in, is prompted to set a permanent password, and can immediately browse
   the course catalog.

### 5.2 From catalog to a confirmed seat in a class

1. The student opens the Catalog and sees every course tagged **Eligible**, **Currently
   Enrolled**, **Completed**, **Not Yet Eligible** (with the specific missing prerequisite shown),
   or **Not Offered This Term**.
2. On enrolling, the system checks — atomically, so two students cannot both claim the last seat —
   seat capacity, prerequisite/corequisite completion, schedule conflicts with the student's
   existing timetable, any outstanding financial hold, and duplicate enrollment.
3. If the class is full, the student is offered the waitlist and promoted automatically as seats
   free up.
4. The confirmed enrollment immediately appears on the student's personal schedule, the
   instructor's roster, and the Bursar's fee-charge calculation for that term.

### 5.3 From a taught course to a transcript line

1. A faculty member builds weighted grade items (e.g., Midterm 30%, Assignments 20%, Final 50%)
   in the gradebook for their course and enters scores as work is graded.
2. The student sees their running grade and GPA immediately in "My Grades."
3. At term close, the Registrar or an automated evaluation reviews each student's semester: fully
   graded with no failures advances the student automatically; failures within the institution's
   configured policy (e.g., one failed course) still advance the student with a Probation flag;
   exceeding that policy holds the student for a manual Registrar decision.
4. Every completed term becomes a permanent line on the student's official transcript, with
   per-term and cumulative GPA computed directly from graded coursework — never a manually
   maintained figure.

### 5.4 From a fee structure to a paid, receipted balance

1. A Bursar (or Admin) defines fee rules — which can be as broad as "all students" or as specific
   as "International students in the Engineering program in their first year" — plus any fixed
   per-term fee items (library, lab, etc.).
2. When a term's charges are generated, each student's invoice is computed automatically from the
   most specific rule that applies to them, with a record of exactly which rule produced each
   line item (for auditability).
3. Payments are recorded against the invoice; each payment produces a receipt. Partial payment
   plans (installments) are supported with automatic overdue tracking.
4. A student with an unpaid balance beyond the institution's configured threshold can be
   automatically placed on financial hold, which the enrollment workflow (§5.2) checks and blocks
   against — finance and academics are connected, not siloed.

### 5.5 From graduation-eligible to a conferred degree

1. Once automatic semester progression (§5.3) marks a student **Graduation Eligible**, they appear
   on the Registrar's/Records Officer's graduation worklist alongside their live financial-clearance
   status, computed from the same fee ledger the Bursar sees (§5.4) — no separate balance check to
   reconcile.
2. Confirming graduation is a single, deliberate action behind a confirmation prompt: the system
   re-verifies eligibility and financial clearance at the moment of confirmation (never trusting
   what was shown on screen), and refuses — with no partial changes — if either check fails.
3. On success, the student's status becomes **Graduated**, the conferred degree and date are
   recorded permanently with a unique certificate number, and the action is written to the audit
   log.
4. The graduated student (and staff with graduation access) can immediately download a
   university-branded degree certificate as a PDF — self-service for the student, on demand for
   staff.

---

## 6. Feature Modules

Each module below is production software today unless explicitly marked otherwise. "Status"
reflects the honest completeness of the module, matching the underlying engineering audit in
[`docs/FEATURE_INVENTORY.md`](FEATURE_INVENTORY.md).

### 6.1 Admissions Management — *Complete*
A public-facing application form (no login required) with document upload lets prospective
students apply online. Admissions staff work a review queue, can request additional documents,
and record accept/reject decisions with optional financial-aid terms. Approval auto-provisions
the student's account — admissions and student records are one continuous process, not two
disconnected systems requiring manual re-entry. Applicant email notification (offer letters,
status updates) is built and ready — it activates automatically once the institution supplies
outbound email (SMTP) credentials during deployment.

### 6.2 Academic Structure — *Core complete; curriculum modeling on the roadmap*
Institution-wide setup for Colleges, Departments, Programs, Terms/Semesters, Teachers, Rooms, and
Courses, including bulk import of courses from a spreadsheet, configurable prerequisite rules
(including "must be taken at the same time as" corequisites), a configurable grading scale, and
graduation credit requirements. Term rollover lets the Registrar copy one term's structure into
the next instead of rebuilding it from scratch. A full semester-by-semester curriculum plan and
degree-audit view (what a student has taken vs. still needs) is scoped for a future release —
see [§23](#23-future-roadmap).

### 6.3 Faculty & Staff Profiles — *Complete*
Full HR-style profiles for teaching staff: personal and employment details, repeatable education,
work experience, and certification history with a verification workflow, plus photo and document
uploads. Profile completeness is tracked so onboarding gaps are visible to administration.

### 6.4 Scheduling & Timetabling — *Core complete; see [§7](#7-scheduling-engine) for the
dedicated deep-dive*
Weekly timetable slot management with automatic conflict detection (room, teacher, and time
collisions), one-click conflict auto-resolution, available-room and available-time finders, exam
scheduling with auto-placement, and one-off schedule exceptions (e.g., a single cancelled or
moved class). An institution can also **import an existing timetable from a PDF** — the system
parses it, shows a preview for confirmation, and only commits the import once approved.

### 6.5 Enrollment & Eligibility — *Complete*
Student self-enrollment against real-time seat capacity, with a waitlist, prerequisite/corequisite
enforcement, timetable-conflict prevention, and duplicate-enrollment prevention, all checked
atomically so concurrent enrollment attempts cannot oversell a class. Registrar and Department
staff can manage enrollment individually or in bulk for an entire term, with every change logged
to the audit trail (see [§8.4](#84-audit-trail)).

### 6.6 Teaching & Learning Management (LMS) — *Complete*
Faculty create assignments and course materials, and grade student submissions; students submit
files and text responses. Per-course announcements keep a class informed. Bulk attendance marking
lets an instructor record a whole session in one action; students see their own attendance
history. The gradebook supports weighted grade categories with automatic percentage/GPA rollup,
plus a department-level grade summary view for oversight. Faculty get a dedicated dashboard
summarizing their courses, students, and upcoming exams, and one-click "quick actions" (roster,
attendance, gradebook, announcements) from the course list.

### 6.7 Student Records & Academic Progress — *Core complete; status-change history is the
remaining gap*
A complete student profile (with an admin-managed section and a self-editable section), document
storage, and a photo. Automatic semester progression evaluates each student's real, final grades
— never a calendar date — to advance them to the next semester, flag Probation, hold a Failed
semester for manual review, or mark a student Graduation Eligible once their program's credit and
semester requirements are met; every manual override requires a stated reason and is permanently
logged. A directory-style Student Management view supports filtering by college, program, student
type, cohort, status, and enrollment, with CSV export and scoped bulk actions. **Official
transcripts** are generated on demand — self-service for students, drill-down for staff — with
correct per-term and cumulative GPA. Students can also be assigned an **Academic Advisor**, who
gets read access to their advisees only.

### 6.8 Graduation & Degree Issuance — *Complete*
The final step of the academic lifecycle. Once a student is marked **Graduation Eligible** by
automatic semester progression, the Registrar or Records Officer sees them on a graduation
worklist alongside a live financial-clearance status pulled from the same fee ledger the Bursar
uses — no manually reconciled spreadsheet of who still owes money. Confirming a degree is a single
guarded action (a confirmation dialog, since it is not meant to be undone lightly): the system
re-verifies eligibility and financial clearance at the moment of confirmation, refuses with no
partial changes if either check fails, and — once both pass — marks the student Graduated, records
the conferred degree and date with a unique certificate number, and logs the action. The student
(and authorized staff) can then download a university-branded degree certificate as a PDF on
demand, self-service for the student.

### 6.9 Finance & Fee Management — *Complete (full module)*
A hierarchical fee-rate engine resolves the correct rate for any student from rules that can be
set at the university, college, department, or program level, crossed with student type
(regular/international/scholarship/etc.) — the most specific applicable rule wins, and every
charge records which rule produced it for a fully auditable ledger. Supports fixed per-term fee
items, financial aid/scholarships, invoice generation, payment recording with void/reversal,
printable receipts, and installment payment plans with overdue and upcoming-due tracking. A
dedicated **Bursar Dashboard** surfaces today's collections, an aging report, and recent activity
at a glance. Every balance is computed live from the transaction ledger — never a cached number
that can drift out of sync.

### 6.10 Institution-wide Announcements — *Complete (in-app channel)*
A targeted communication tool distinct from per-course announcements: administrators, Deans,
Department Heads, and Registrars can compose a notice and target it precisely — by student
cohort, program, department, enrollment status, faculty department, specific roles, or specific
named people — with the recipient list resolved and frozen at publish time so a later data change
doesn't silently alter who received it. Notices support scheduling, expiry, optional
read-acknowledgment tracking with analytics, optional attachments, and an optional in-app action
button. Delivery today is in-app (notification bell); the architecture already supports adding
email/SMS delivery as a configuration step (see [§17 Integrations](#17-integrations)).

### 6.11 Custom Report Builder & Export — *Complete*
A self-service reporting tool: any permitted user picks from six reportable data areas (students,
courses, enrollments, attendance, finance transactions, admissions applications), chooses columns
and filters, and optionally groups the results into a chart. Reports can be saved and re-run, and
every report — plus the standard analytics dashboards — can be exported to **PDF** or **Excel**
directly from the browser, with no separate BI tool required. See
[§9](#9-reporting--business-intelligence) for full detail.

### 6.12 Approvals & Appeals — *Complete engine; one workflow live today*
A generic, reusable multi-step approval engine routes a request through an ordered chain of
reviewers, recording every decision. It powers the **student appeals** process today (a two-step
chain: the course's own instructor, then the Registrar), and is built to have additional
workflows (e.g., leave requests, grade-change requests) registered onto it without new
infrastructure.

### 6.13 Administration & System Operations — *Core complete; automated backups on the roadmap*
Institution branding (name and logo shown throughout the app), a searchable audit log of
administrative actions, global search, a manual database backup/restore tool, a system health
check, and a deliberately guarded "system reset" for a fresh deployment (requires a typed
confirmation phrase to prevent accidental data loss). **Scheduled, automatic backups** are the
one operational item still on the roadmap — see [§23](#23-future-roadmap).

### 6.14 Multilingual & Accessibility — *Complete (translation accuracy review pending)*
The complete interface is available in **English, Pashto, and Dari**, switchable per user and
persisted to their account, with full right-to-left layout for Pashto/Dari — not a
mirrored-icon afterthought, but genuine logical-direction layout throughout. All three languages
are confirmed to have complete coverage of every screen. A native-speaker linguistic accuracy
review (as opposed to structural completeness, which is already verified) is recommended before
a Pashto/Dari-primary rollout and is tracked as an open item.

---

## 7. Scheduling Engine

Timetabling is one of the most operationally painful tasks for any registrar's office, and it is
a first-class engine in UniScheduler rather than a generic calendar.

**What it does today:**
- **Conflict detection.** Every timetable slot is checked against every other slot for room
  double-booking, teacher double-booking, and time overlap, surfaced on a dedicated Conflicts page
  the moment a conflict exists — not discovered after the term has started.
- **One-click conflict auto-resolution.** Given a conflict, the system can search for an
  alternative available room or time slot automatically.
- **Available-room / available-time finders.** When manually placing a class, staff can ask "what
  rooms/times are actually free" instead of trial-and-error.
- **Exam auto-scheduling.** Exams can be placed automatically across the available windows, again
  respecting room and time conflicts.
- **PDF timetable import.** An institution with an existing timetable in PDF form can import it —
  the system parses the document, shows a preview for review, and only commits the change once a
  staff member confirms it, with the ability to reset if the import isn't right.
- **Exceptions, not just recurring slots.** A single date can be cancelled or rescheduled (e.g., a
  public holiday or an instructor's one-off absence) without altering the standing weekly
  timetable.
- **Personal schedule views.** Every student and faculty member has a live "My Schedule" reflecting
  only the sessions relevant to them, plus an institution-wide weekly calendar view.

**What's next (roadmap, see [§23](#23-future-roadmap)):** the current engine assists and resolves
conflicts in an existing timetable; a **one-click, constraint-solving full timetable generator**
— which places every course's weekly slots for an entire term automatically, respecting
per-teacher availability windows and room feature requirements (lab, capacity, equipment) — is
scoped as the next major capability, building on room/teacher-availability data being added
first.

---

## 8. Security Architecture

Security in UniScheduler is enforced in the same place the data lives — the server — never only
in what the interface chooses to display. This matters for an institution's compliance posture:
hiding a button in the UI is not access control; UniScheduler checks every request against the
requesting user's actual role and scope before it touches the database.

### 8.1 Authentication
- Password-based login issuing a signed session token (8-hour validity); no public
  self-registration for staff/student accounts — every account originates from an administrator
  or the admissions-approval workflow.
- New accounts receive a one-time temporary password and are forced through a password-change
  screen before they can do anything else in the system.
- Login and password-related endpoints are rate-limited to resist brute-force attempts, with
  stricter defaults automatically applied in production.
- Self-service password change requires the current password; administrators can reset any user's
  password directly.

### 8.2 Role-Based Access Control (RBAC)
Twelve roles (detailed in [§4](#4-user-roles--responsibilities)) are governed by a permission
matrix mapping every functional area to Read / Write / No-Access per role. Beyond the flat role
check, three additional layers of enforcement apply automatically wherever relevant:

- **Organizational scope.** A Department Head's access is confined to their own department; a
  Dean's to every department in their college. This scope is computed at login and travels with
  every request the user makes for the rest of their session — it cannot be widened by the client.
- **Ownership scope.** Faculty can only manage the courses and exams they are actually assigned
  to teach. Enrollment changes on behalf of a student (adding/dropping someone else) are reserved
  for Registrar/Admin — even an instructor cannot alter their own class roster's enrollment,
  only mark attendance and grades within it.
- **Self scope.** Students see and can act on only their own records — enrollment, grades,
  attendance, fee statement, transcript.

A small set of the most sensitive operations — user account management, full-database backup and
restore, and a full system reset — are additionally restricted to the Super Admin role by an
independent, direct check, so they can never be reachable through a misconfiguration of the
general permission tables.

### 8.3 Data Protection
- Uploaded files (documents, photos, receipts, course materials, notice attachments) are stored
  outside any publicly reachable path and are only ever served back through an authenticated
  route that re-checks the requester's access on every download — never a plain static file link.
- Sensitive modules (finance records, teacher/student personal profile fields, the audit log) have
  been through a dedicated hardening pass that removed over-broad read access some roles
  previously had, and tightened what is exposed to which role in profile views.

### 8.4 Audit Trail
Every significant administrative action — account changes, enrollment edits, permission-affecting
operations, progression overrides, and degree confirmations — is written to a permanent,
admin-viewable audit log,
capturing who performed the action, in what role, and (for the most sensitive operations) the
before/after values of what changed. The audit log itself has no update or delete capability
through the application — entries are permanent.

### 8.5 Governance & Transparency
UniScheduler's authorization system is under active, incremental hardening as new modules are
added — the engineering team maintains a living internal audit
([`docs/RBAC_MATRIX.md`](RBAC_MATRIX.md)) of exactly what every role can and cannot do, reviewed
whenever a module changes, rather than relying on point-in-time documentation that goes stale.

---

## 9. Reporting & Business Intelligence

Reporting in UniScheduler is designed so that institutional leadership is not dependent on the
engineering team to answer a new question about the data.

- **Standard analytics dashboards**: room utilization, course popularity, teacher workload, and
  enrollment trend charts, ready out of the box.
- **Custom Report Builder**: any permitted user can build their own report by choosing a data
  area (students, courses, enrollments, attendance, finance, admissions applications), the columns
  they need, filters, and an optional grouping for a chart — with no query language or IT request
  required. Every choice is validated against a strict, pre-approved list on the server, so a
  report can never expose data outside what that user's role is already allowed to see.
- **Saved & reusable reports**: a built report can be saved by name and re-run at any time —
  useful for a recurring board report or monthly departmental summary.
- **Export**: every report and every standard dashboard chart can be exported as a **PDF**
  (formatted, print-ready, with charts rendered directly) or an **Excel workbook** (full, uncapped
  data for further analysis) — directly from the browser.
- **Printable records**: transcripts and student profiles have dedicated print layouts; other
  bulk printable outputs (per-room/per-teacher timetables, class rosters, attendance sheets) are
  scoped as a near-term roadmap item (§23).

---

## 10. Technical Architecture

UniScheduler is built on a modern, low-dependency technology stack chosen for reliability and
long-term maintainability rather than the newest trend:

| Layer | Technology | Why it matters |
|---|---|---|
| Frontend | React 19 + Vite | Fast, responsive interface; large, mature ecosystem with long-term support |
| Internationalization | i18next | Purpose-built for multi-language, RTL-aware applications |
| Charts & Analytics | Recharts | Native, interactive charting for the reporting module |
| Backend | Node.js + Express | Industry-standard, widely supported server framework |
| Database engine | SQLite (Node's built-in driver) | Zero-configuration, no separate database server to install or license, ideal for a self-contained desktop deployment; the architecture is compatible with a move to a client-server database (e.g., PostgreSQL) for the planned cloud edition |
| Authentication | Signed session tokens (JWT) | Stateless, industry-standard session security |
| Desktop packaging | Electron + electron-builder | A genuine one-click Windows installer with automatic update delivery, not a browser bookmark |
| Document/spreadsheet export | PDF and Excel generation libraries | Native, server-rendered exports with no external service dependency |

**Application structure:**
- The **frontend** is organized into 35 page-level screens and a shared component library
  (including a 34-piece modal library), grouped by function (finance, reports, student records,
  faculty tools).
- The **backend** exposes roughly **39 functional modules** as a REST API (full inventory in
  [`docs/API_INVENTORY.md`](API_INVENTORY.md)), plus dedicated engines for prerequisite
  eligibility, academic progression, scheduling conflict detection, report building, notice
  targeting/scheduling, and approval-chain routing — each a focused, independently testable unit
  rather than one monolithic block of logic.
- A **single API client** in the frontend mediates every request, attaching the user's session
  token automatically and translating server errors into readable messages — the UI never talks
  to the database directly.

**Data flow, end to end:** every action a user takes travels from the interface, through the API
client, into an Express route, through authentication and the full authorization stack described
in [§8](#8-security-architecture), and only then reaches the database — with the result reflected
back to the interface and, for most changes, an immediate refresh of the affected data rather than
an optimistic guess at what changed.

---

## 11. Database Overview

UniScheduler's data model spans **60 tables**, organized into clear functional groups rather than
one undifferentiated schema:

| Area | Representative Tables | What It Stores |
|---|---|---|
| Identity & Organization | `users`, `colleges`, `departments`, `programs`, `student_types` | Accounts, roles, and the institution's organizational hierarchy |
| Academic Structure | `terms`, `teachers`, `rooms`, `courses`, `course_offerings`, `course_prerequisites` | The academic catalog and its rules |
| Scheduling | `timetable_slots`, `slot_exceptions`, `exams` | The timetable and exam calendar |
| Enrollment | `enrollments` | Every student's course registration history |
| Admissions | `applications`, `application_documents` | The public application intake pipeline |
| Teaching (LMS) | `assignments`, `assignment_submissions`, `announcements`, `course_materials`, `grade_items`, `grade_scores` | Coursework, materials, and grading |
| Student Records | `student_profiles`, `student_documents`, `semester_records` | Profiles, documents, and per-semester academic outcomes |
| Graduation | `graduation_records` | Conferred degrees and certificate numbers |
| Finance | `fee_rules`, `fee_items`, `payments`, `finance_transactions`, `fee_plans`, `installments`, `student_financial_aid` | The complete fee and payment ledger |
| Notices | `notices`, `notice_target_groups`, `notice_recipients`, `notice_attachments` | Institution-wide targeted communications |
| Reporting | `report_definitions` | Saved custom reports |
| Approvals | `approval_requests`, `approval_chain_steps`, `approval_decisions` | Multi-step approval workflows (e.g., appeals) |
| Security & Governance | `permissions`, `role_permissions`, `user_roles`, `audit_log` | Access control and the administrative audit trail |

**Design characteristics an evaluator should know:**
- **Financial and academic integrity by ledger, not by cached numbers.** A student's fee balance
  is always computed from the full transaction history, and a student's GPA is always computed
  from actual graded coursework — neither is a value that can silently drift out of sync with its
  source data.
- **Nothing is silently deleted.** Enrollment withdrawals are recorded as a status change, not a
  row deletion, preserving history for reporting and audit; semester academic outcomes accumulate
  as a permanent record rather than being overwritten on a retake.
- **Referential integrity is enforced** by the database engine on all core relationships (e.g., an
  enrollment cannot reference a course that doesn't exist).

A full table-by-table reference (columns, relationships, and which module owns each table) is
maintained in [`docs/DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) for technical due diligence.

---

## 12. APIs & Integration Layer

UniScheduler's frontend and backend communicate over a documented, versioned-by-module REST API —
the same API surface that would be used for any future integration or a mobile client.

- **~39 functional route modules** covering every capability in [§6](#6-feature-modules), each
  independently authorized (see [§8](#8-security-architecture)).
- **Consistent conventions**: list endpoints support filtering and (for large tables) pagination;
  every write operation is validated server-side regardless of what the interface already
  validated client-side; every response is JSON.
- **A dedicated export surface**: any report or dashboard the interface can display can also be
  requested as a PDF or Excel file through the same authenticated API, at no additional permission
  cost beyond what viewing already required.
- **Health and diagnostics**: a system-health endpoint for monitoring, and a structured audit-log
  endpoint for compliance review.

A complete, endpoint-by-endpoint technical reference is maintained in
[`docs/API_INVENTORY.md`](API_INVENTORY.md) for an institution's technical team or a future
integration partner.

---

## 13. Deployment Options

| Option | Status | Description |
|---|---|---|
| **Desktop (Embedded)** | Available today | A one-click Windows installer. The application and database run entirely on one machine — ideal for a single-office or pilot deployment with no server infrastructure required. |
| **Shared Network (Client/Server)** | Available today | One machine on the campus network hosts the database; every other office runs the desktop application in "client" mode, connecting over the LAN so the whole institution shares one live dataset. |
| **Cloud / Browser Access** | On the roadmap (see [§23](#23-future-roadmap)) | A hosted version accessible from any browser, so students and faculty never need to install anything. The application architecture (a standard web API and a standard web frontend) already supports this; what remains is the hosting, security-hardening, and — for institutions comparing a shared vs. dedicated hosting model — a decision on multi-tenant vs. single-tenant hosting. |

Both delivery models available today include:
- Automatic update delivery (the desktop application checks for and installs updates
  automatically once released).
- License-key activation, so deployment is controlled and traceable per institution
  (see [§20 Licensing](#20-licensing)).

---

## 14. Screenshots

> *Screenshots of the live application — Dashboard (per role), Course Catalog, Enrollment,
> Timetable/Weekly Calendar, Gradebook, Finance/Bursar Dashboard, Custom Report Builder, and the
> Admissions review queue — are inserted here for the proposal-ready version of this document.*

| Module | Screenshot |
|---|---|
| Role-specific Dashboard (Admin / Registrar / Bursar / Faculty / Student) | `[placeholder]` |
| Course Catalog & Enrollment | `[placeholder]` |
| Weekly Timetable & Conflicts | `[placeholder]` |
| Gradebook | `[placeholder]` |
| Finance / Bursar Dashboard | `[placeholder]` |
| Custom Report Builder | `[placeholder]` |
| Admissions Review Queue | `[placeholder]` |
| Student Transcript | `[placeholder]` |
| Graduation Worklist & Degree Certificate | `[placeholder]` |
| Language Switcher (RTL — Pashto/Dari) | `[placeholder]` |

---

## 15. Implementation Process

A typical institutional rollout follows five phases:

1. **Discovery & Configuration** — confirm colleges/departments/programs, grading scale, fee
   structure, and role assignments against the institution's actual policies (all
   admin-configurable, not code changes).
2. **Data Migration** — import existing academic and student data (see [§16](#16-data-migration)).
3. **Pilot** — run one term (or one department) live alongside existing processes to validate
   configuration before a full cutover.
4. **Institution-wide Rollout** — activate all departments/colleges, train staff and faculty by
   role, and open student self-service access.
5. **Steady-state Operation** — ongoing use with the update/support model described in
   [§21](#21-support--maintenance).

Role-based training is short by design: each role's interface only shows what that role can act
on, so a Bursar's onboarding, for example, does not require walking through registrar or faculty
screens they will never see.

---

## 16. Data Migration

Institutions coming from spreadsheets, a legacy system, or paper records typically migrate in
this order, each of which UniScheduler supports via **bulk import**:

1. Organizational structure (colleges, departments, programs) — set up directly, typically a
   small, one-time task.
2. **Courses** — bulk import from a spreadsheet.
3. **User accounts** — bulk CSV import for staff and student accounts (each receiving a one-time
   password).
4. **Existing timetable** — if the institution already has a published timetable, it can be
   **imported directly from a PDF**, parsed automatically with a review step before it's committed.
5. **Historical academic records** (past enrollments/grades, for institutions that want continuous
   transcript history rather than starting the record from go-live) — handled as a guided,
   case-by-case data-loading exercise during implementation, since the shape of legacy data varies
   institution to institution.

Whole-database backup and restore tooling is available from day one, so a migration can always be
rolled back to a known-good state during the pilot phase.

---

## 17. Integrations

| Integration | Status |
|---|---|
| **Outbound email (SMTP)** | Built and ready — admissions notifications (credentials, status updates) are coded to send automatically the moment the institution provides SMTP credentials during deployment; currently dormant only because no institution has configured it yet. |
| **Institution-wide notice delivery via email/SMS** | Architecture supports it (the targeting engine already resolves precise recipient lists); adding the delivery channel itself is scoped as near-term roadmap work. |
| **PDF timetable import** | Available today — brings an existing external timetable into the system. |
| **Single Sign-On (SSO) / institutional directory (e.g., Active Directory, Google Workspace)** | Not yet built; a common request for larger institutions and a candidate for a future release once prioritized. |
| **Payment gateways** | Finance module currently records payments made through the institution's existing collection channels (cash, bank receipt, etc.); direct online payment-gateway integration is a candidate future addition. |

UniScheduler deliberately does not ship pre-built integrations that would go unused by most
institutions; where an integration is listed as "not yet built," it reflects genuine roadmap
prioritization, not a hidden limitation discovered after purchase.

---

## 18. Scalability

- **Today's deployment model** (desktop/embedded and shared-network) is designed and proven for a
  single-institution scale: departments, thousands of students, and the corresponding course and
  transaction volume. The Student Management directory, the first area to reach very large record
  counts, already uses server-side pagination rather than loading every record into memory at
  once; other high-volume tables are prioritized for the same treatment as usage grows.
- **The database layer is upgrade-ready.** UniScheduler's database engine is well-suited to a
  single-institution deployment; the planned cloud edition is architected to move to a
  client-server database engine for institutions or hosting models that need higher concurrency,
  without requiring a rewrite of the application logic above it.
- **The permission and scope system was built for scale, not just for a single pilot
  department** — adding a new department, college, or role is a configuration action, not a
  development task, so growth from one department to an entire multi-college university does not
  require engineering involvement.

---

## 19. Benefits

**For institutional leadership (VC/Rector/Dean):**
- A single, real-time view of enrollment, academic performance, and financial position instead of
  waiting on manually compiled reports from separate offices.
- Confidence that sensitive data (grades, finances, personal records) is only accessible to the
  people who should see it, with a permanent audit trail of administrative actions.

**For the Registrar's Office:**
- Enrollment, prerequisites, and scheduling conflicts are enforced automatically, removing a large
  class of manual checking and the errors that come with it.
- Transcripts and academic-progression decisions are generated from real data, not manually
  reconciled spreadsheets.

**For the Bursar's Office:**
- Fee calculation follows configured rules automatically, with a fully auditable record of why
  each student was charged what they were charged — no more disputed "how was this number
  calculated."
- Collections, overdue accounts, and aging are visible on a live dashboard rather than an
  end-of-month manual pull.

**For Faculty:**
- One place for roster, attendance, materials, assignments, and grading per course — no separate
  spreadsheet-per-class habit to maintain.

**For Students:**
- Self-service enrollment, schedule, grades, attendance, fee statement, and transcript, with
  eligibility reasons shown in plain language rather than a rejected request with no explanation.

**For the Institution as a whole:**
- One system reduces the reconciliation burden between admissions, academics, and finance offices
  that separate, unconnected tools create.
- Genuine trilingual support removes a real barrier to adoption in Dari/Pashto-primary
  environments.

---

## 20. Licensing

UniScheduler is a commercially licensed product distributed by **LEMON_Soft**.

- **Activation model**: each installation is gated by a cryptographically signed license key,
  verified offline on first launch — activation does not require a permanent internet connection
  once the license is issued.
- **Update delivery**: licensed installations receive application updates automatically.
- **Licensing terms** (per-institution pricing, seat/user limits, and support-tier terms) are
  commercial matters agreed directly with LEMON_Soft as part of a purchase agreement and are
  intentionally not fixed in this technical document — contact LEMON_Soft for a current
  commercial proposal tailored to your institution's size and deployment model.

---

## 21. Support & Maintenance

- **Software updates**: delivered automatically to licensed installations as new features and
  fixes ship.
- **Configuration support**: assistance during the implementation phases described in
  [§15](#15-implementation-process) — organizational setup, fee-rule configuration, role
  assignment, and data migration.
- **Ongoing support channel and response-time commitments** are defined in the institution's
  support agreement with LEMON_Soft at time of purchase.

---

## 22. Frequently Asked Questions

**Does every staff member see every student's data?**
No. Access is scoped by role — a Department Head only sees their department, a faculty member
only their own courses, an Advisor only their assigned advisees — enforced on the server, not
just hidden in the menu. See [§8](#8-security-architecture).

**Can we configure our own fee structure, grading scale, and academic policy?**
Yes. Fee rules, the grading scale, and the academic-progression policy (e.g., how many failed
courses still allow a student to advance) are all administrator-configurable settings, not
hard-coded values.

**Do students and faculty need to install software?**
Today, the primary delivery is a Windows desktop application (with an optional shared-server mode
so a whole campus works from one database). Browser-based access with no installation is on the
roadmap — see [§13](#13-deployment-options) and [§23](#23-future-roadmap).

**What happens if we lose an admin's password or an account is compromised?**
Any administrator can reset another user's password; the audit log records every administrative
action; and the system supports a full database backup/restore should recovery ever be needed.

**Is our data ever sent to a third party?**
No outbound data transmission occurs unless the institution explicitly configures it (for
example, providing SMTP credentials to enable email notifications). In the desktop deployment
model, the database resides on the institution's own machine(s).

**Can we get our data out if we ever needed to switch systems?**
Yes — full database export/backup and structured report/data export (CSV, Excel, PDF) are
built-in, standard features, not a special request.

**Is the Pashto/Dari translation production-ready?**
Structurally, yes — every screen has complete coverage in all three languages with proper RTL
layout. A native-speaker linguistic accuracy review (wording quality, not completeness) is
recommended before a Pashto/Dari-primary rollout and is an open item the product team tracks
explicitly.

**What if our institution needs a role that isn't in the standard twelve?**
The permission system was designed to add new roles as configuration rather than custom
development — this can typically be scoped as a small implementation task.

---

## 23. Future Roadmap

Presented honestly, in priority order, reflecting the institution's own confirmed direction for
the product:

**Near-term (core gaps for a full university deployment):**
- **Academic calendar enforcement** — term dates, holidays, registration windows, and add/drop
  deadlines actively enforced at enrollment (the underlying date fields already exist).
- **Full programs & curriculum model** — semester-by-semester curriculum plans and a degree-audit
  view (taken vs. required vs. remaining).
- **Multi-section courses** — multiple sections of the same course in one term, each with its own
  teacher/time/enrollment, rather than one section per course.
- **Student status lifecycle** — full history and enforcement effects (e.g., blocking enrollment)
  for On Leave/Suspended/Withdrawn status changes, building on the status field already in place.
- **Scheduled, automatic backups** — the current manual backup/restore tool moving to a scheduled,
  automatic rotation.
- **Printable outputs** — per-room and per-teacher timetables, class rosters, and attendance
  sheets as first-class printable/PDF documents.

**Mid-term:**
- **Full automatic timetable generation** — the one-click, constraint-solving scheduler described
  in [§7](#7-scheduling-engine), following teacher-availability and room-feature data.
- **Browser-based (cloud) access** — hosted deployment reachable from any device, no installation
  required.
- **Email/SMS delivery channels** for institution-wide notices, building on the existing targeting
  engine.
- **Grade-publishing workflow** — a draft-then-published step so students never see partially
  entered grades.

**Longer-term / market-dependent:**
- **Alumni directory** — a dedicated post-graduation record/list view, building on the graduation
  confirmation and degree-certificate issuance already shipped (see
  [§6.8](#6-feature-modules)).
- **Single Sign-On / institutional directory integration.**
- **SMS gateway integration**, where relevant to the target market.

This roadmap is maintained against the same living engineering ledger used to run the product
(`PROJECT-PROGRESS.md`), so priorities shown here reflect actual planning, not marketing
aspiration.

---

## 24. Appendices

### Appendix A — Role–Permission Matrix (summary)

| Module | Full Access | Read Access | Restricted To |
|---|---|---|---|
| User Accounts | Super Admin | — | Super Admin only |
| Courses | Registrar, Dean*, Dept. Head* | Exam Officer, Records Officer, Viewer, Faculty*, Student | *scoped to own department/college/course |
| Enrollment | Registrar | Faculty (own course, read), Student (own record) | Roster changes: Registrar/Admin only |
| Timetable | Registrar, Dean*, Dept. Head* | Exam Officer, Viewer, Faculty, Student | *scoped |
| Exams | Registrar, Exam Officer, Dean*, Dept. Head* | Viewer, Faculty, Student | *scoped |
| Attendance | Faculty (own course) | Viewer, Student (own record) | — |
| Grades | Faculty (own course), Records Officer | Viewer, Student (own record) | — |
| Finance | Bursar | — (Viewer access removed in a 2026 security hardening pass) | Fee/policy configuration: Super Admin only |
| Admissions | Admissions Officer | Registrar, Dean*, Dept. Head*, Viewer | *scoped |
| Graduation | Registrar, Records Officer | — | Certificate download: the graduated student themselves, always |
| Announcements (institution-wide) | Registrar, Dean*, Dept. Head* | Viewer | *scoped |
| Backups / System Reset / Audit Log | Super Admin | — | Super Admin only |
| Reports | Records Officer, Registrar | Viewer | — |

*Full role-by-role, module-by-module detail — including every scope and ownership rule — is
maintained in [`docs/RBAC_MATRIX.md`](RBAC_MATRIX.md).*

### Appendix B — Module-to-Data Map

| Feature Module | Primary Database Tables | Primary API Surface |
|---|---|---|
| Admissions | `applications`, `application_documents` | `/applications/*` |
| Academic Structure | `departments`, `colleges`, `programs`, `terms`, `courses`, `teachers`, `rooms` | `/departments`, `/colleges`, `/programs`, `/terms`, `/courses/*`, `/teachers`, `/rooms` |
| Scheduling | `timetable_slots`, `slot_exceptions`, `exams` | `/slots/*`, `/exams/*`, `/conflicts/*` |
| Enrollment | `enrollments`, `course_prerequisites` | `/enrollments/*` |
| Teaching/LMS | `assignments`, `grade_items`, `grade_scores`, `course_materials`, `announcements` | `/assignments/*`, `/grades/*`, `/materials/*` |
| Student Records | `student_profiles`, `semester_records` | `/student-profile/*`, `/progression/*`, `/transcript/*` |
| Graduation | `graduation_records` | `/graduation/*` |
| Finance | `fee_rules`, `finance_transactions`, `fee_plans`, `payments` | `/finance/*` |
| Notices | `notices`, `notice_recipients` | `/notices/*` |
| Reports | `report_definitions` | `/reports/*` |
| Approvals | `approval_requests` | `/approvals/*` |

### Appendix C — Glossary

- **RBAC** — Role-Based Access Control; restricting what a user can see/do based on their assigned
  role.
- **Scope** — the subset of the institution's data a role is confined to (e.g., a department or
  college), enforced automatically rather than by convention.
- **Prerequisite / Corequisite** — a course that must be completed before (prerequisite) or
  alongside (corequisite) another.
- **GPA / CGPA** — Grade Point Average (per term) / Cumulative GPA (across all terms).
- **Financial Hold** — an automatic restriction (e.g., blocking new enrollment) applied when a
  student's unpaid balance exceeds a configured threshold.
- **Degree Conferral** — the Registrar/Records Officer action that marks a Graduation Eligible,
  financially cleared student as Graduated and permanently records the degree and a unique
  certificate number.
- **Audit Log** — a permanent record of administrative actions, including who performed them and
  what changed.
- **Embedded deployment** — the desktop mode where the application and its database run entirely
  on one machine.
- **Client/Server (shared) deployment** — the desktop mode where multiple installations share one
  database over a network.

### Appendix D — Current Technology Versions

| Component | Version |
|---|---|
| React | 19 |
| Node.js | ≥ 22.5 (LTS-track) |
| Express | 4.x |
| Database engine | SQLite (Node built-in driver) |
| PDF export | pdfkit |
| Excel export | exceljs |
| Desktop packaging | Electron + electron-builder (NSIS installer for Windows) |

---

*This document is generated and maintained directly from the UniScheduler source code and
database schema. It is refreshed whenever a module, role, permission, or workflow changes, so
that it remains an accurate representation of the product for any institution reviewing it for
purchase. Underlying technical detail is maintained in
[`docs/SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md),
[`docs/FEATURE_INVENTORY.md`](FEATURE_INVENTORY.md), [`docs/RBAC_MATRIX.md`](RBAC_MATRIX.md),
[`docs/DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md), and [`docs/API_INVENTORY.md`](API_INVENTORY.md);
this document translates that detail into proposal-ready language for a non-technical, executive
audience and should never contradict the underlying source-of-truth requirements ledger,
[`PROJECT-PROGRESS.md`](../PROJECT-PROGRESS.md).*
