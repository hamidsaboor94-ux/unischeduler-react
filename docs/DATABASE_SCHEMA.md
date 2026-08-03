# UniScheduler — Database Schema

> Generated from a full read of `uni scheduling/api/src/db.js` on 2026-07-30, updated 2026-08-02
> (added `graduation_records`). SQLite via `node:sqlite`, `PRAGMA foreign_keys = ON`. Reflects the
> **effective** schema — i.e. base `CREATE TABLE IF NOT EXISTS` columns plus every
> `ensureColumn()`/`ALTER TABLE ADD COLUMN` migration applied on top, since those are scattered
> through the file rather than co-located.
>
> **Migration model**: there is no versioned migration system. Schema changes are additive,
> idempotent `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` calls that run on every server start.
> This is a known gap (PROJECT-PROGRESS.md §3.7 — "DB migration strategy").
>
> **Foreign key note**: SQLite's `ALTER TABLE ADD COLUMN` cannot carry a `REFERENCES` clause. Any
> column added after the table's initial creation (marked *ensureColumn* below) is therefore an
> **informal, unenforced** foreign key — the relationship is real in application logic but SQLite
> does not enforce it. Only columns present in the original `CREATE TABLE` block have a real,
> enforced FK constraint.

**60 tables total.** Grouped below by functional area for readability.

---

## Core identity & org structure

### `users`
**Purpose**: login accounts for every role.
**Columns**: `id` PK, `name`, `email` UNIQUE, `passwordHash`, `role`, `createdAt`,
`mustChangePassword` (ensureColumn), `language` (ensureColumn, default `'en'`),
`departmentId` (ensureColumn, informal FK), `collegeId` (ensureColumn, informal FK),
`idNumber` (ensureColumn).
**Relationships**: referenced by nearly every other table (`studentId`/`userId`/`createdBy`/etc.).
**Foreign keys**: none enforced (department/college links added post-creation).
**Indexes**: `idx_users_idnumber` UNIQUE on `idNumber`.
**Related modules**: Auth, Accounts, every module (universal actor reference).

### `colleges`
**Purpose**: top-level org grouping of departments (Dean scope unit).
**Columns**: `id` PK, `name` UNIQUE NOT NULL.
**Relationships**: parent of `departments`; referenced by `users.collegeId`.
**Related modules**: Academic Structure, RBAC (Dean scope).

### `departments`
**Purpose**: academic departments.
**Columns**: `id` PK, `name` UNIQUE NOT NULL, `collegeId` (ensureColumn, informal FK → colleges.id).
**Related modules**: Academic Structure, RBAC (Dept Head scope), Courses, Teachers, Students, Finance.

### `programs`
**Purpose**: a degree/major track within a department.
**Columns**: `id` PK, `name` NOT NULL, `departmentId` → departments(id), `degreeLevel`,
`totalCredits`, `createdAt`, `numberOfSemesters` (ensureColumn).
**Indexes**: `idx_programs_departmentId`.
**Related modules**: Academic Structure, Student Records (academic progression), Finance (fee scoping).

### `student_types`
**Purpose**: configurable student categories (Regular/International/Scholarship/etc.) for fee differentiation.
**Columns**: `id` PK, `name` UNIQUE NOT NULL, `isActive` DEFAULT 1, `sortOrder` DEFAULT 0, `createdAt`.
**Related modules**: Finance (hierarchical fee rules).

### `terms`
**Purpose**: academic semesters/terms.
**Columns**: `id` PK, `name`, `startDate`, `endDate`, `isActive`, `offDays` (ensureColumn, JSON),
`creditLimit` (ensureColumn), `examStartDate`/`examEndDate` (ensureColumn),
`registrationOpensAt`/`registrationClosesAt` (ensureColumn).
**Related modules**: Scheduling, Enrollment, Exams, Finance — nearly universal term-scoping key.

---

## People: teachers & rooms

### `teachers`
**Purpose**: faculty scheduling-facing record.
**Columns**: `id` PK, `name` NOT NULL, `departmentId` → departments(id), `userId` → users(id).
**Related modules**: Academic Structure, Faculty Profile, Courses, Exams, Attendance.

### `rooms`
**Purpose**: physical rooms for classes/exams.
**Columns**: `id` PK, `name` NOT NULL, `type`, `capacity`, `equipment`.
**Related modules**: Scheduling, Exams, Conflicts.

### `teacher_profiles`
**Purpose**: faculty HR profile (personal/employment/academic), 1:1 via `teacherId`.
**Columns**: `teacherId` PK → teachers(id) ON DELETE CASCADE, plus ~35 profile fields (gender,
dateOfBirth, phone, personalEmail, address, photoPath, designation, employmentType,
dateOfJoining, status, bio, qualifiedSubjects, employeeId, preferredName, fatherName,
motherName, nationality, nationalId, maritalStatus, officialEmail, secondaryPhone, emergency
contact fields, permanentAddress/city/province/country/postalCode, contractStartDate/EndDate,
officeRoom, reportingManagerId (informal FK → teachers.id), employeeCategory, payrollId,
workLocation, expertiseAreas, researchInterests, teachingInterests, publications, awards,
officeHours) — most added via ensureColumn during the 2026-07-25 faculty onboarding feature.
**Related modules**: Faculty Onboarding, Teacher Profile.

### `teacher_education`
**Purpose**: a teacher's degrees/qualifications.
**Columns**: `id` PK, `teacherId` → teachers(id) ON DELETE CASCADE, `degree` NOT NULL,
`fieldOfStudy`, `institution`, `year`, `documentPath`, `createdAt`, `country` (ensureColumn),
`startYear` (ensureColumn), `gpa` (ensureColumn), `verificationStatus` (ensureColumn, default
`'Pending'`), `transcriptPath` (ensureColumn), `notes` (ensureColumn).
**Indexes**: `idx_teacher_education_teacherId`.
**Related modules**: Faculty Onboarding, Teacher Profile.

### `teacher_experience`
**Purpose**: a teacher's prior employment history.
**Columns**: `id` PK, `teacherId` → teachers(id) ON DELETE CASCADE, `organization` NOT NULL,
`position`, `department`, `employmentType`, `startDate`, `endDate`, `currentlyWorking` DEFAULT 0,
`responsibilities`, `documentPath`, `verificationStatus` DEFAULT `'Pending'`, `createdAt`.
**Indexes**: `idx_teacher_experience_teacherId`.
**Related modules**: Faculty Onboarding, Teacher Profile.

### `teacher_certifications`
**Purpose**: professional certifications/licenses.
**Columns**: `id` PK, `teacherId` → teachers(id) ON DELETE CASCADE, `name` NOT NULL,
`issuingOrganization`, `certificationNumber`, `issueDate`, `expiryDate`, `doesNotExpire` DEFAULT 0,
`documentPath`, `verificationStatus` DEFAULT `'Pending'`, `createdAt`.
**Indexes**: `idx_teacher_certifications_teacherId`.
**Related modules**: Faculty Onboarding, Teacher Profile.

### `teacher_documents`
**Purpose**: general faculty documents (CV, contract, certificates).
**Columns**: `id` PK, `teacherId` → teachers(id) ON DELETE CASCADE, `docType` NOT NULL,
`filePath` NOT NULL, `fileName` NOT NULL, `mimeType` NOT NULL, `uploadedBy` → users(id),
`createdAt`, `issueDate`/`expiryDate` (ensureColumn), `verificationStatus` (ensureColumn, default
`'Pending'`), `verifiedBy` (ensureColumn, informal FK → users.id), `verifiedAt` (ensureColumn),
`notes` (ensureColumn).
**Indexes**: `idx_teacher_documents_teacherId`.
**Related modules**: Faculty Onboarding, Teacher Profile.

---

## Courses & prerequisites

### `courses`
**Purpose**: courses offered.
**Columns**: `id` PK, `code` NOT NULL, `name` NOT NULL, `departmentId` → departments(id),
`credits`, `teacherId` → teachers(id), `roomId` → rooms(id), `maxStudents`, `termId` → terms(id),
`programId` (ensureColumn, informal FK → programs.id).
**Indexes**: `idx_courses_code_term` UNIQUE `(code, termId)`; `idx_courses_departmentId`;
`idx_courses_teacherId`.
**Related modules**: Academic Structure, Scheduling, Enrollment, Eligibility, Gradebook.

### `course_prerequisites`
**Purpose**: prerequisite/corequisite relationships between courses.
**Columns**: `courseId` → courses(id), `prerequisiteCourseId` → courses(id) — composite PK,
`groupId` (ensureColumn — NULL = required/AND, shared value = OR-set), `type` (ensureColumn,
default `'prerequisite'`, or `'corequisite'`).
**Foreign keys**: composite PK `(courseId, prerequisiteCourseId)`.
**Related modules**: Enrollment Eligibility Engine.

### `course_offerings`
**Purpose**: term-specific binding of a course to teacher/room/section/capacity (backfilled from
`courses` on every startup — a superset alongside `courses`' own columns, part of the multi-section
groundwork).
**Columns**: `id` PK, `courseId` → courses(id), `termId` → terms(id), `section`,
`teacherId` → teachers(id), `roomId` → rooms(id), `maxStudents`, `createdAt`.
**Indexes**: `idx_course_offerings_courseId`, `idx_course_offerings_termId`,
`idx_course_offerings_teacherId`.
**Related modules**: Scheduling, Courses (known FK-on-delete gotcha — see PROJECT-PROGRESS.md §2.8).

---

## Curriculum Management *(Phase 1: schema + read-only report only — see PROJECT-PROGRESS.md §3.1)*

### `curriculum`
**Purpose**: one versioned curriculum plan for a program (Program → **Version**).
**Columns**: `id` PK, `programId` NOT NULL → programs(id) ON DELETE RESTRICT, `curriculumName`
NOT NULL, `academicYear` (free-text label, e.g. `'2025-2026'` — **not** a FK; this schema has no
`academic_years` table, only per-term `terms`), `effectiveFrom`, `effectiveTo`, `totalCredits`,
`status` DEFAULT `'Draft'` (app-validated: `'Draft'|'Active'|'Archived'`, no CHECK constraint),
`createdAt`, `updatedAt`.
**Indexes**: `idx_curriculum_programId`.
**Related modules**: Curriculum Management.

### `curriculum_semester`
**Purpose**: one semester slot within a curriculum version (Version → **Semester**).
**Columns**: `id` PK, `curriculumId` NOT NULL → curriculum(id) ON DELETE RESTRICT,
`semesterNumber` NOT NULL, `name`, `minimumCredits`, `maximumCredits`.
**Foreign keys/constraints**: UNIQUE `(curriculumId, semesterNumber)`.
**Indexes**: `idx_curriculum_semester_curriculumId`.
**Related modules**: Curriculum Management.

### `elective_group`
**Purpose**: a named elective bucket within a curriculum (e.g. "Free Electives") — courses in
`curriculum_course` opt into one via `electiveGroupId`.
**Columns**: `id` PK, `curriculumId` NOT NULL → curriculum(id) ON DELETE RESTRICT, `name` NOT NULL,
`requiredCount`, `requiredCredits`.
**Indexes**: `idx_elective_group_curriculumId`.
**Related modules**: Curriculum Management.

### `curriculum_course`
**Purpose**: one course attached to a curriculum semester (Semester → **Courses**), with
required/elective flag and sequencing (Program → Version → Semester → Courses).
**Columns**: `id` PK, `curriculumSemesterId` NOT NULL → curriculum_semester(id) ON DELETE RESTRICT,
`courseId` NOT NULL → courses(id) ON DELETE RESTRICT, `required` DEFAULT `1`, `electiveGroupId` →
elective_group(id) ON DELETE RESTRICT (nullable), `minimumGrade`, `sequence`, `notes`.
**Indexes**: `idx_curriculum_course_curriculumSemesterId`, `idx_curriculum_course_courseId`.
**Gotcha**: `courseId` points at a `courses` row, which is itself a per-term row (see `courses`
above) — there is no term-independent course-catalog table. A curriculum listing is pinned to
whichever term's course row it was authored against; matching a student's actual completions
across terms needs to join on `courses.code`, not `courseId`.
**Related modules**: Curriculum Management.

### `student_curriculum`
**Purpose**: which curriculum version a student is assigned to. No row = curriculum checks are
skipped for that student.
**Columns**: `id` PK, `studentId` NOT NULL → users(id) ON DELETE RESTRICT, `curriculumId` NOT NULL
→ curriculum(id) ON DELETE RESTRICT, `assignedAt`.

Phase 2 adds `assignedBy`, `status`, and `notes`. The row is the current-assignment pointer;
`student_curriculum_history` is the append-only assignment ledger with one partial-unique active
row per student. `curriculum_registration_overrides` records authorized semester-recommendation
overrides and their mandatory reason. Curriculum semester/course/elective tables also gain the
versioned-model fields and timestamps; `(curriculumSemesterId, courseId)` is unique.
**Foreign keys/constraints**: UNIQUE `(studentId)`.
**Note**: left empty for every pre-existing student as of the 2026-08-02 migration — no
grandfather rule decided yet; `db.js`'s `init()` logs the unassigned count on every startup.
**Related modules**: Curriculum Management.

### `holds`
**Purpose**: generic student hold (financial/disciplinary/academic), so graduation clearance (and
later, registration) can query one shape instead of each blocking condition inventing its own
flag. Distinct from `finance.js`'s `hasFinancialHold()`, which is a *computed* (balance > 0) view
over `finance_transactions`, not a persisted row here — nothing currently writes a `'financial'`
row to this table.
**Columns**: `id` PK, `studentId` NOT NULL → users(id) ON DELETE RESTRICT, `type` NOT NULL
(`'financial'|'disciplinary'|'academic'`, app-validated), `active` DEFAULT `1`, `reason`,
`placedBy` → users(id) ON DELETE RESTRICT, `createdAt`.
**Indexes**: `idx_holds_studentId`.
**Related modules**: Curriculum Management, Graduation (future).

---

## Scheduling & exams

### `timetable_slots`
**Purpose**: weekly recurring class meeting slots.
**Columns**: `id` PK, `courseId` → courses(id), `day` NOT NULL, `time` NOT NULL,
`durationMinutes` DEFAULT 60, `roomId` → rooms(id), `termId` → terms(id),
`programSemester` (ensureColumn), `section` (ensureColumn).
**Indexes**: `idx_slots_courseId`.
**Related modules**: Scheduling & Timetabling, Attendance, Conflicts.

### `slot_exceptions`
**Purpose**: one-off cancellation/reschedule of a single dated occurrence of a slot.
**Columns**: `id` PK, `slotId` NOT NULL → timetable_slots(id) ON DELETE CASCADE, `date` NOT NULL,
`kind` NOT NULL (`'cancelled'|'rescheduled'`), `newDate`, `newTime`, `newRoomId` → rooms(id),
`newDurationMinutes`, `note`, `createdAt`.
**Foreign keys/constraints**: UNIQUE `(slotId, date)`.
**Related modules**: Scheduling & Timetabling.

### `exams`
**Purpose**: exam scheduling per course.
**Columns**: `id` PK, `courseId` → courses(id), `date`, `time`, `durationMinutes` DEFAULT 120,
`roomId` → rooms(id), `invigilatorId` → teachers(id), `termId` → terms(id), `type` (ensureColumn,
default `'final'`, or `'quiz'`/`'midterm'`).
**Related modules**: Exams & Assessment.

---

## Enrollment, attendance & LMS

### `enrollments`
**Purpose**: student registration in a course, grade + lifecycle status.
**Columns**: `id` PK, `studentId` → users(id), `courseId` → courses(id), `status` DEFAULT
`'enrolled'`, `grade`, `createdAt`, `deletedAt` (ensureColumn — soft-delete marker), `withdrawal
Date`/`withdrawalReason` (ensureColumn).
**Indexes**: `idx_enrollments_studentId`, `idx_enrollments_courseId`.
**Related modules**: Enrollment, Eligibility Engine, Gradebook, Transcript.

### `attendance`
**Purpose**: per-session, per-student attendance record.
**Columns**: `id` PK, `slotId` NOT NULL → timetable_slots(id) ON DELETE CASCADE, `courseId` NOT
NULL → courses(id), `studentId` NOT NULL → users(id), `date` NOT NULL, `status` NOT NULL,
`markedBy` → users(id), `createdAt`, `updatedAt`.
**Foreign keys/constraints**: UNIQUE `(slotId, studentId, date)`.
**Indexes**: `idx_attendance_studentId`.
**Related modules**: Attendance.

### `assignments`
**Purpose**: faculty-posted course assignments.
**Columns**: `id` PK, `courseId` NOT NULL → courses(id) ON DELETE CASCADE, `title` NOT NULL,
`description`, `dueDate`, `maxMarks`, `createdBy` → users(id), `createdAt`.
**Related modules**: Teaching/LMS.

### `assignment_submissions`
**Purpose**: a student's submission for an assignment.
**Columns**: `id` PK, `assignmentId` NOT NULL → assignments(id) ON DELETE CASCADE, `studentId`
NOT NULL → users(id) ON DELETE CASCADE, `fileName`, `fileMimeType`, `textResponse`,
`marksAwarded`, `feedback`, `submittedAt`.
**Foreign keys/constraints**: UNIQUE `(assignmentId, studentId)`.
**Related modules**: Teaching/LMS.

### `announcements`
**Purpose**: per-course faculty text notice (**distinct** from the university-wide `notices` system).
**Columns**: `id` PK, `courseId` NOT NULL → courses(id) ON DELETE CASCADE, `message` NOT NULL,
`createdBy` → users(id), `createdAt`.
**Related modules**: Teaching/LMS (course quick-actions).

### `course_materials`
**Purpose**: downloadable files posted by faculty for a course.
**Columns**: `id` PK, `courseId` NOT NULL → courses(id) ON DELETE CASCADE, `title` NOT NULL,
`fileName` NOT NULL, `fileMimeType`, `createdBy` → users(id), `createdAt`.
**Related modules**: Teaching/LMS.

### `course_activity_reads`
**Purpose**: per-student "last viewed" timestamp for a course's activity card (separate mechanism
from `notifications.isRead` — two distinct unread systems by design).
**Columns**: `id` PK, `studentId` NOT NULL → users(id) ON DELETE CASCADE, `courseId` NOT NULL →
courses(id) ON DELETE CASCADE, `lastViewedAt` NOT NULL.
**Foreign keys/constraints**: UNIQUE `(studentId, courseId)`.
**Related modules**: Teaching/LMS (course quick-actions dot indicator).

### `grade_items`
**Purpose**: a gradebook column (assignment/quiz/midterm/exam/final) worth `maxScore` points.
**Columns**: `id` PK, `courseId` NOT NULL → courses(id) ON DELETE CASCADE, `name` NOT NULL,
`category` NOT NULL DEFAULT `'assignment'`, `maxScore` REAL NOT NULL DEFAULT 100, `createdAt`.
**Related modules**: Gradebook.

### `grade_scores`
**Purpose**: one student's score on one grade item.
**Columns**: `id` PK, `gradeItemId` NOT NULL → grade_items(id) ON DELETE CASCADE, `studentId`
NOT NULL → users(id) ON DELETE CASCADE, `score`, `updatedAt`.
**Foreign keys/constraints**: UNIQUE `(gradeItemId, studentId)`.
**Related modules**: Gradebook, Transcript (GPA computation), Academic Progression.

---

## Student records & admissions

### `student_profiles`
**Purpose**: one row per student — biographical, academic-standing, admin-managed profile data
(lazily created on first access).
**Columns**: `studentId` PK → users(id) ON DELETE CASCADE, plus ~30 fields: fatherName,
grandfatherName, gender, dateOfBirth, nationality, nationalId, passportNumber,
presentAddress/permanentAddress, mobileNumber, emergencyContact, entryTestMarks, sponsor,
specialization, advisorTeacherId → teachers(id), departmentId → departments(id),
programSemester, section, admissionStatus (default `'Approved'`), enrollmentStatus (default
`'Regular'`), previousSchoolName, previousGraduationYear, updatedAt, graduationStatus/
graduationDate/degreeAwarded (ensureColumn), semesterStatus (ensureColumn, default `'In
Progress'`), studentStatus (ensureColumn, default `'Active'`), batch (ensureColumn), photoPath
(ensureColumn), applicationId (ensureColumn, informal FK → applications.id), enrollmentDate
(ensureColumn), programId (ensureColumn, informal FK → programs.id), studentTypeId
(ensureColumn, informal FK → student_types.id).
**Indexes**: `idx_student_profiles_batch`, `idx_student_profiles_studentStatus`.
**Related modules**: Student Records, Academic Progression, Advisor role, Finance (studentTypeId),
Graduation (`graduationStatus`/`graduationDate`/`degreeAwarded`, written only by
`routes/graduation.js`).

### `student_documents`
**Purpose**: official admin-uploaded documents for a student.
**Columns**: `id` PK, `studentId` NOT NULL → users(id) ON DELETE CASCADE, `documentType` NOT
NULL, `title` NOT NULL, `fileName` NOT NULL, `mimeType` NOT NULL, `uploadedBy` → users(id),
`createdAt`.
**Related modules**: Student Records.

### `semester_records`
**Purpose**: append-only ledger — one row per student per semester attempt (academic progression).
**Columns**: `id` PK, `studentId` NOT NULL → users(id) ON DELETE CASCADE, `semesterNumber` NOT
NULL, `termId` → terms(id), `status` NOT NULL DEFAULT `'In Progress'`, `creditsAttempted` REAL
DEFAULT 0, `creditsEarned` REAL DEFAULT 0, `termGpa`, `cgpa`, `failedCourses`, `notes`,
`createdBy` → users(id), `startedAt`, `completedAt`.
**Indexes**: `idx_semester_records_studentId`, `idx_semester_records_termId`.
**Related modules**: Academic Progression (semester pass/fail/probation evaluation).

### `graduation_records`
**Purpose**: one canonical row per conferred degree — the permanent graduation/degree record
(added 2026-08-02).
**Columns**: `id` PK, `studentId` NOT NULL → users(id) ON DELETE CASCADE, `degreeAwarded`,
`graduationDate`, `conferredBy` → users(id) (who confirmed it), `certificateNumber` UNIQUE
(format `CERT-<year>-<6-digit zero-padded row id>`), `status` DEFAULT `'Active'`, `createdAt`.
**Indexes**: `idx_graduation_records_studentId`, `idx_graduation_records_certificateNumber` UNIQUE.
**Related modules**: Student Records, Academic Progression, Graduation. This is the only writer of
the previously-dead `student_profiles.graduationStatus`/`graduationDate`/`degreeAwarded` columns
(mirrored onto that table on confirm).

### `applications`
**Purpose**: prospective student's admission application (pre-account).
**Columns**: `id` PK, `fullName` NOT NULL, fatherName, grandfatherName, gender, dateOfBirth,
nationality, nationalId, passportNumber, presentAddress/permanentAddress, mobileNumber,
emergencyContact, `personalEmail` NOT NULL, previousSchoolName, previousGraduationYear,
desiredDepartmentId → departments(id), entryTestMarks, `status` NOT NULL DEFAULT `'Submitted'`,
decisionNote, decidedBy → users(id), decidedAt, createdStudentId → users(id), `source` NOT NULL
DEFAULT `'public'`, createdBy → users(id), createdAt, updatedAt, aidType/aidBasis/aidValue/
aidReason (ensureColumn).
**Related modules**: Admissions.

### `application_documents`
**Purpose**: supporting documents attached to an application (pre-account).
**Columns**: `id` PK, `applicationId` NOT NULL → applications(id) ON DELETE CASCADE,
`documentType` NOT NULL, `title` NOT NULL, `fileName` NOT NULL, `mimeType` NOT NULL,
`uploadedBy` → users(id), `createdAt`.
**Related modules**: Admissions.

---

## Finance

### `payments`
**Purpose**: recorded fee payments/installments (receipts).
**Columns**: `id` PK, `studentId` NOT NULL → users(id), `amount` NOT NULL, `method`,
`reference`, `note`, `receiptNo`, `paidAt`, `createdBy` → users(id), `status` (ensureColumn,
default `'completed'`, or `'reversed'`), `voidedAt`/`voidedBy` (ensureColumn), `termId`
(ensureColumn, informal FK → terms.id), `receiptSnapshot` (ensureColumn, JSON).
**Indexes**: `idx_payments_studentId`.
**Related modules**: Finance.

### `scholarships`
**Purpose**: legacy discount/scholarship record — **schema retained but not read by `finance.js`**;
superseded by `student_financial_aid`.
**Columns**: `id` PK, `studentId` NOT NULL → users(id), `name` NOT NULL, `type` NOT NULL DEFAULT
`'fixed'`, `amount` NOT NULL, `termId` → terms(id), `note`, `createdBy` → users(id), `createdAt`.
**Indexes**: `idx_scholarships_studentId`.
**Related modules**: Finance (legacy, dead code path).

### `term_fee_config`
**Purpose**: per-term fee-per-credit rate/currency — legacy, superseded/fallback under `fee_rules`.
**Columns**: `termId` PK → terms(id), `feePerCredit` NOT NULL DEFAULT 0, `currency`,
`updatedAt`, `updatedBy` → users(id).
**Related modules**: Finance (legacy fallback).

### `fee_items`
**Purpose**: fixed fees per term (admission/library/lab/etc.) on top of per-credit tuition.
**Columns**: `id` PK, `termId` NOT NULL → terms(id), `name` NOT NULL, `amount` NOT NULL,
`appliesTo` NOT NULL DEFAULT `'all'` (legacy: all/dept/program), `appliesToId`, `createdAt`,
`createdBy` → users(id), `scope` (ensureColumn, backfilled: university/department), `scopeId`
(ensureColumn, NOT NULL DEFAULT 0), `studentTypeId` (ensureColumn, informal FK →
student_types.id, NOT NULL DEFAULT 0), `feeType` (ensureColumn, default `'other'`), `mandatory`
(ensureColumn, default 1), `isActive` (ensureColumn, default 1), `effectiveDate` (ensureColumn).
**Indexes**: `idx_fee_items_termId`; `idx_fee_items_scope_unique` UNIQUE
`(termId, name, scope, scopeId, studentTypeId)`.
**Related modules**: Finance (hierarchical fee configuration).

### `fee_rules`
**Purpose**: hierarchical tuition rate rules per (term, org scope, student type).
**Columns**: `id` PK, `termId` NOT NULL → terms(id), `scope` NOT NULL
(`'university'|'college'|'department'|'program'`), `scopeId` NOT NULL DEFAULT 0,
`studentTypeId` NOT NULL DEFAULT 0, `feePerCredit` NOT NULL, `isActive` DEFAULT 1,
`effectiveDate`, `createdAt`, `createdBy` → users(id), `updatedAt`, `updatedBy` → users(id).
**Indexes**: `idx_fee_rules_scope_unique` UNIQUE `(termId, scope, scopeId, studentTypeId)`;
`idx_fee_rules_term`.
**Related modules**: Finance (hierarchical fee resolution engine — College/Dept/Program/StudentType).

### `finance_transactions`
**Purpose**: ledger — every financial event for a student (source of truth for balances).
**Columns**: `id` PK, `studentId` NOT NULL → users(id), `termId` → terms(id), `type` NOT NULL
(`'charge'|'payment'|'adjustment'|'refund'|'aid'`), `amount` NOT NULL, `method`, `reference`,
`description`, `relatedPaymentId` → payments(id), `relatedAidId` → student_financial_aid(id),
`createdAt`, `createdBy` → users(id).
**Indexes**: `idx_finance_transactions_student` `(studentId, termId)`;
`idx_finance_transactions_charge_unique` UNIQUE `(studentId, termId) WHERE type='charge'` (one
live charge row per student/term).
**Related modules**: Finance (ledger, statements, bursar dashboard).

### `finance_charge_lines`
**Purpose**: itemized breakdown behind a generated charge, snapshotted at generate-charges time.
**Columns**: `id` PK, `studentId` NOT NULL → users(id), `termId` NOT NULL → terms(id), `kind`
NOT NULL, `refId`, `label` NOT NULL, `quantity`, `rate`, `amount` NOT NULL, `sourceRuleId`
(ensureColumn, informal FK → fee_rules.id — audit trail of which rule computed the rate).
**Indexes**: `idx_finance_charge_lines_student` `(studentId, termId)`.
**Related modules**: Finance.

### `fee_plans`
**Purpose**: a term's installment template (count of installments).
**Columns**: `id` PK, `termId` NOT NULL UNIQUE → terms(id), `installmentCount` NOT NULL DEFAULT
1, `createdAt`, `updatedAt`.
**Related modules**: Finance.

### `fee_plan_installments`
**Purpose**: each installment's due date/percentage within a fee plan.
**Columns**: `id` PK, `feePlanId` NOT NULL → fee_plans(id) ON DELETE CASCADE, `installmentNo`
NOT NULL, `dueDate`, `percentage`.
**Foreign keys/constraints**: UNIQUE `(feePlanId, installmentNo)`.
**Related modules**: Finance.

### `installments`
**Purpose**: a student's actual generated installment schedule for a term.
**Columns**: `id` PK, `studentId` NOT NULL → users(id), `termId` NOT NULL → terms(id),
`installmentNo` NOT NULL, `amount` NOT NULL, `dueDate`, `paidAmount` NOT NULL DEFAULT 0,
`status` NOT NULL DEFAULT `'pending'`, `createdAt`.
**Foreign keys/constraints**: UNIQUE `(studentId, termId, installmentNo)`.
**Indexes**: `idx_installments_student` `(studentId, termId)`.
**Related modules**: Finance (bursar overdue/upcoming installment dashboards).

### `student_financial_aid`
**Purpose**: scholarship/grant/waiver/discount award — the aid model actually used by Finance.
**Columns**: `id` PK, `studentId` NOT NULL → users(id), `termId` NOT NULL → terms(id), `type`
NOT NULL, `basis` NOT NULL (`'percentage'|'fixed'`), `value` NOT NULL, `status` NOT NULL DEFAULT
`'active'` (`'active'|'revoked'`), `awardedBy` → users(id), `reason`, `createdAt`,
`applicationId` (ensureColumn, informal FK → applications.id).
**Indexes**: `idx_student_financial_aid_student` `(studentId, termId)`.
**Related modules**: Finance, Admissions (aid decided at application time).

---

## Notifications & university-wide notices

### `notifications`
**Purpose**: per-user persistent notices (e.g. class cancellation alerts) — bell icon.
**Columns**: `id` PK, `userId` NOT NULL → users(id) ON DELETE CASCADE, `message` NOT NULL,
`isRead` DEFAULT 0, `createdAt`, `type` (ensureColumn), `courseId` (ensureColumn, informal FK →
courses.id), `entityType`/`entityId` (ensureColumn).
**Related modules**: Notifications bell, Notices (delivery mechanism), Teaching/LMS.

### `notices`
**Purpose**: university-wide targeted announcement system (**distinct** from per-course
`announcements`).
**Columns**: `id` PK, `title` NOT NULL, `message` NOT NULL, `type` NOT NULL DEFAULT `'general'`,
`priority` NOT NULL DEFAULT `'normal'`, `status` NOT NULL DEFAULT `'draft'`
(`draft|scheduled|published|expired|archived|cancelled`), `pinned` DEFAULT 0, `requiresAck`
DEFAULT 0, `actionLabel`, `actionSection`, `scheduledFor`, `publishedAt`, `expiresAt`,
`createdBy` → users(id), `createdByRole`, `createdAt`, `updatedAt`.
**Indexes**: `idx_notices_status`, `idx_notices_scheduledFor`, `idx_notices_expiresAt`,
`idx_notices_publishedAt`.
**Related modules**: University-wide Announcements & Targeted Notifications.

### `notice_target_groups`
**Purpose**: one audience-targeting group within a notice's rules.
**Columns**: `id` PK, `noticeId` NOT NULL → notices(id) ON DELETE CASCADE, `audience` NOT NULL,
`filters` NOT NULL DEFAULT `'{}'` (JSON), `createdAt`.
**Indexes**: `idx_notice_target_groups_noticeId`.
**Related modules**: University-wide Announcements (targeting engine).

### `notice_recipients`
**Purpose**: resolved recipient snapshot for a published notice (frozen at publish time, not
re-evaluated live).
**Columns**: `id` PK, `noticeId` NOT NULL → notices(id) ON DELETE CASCADE, `userId` NOT NULL →
users(id) ON DELETE CASCADE, `status` NOT NULL DEFAULT `'delivered'`, `deliveredAt`, `readAt`,
`acknowledgedAt`.
**Foreign keys/constraints**: UNIQUE `(noticeId, userId)`.
**Indexes**: `idx_notice_recipients_noticeId`, `idx_notice_recipients_userId`.
**Related modules**: University-wide Announcements (analytics, acknowledgment tracking).

### `notice_attachments`
**Purpose**: files attached to a notice.
**Columns**: `id` PK, `noticeId` NOT NULL → notices(id) ON DELETE CASCADE, `fileName` NOT NULL,
`mimeType` NOT NULL, `fileSize`, `uploadedBy` → users(id), `createdAt`.
**Indexes**: `idx_notice_attachments_noticeId`.
**Related modules**: University-wide Announcements.

---

## Approvals (generic chain engine)

### `approval_requests`
**Purpose**: one row per submitted request (currently backs the Appeals flow; engine is generic).
**Columns**: `id` PK, `type` NOT NULL, `subjectType` NOT NULL, `subjectId` NOT NULL → users(id),
`requestedBy` NOT NULL → users(id), `payload`, `currentStepOrder` NOT NULL DEFAULT 1, `status`
NOT NULL DEFAULT `'In Review'`, `createdAt`, `updatedAt`.
**Indexes**: `idx_approval_requests_subject` `(subjectType, subjectId)`.
**Related modules**: Approvals / Appeals.

### `approval_chain_steps`
**Purpose**: ordered reviewer-role chain per request type.
**Columns**: `id` PK, `type` NOT NULL, `stepOrder` NOT NULL, `role` NOT NULL, `label`.
**Foreign keys/constraints**: UNIQUE `(type, stepOrder)`.
**Related modules**: Approvals / Appeals.

### `approval_decisions`
**Purpose**: one row per decision (approve/reject/return) on an approval request.
**Columns**: `id` PK, `requestId` NOT NULL → approval_requests(id), `stepOrder` NOT NULL,
`reviewerId` NOT NULL → users(id), `decision` NOT NULL, `note`, `createdAt`.
**Indexes**: `idx_approval_decisions_request`.
**Related modules**: Approvals / Appeals.

---

## Reporting

### `report_definitions`
**Purpose**: saved, reusable custom report configurations.
**Columns**: `id` PK, `name` NOT NULL, `entity` NOT NULL, `config` NOT NULL (JSON), `chartType`,
`createdBy` → users(id), `createdAt`, `updatedAt`.
**Related modules**: Custom Report Builder.

---

## Authorization (granular system)

### `permissions`
**Purpose**: granular `Module.Action` permission catalog (e.g. `"Courses.Update"`), seeded from
the legacy POLICY object.
**Columns**: `id` PK, `module` NOT NULL, `action` NOT NULL.
**Foreign keys/constraints**: UNIQUE `(module, action)`.
**Related modules**: RBAC (newer granular system) — see [RBAC_MATRIX.md](RBAC_MATRIX.md).

### `role_permissions`
**Purpose**: which roles hold which permission.
**Columns**: `id` PK, `role` NOT NULL, `permissionId` NOT NULL → permissions(id) ON DELETE CASCADE.
**Foreign keys/constraints**: UNIQUE `(role, permissionId)`.
**Indexes**: `idx_role_permissions_role`.
**Related modules**: RBAC. **Caveat**: seeded from POLICY one-way at startup; most routes still
read the in-memory POLICY object directly rather than this table (see RBAC_MATRIX.md ambiguity notes).

### `user_roles`
**Purpose**: secondary roles a user holds in addition to their primary `users.role`.
**Columns**: `id` PK, `userId` NOT NULL → users(id) ON DELETE CASCADE, `role` NOT NULL, `createdAt`.
**Foreign keys/constraints**: UNIQUE `(userId, role)`.
**Indexes**: `idx_user_roles_userId`.
**Related modules**: RBAC — actively consumed by `approvalEngine.js`'s reviewer matching.

### `user_scopes`
**Purpose**: generalized org scope attached to a user (`scopeType`/`scopeId` pairs).
**Columns**: `id` PK, `userId` NOT NULL → users(id) ON DELETE CASCADE, `scopeType` NOT NULL
(`'department'|'college'|'course'|...`), `scopeId` NOT NULL, `createdAt`.
**Foreign keys/constraints**: UNIQUE `(userId, scopeType, scopeId)`.
**Indexes**: `idx_user_scopes_userId`.
**Related modules**: RBAC. **Caveat**: table exists and is seeded (mirrors `users.departmentId`/
`collegeId`) but is **not read/enforced by any code today** — `scope.js` still uses
`users.departmentId`/`collegeId` directly. Documented as inert infrastructure, not a live
enforcement path.

---

## Misc

### `audit_log`
**Purpose**: admin/faculty action audit trail.
**Columns**: `id` PK, `userId`, `userName`, `action` NOT NULL, `entityType` NOT NULL, `entityId`,
`details`, `createdAt`, `role` (ensureColumn — actor's role at time of action), `oldValue`
(ensureColumn, JSON before-state), `newValue` (ensureColumn, JSON after-state).
**Related modules**: Administration & Operations, Centralized Authorization.

### `settings`
**Purpose**: app-wide key-value config (branding, default per-credit fee, grading scale, etc.).
**Columns**: `key` TEXT PRIMARY KEY, `value` TEXT.
**Related modules**: Branding, Grading Scale, Graduation Requirement, Semester Progression Policy.

---
*Last generated: 2026-07-30, updated 2026-08-02 (added `graduation_records`). Update this file
immediately whenever a table, column, index, or FK changes — per the workflow rules in
[RBAC_MATRIX.md](RBAC_MATRIX.md) and the repo's CLAUDE.md.*
