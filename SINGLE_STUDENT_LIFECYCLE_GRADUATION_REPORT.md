# Single-Student Academic Lifecycle and Graduation Verification

## 1. Executive Summary

| Item | Result |
|---|---|
| Student graduated successfully | **Yes** — through the application, four ordered approvals, final eligibility audit, and explicit finalization route |
| Overall result | **Failed** — graduation succeeded, but critical post-graduation integrity requirements failed |
| Isolated database | `DB_PATH=:memory:`; discarded automatically when the test process exited |
| Semesters completed | 2 configured semesters |
| Credits earned | 36 |
| Final CGPA | 3.00 |
| Graduation record | `GR-2026-000001`, conferred 2026-12-31 |
| Unresolved blockers/gaps | 8 |
| Defects fixed and reverified | 2 |
| Automated result | 7 passed, 0 failed, 6 explicit TODOs |

The academic and formal graduation path completed without changing production data. Enrollment,
attendance, assessment scoring, grade publication, GPA calculation, transcript generation,
progression, finance clearance, approval decisions, finalization, registry search, issuance events,
reports, notifications, and audit logging were exercised through the real application routes.

The system is **not currently safe for real university graduation processing**. A faculty user was
able to change grades after graduation and after transcript issuance, the graduate retained 12
`enrolled` rows, and normal fee regeneration created a new $25 balance after graduation.

### Test-environment decision

No workspace development database existed at `electron/data/database.sqlite`, and no `.env` or
`DB_PATH` pointed to a clone suitable for testing. Therefore no suitable existing student was
available in this checkout. In accordance with the fallback rule, the test created one student
marked `LIFECYCLE TEST DATA` in a fresh in-memory database. Configuration fixtures (program,
curriculum, courses, terms, rooms, timetable, and test identities) were seeded directly because
they are prerequisites to the workflow; all student lifecycle operations used authenticated HTTP
routes. No production record was read, changed, deleted, or copied.

## 2. Test Student

| Field | Snapshot |
|---|---|
| Internal student ID | 8 (ephemeral in-memory ID) |
| Registration number | `LIFECYCLE-STUDENT-001` |
| Name | Masked: Lifecycle Test Student |
| Program | Lifecycle BSc |
| Department | Lifecycle Computing |
| College | Lifecycle College |
| Curriculum | LIFECYCLE TEST Curriculum 2026 |
| Catalog year | 2026 |
| Required semesters | 2, derived from `curriculum_semester` |
| Required credits | 36 |
| Semester load policy | Minimum 18, maximum 21 credits per configured semester; term cap 21 |
| Starting semester/status | Semester 1 / Active / Regular / In Progress |
| Starting completed credits/CGPA | 0 / N/A |
| Starting financial balance | 0 |
| Starting holds | None |

### Configured graduation requirements

| Requirement | Configuration |
|---|---|
| Required courses | 12 required courses, six per semester |
| Required credits | 36 |
| Electives/general education | No mandatory elective or general-education group configured |
| Internship/thesis/capstone | Not configured; therefore not applicable to this curriculum |
| Minimum passing grade | D |
| Minimum graduation CGPA | 2.00 |
| Attendance warning threshold | 75% |
| Attendance exam threshold | 60% |
| Maximum failed courses for progression | 1 |
| Prerequisites | `LCT102` requires completed `LCT101` |
| Corequisites | `LCT103` requires completed or concurrently enrolled `LCT104` |
| Financial clearance | Aggregate ledger balance must be zero |
| Library/disciplinary/administrative clearance | Generic `holds` rows are evaluated, but no management workflow exists |

## 3. Semester-by-Semester Results

### Semester 1 — Lifecycle Semester 1

| Course | Credits | Attendance | Assessments (Quiz / Assignment / Midterm / Final) | Final grade |
|---|---:|---:|---|---|
| LCT101 | 3 | 80% | 7.5/10, 11.25/15, 18.75/25, 37.5/50 | C |
| LCT102 | 3 | 80% | 7.5/10, 11.25/15, 18.75/25, 37.5/50 | C |
| LCT103 | 3 | 80% | 7.5/10, 11.25/15, 18.75/25, 37.5/50 | C |
| LCT104 | 3 | 80% | 7.5/10, 11.25/15, 18.75/25, 37.5/50 | C |
| LCT105 | 3 | 80% | 7.5/10, 11.25/15, 18.75/25, 37.5/50 | C |
| LCT106 | 3 | 80% | 7.5/10, 11.25/15, 18.75/25, 37.5/50 | C |

- Attempted/earned credits: 18 / 18
- Independently calculated GPA: `(18 credits × 2.0) / 18 = 2.00`
- System term GPA/CGPA: 2.00 / 2.00
- Academic standing: Regular
- Progression: Passed; advanced to Semester 2
- Negative checks: prerequisite, corequisite, duplicate, 21-credit cap, timetable conflict, and
  premature progression were all rejected with useful messages.
- Issue: exam details remained accessible at 0% attendance; only a warning notification was made.

### Semester 2 — Lifecycle Semester 2

| Course | Credits | Attendance | Final valid assessments (Quiz / Assignment / Midterm / Final) | Final grade |
|---|---:|---:|---|---|
| LCT201 | 3 | 80% | 9/10, 13.5/15, 22.5/25, 45/50 | A |
| LCT202 | 3 | 80% | 9/10, 13.5/15, 22.5/25, 45/50 | A |
| LCT203 | 3 | 80% | 9/10, 13.5/15, 22.5/25, 45/50 | A |
| LCT204 | 3 | 80% | 9/10, 13.5/15, 22.5/25, 45/50 | A |
| LCT205 | 3 | 80% | 9/10, 13.5/15, 22.5/25, 45/50 | A |
| LCT206 | 3 | 80% | 9/10, 13.5/15, 22.5/25, 45/50 | A |

- A controlled `F` was first assigned to LCT201. The original calculator incorrectly reported 21
  completed credits instead of 18; this was fixed and reverified before continuing.
- All Semester 2 courses were next assigned D grades, producing a 1.00 term GPA and 1.50 CGPA.
  Formal graduation finalization correctly rejected `LOW_GPA`.
- Scores were corrected through the gradebook route to the final A grades above.
- Attempted/earned credits: 18 / 18
- Independently calculated term GPA: `(18 credits × 4.0) / 18 = 4.00`
- Independently calculated CGPA: `(36 + 72 quality points) / 36 credits = 3.00`
- System term GPA/CGPA: 4.00 / 3.00
- Academic standing: Regular
- Progression: Passed; profile became Graduation Eligible
- Formal outcome: Graduated after finance clearance and four approvals

## 4. Graduation Requirement Checklist

| Requirement | Expected | Actual evidence | Result |
|---|---|---|---|
| Required courses | 12 passed | 12 curriculum-required courses have C/A grades | Pass |
| Required credits | 36 earned | Academic summary and frozen record both report 36 | Pass |
| Mandatory/elective rules | All configured rules met | No mandatory elective group configured | Pass |
| Prerequisite chain | LCT101 before LCT102 | Early LCT102 registration rejected; later accepted after LCT101 completion | Pass |
| Corequisite chain | LCT104 completed/in progress with LCT103 | Early LCT103 rejected; accepted after LCT104 enrollment | Pass |
| Minimum grade | D | All final grades are C or A | Pass |
| Minimum CGPA | 2.00 | Final CGPA 3.00; 1.50 controlled attempt rejected | Pass |
| Attendance | At least 60% | Every course ended at 80% | Pass |
| No unresolved failures | None | Controlled F corrected through gradebook before progression | Pass |
| Financial clearance | Balance 0 | $1,800 charge blocked graduation; $1,800 payment cleared it | Pass |
| Other holds | None active | Graduation audit returned no active generic holds | Pass with workflow gap |
| Ordered approvals | Dept Head → Registrar → Bursar → Records Officer | Four decisions retained; viewer rejected at step 1 | Pass |
| Permanent graduate record | One immutable institutional record | One registry row and issuance events created | Pass for record creation |
| Final transcript immutability | Later grades rejected | Faculty changed a finalized/issued transcript, then test restored it | **Fail** |
| Active enrollment closure | No active operational registrations | 12 rows remained `status='enrolled'` | **Fail** |
| Post-graduation billing restriction | No normal billing | Regeneration added a new $25 balance | **Fail** |
| Alumni conversion | Alumni record/profile created if supported | No alumni table, service, endpoint, or page | **Fail / missing** |

## 5. Problems Found

### P1 — Finalized and issued transcripts remain mutable

- Severity: **Critical**
- Affected modules: Gradebook, transcript, graduation registry
- Reproduction:
  1. Finalize graduation and mark certificate `issued` and transcript `ready`.
  2. As the course faculty user, call `PUT /api/grades/score` for a completed course.
  3. Read `GET /api/transcript/me`.
- Expected: Final grades and the issued transcript are frozen, or a controlled records-officer
  correction/revocation workflow is required.
- Actual: The score and final letter grade changed; transcript GPA/earned credits changed while
  `graduation_records.finalGpa` and `totalCreditsCompleted` remained frozen at 3.00 and 36.
- Root cause: `routes/grades.js` checks course ownership but not student graduation status,
  `resultsPublishedAt`, transcript issuance, or a grade-lock state.
- Relevant code: `routes/grades.js` `PUT /score`, `gradingScale.recomputeFinalGrade`,
  `routes/transcript.js` `loadTranscript`, `graduationService.finalizeGraduation`.
- Database records: `grade_scores`, `enrollments.grade`, `published_grades`,
  `graduation_records`, `graduation_issuance_events`.
- Recommended fix: Add an immutable result-publication/term-close lock. After graduation or
  transcript issuance, reject ordinary grade writes and require a separately authorized,
  reasoned correction request that atomically versions the transcript and graduation record.

### P2 — Graduates remain operationally enrolled and can be billed again

- Severity: **Critical**
- Affected modules: Graduation, enrollment, finance
- Reproduction:
  1. Finalize the student.
  2. Query `enrollments` for `status='enrolled'`: 12 rows remain.
  3. Add a $25 term fee and regenerate charges.
  4. Read the graduate's finance statement.
- Expected: Historical course attempts remain transcript-visible but are closed operationally;
  standard active-student billing excludes graduates.
- Actual: 12 active enrollments remained, and charge regeneration created a $25 balance.
- Root cause: The enrollment status model has no completed/closed academic-attempt state. GPA,
  transcript, and finance all use `status='enrolled'` as both historical inclusion and active
  operational status. `generateCharges` does not filter `student_profiles.studentStatus`.
- Relevant code: `graduationService.finalizeGraduation`, `finance.generateCharges`,
  `finance.computeGrossCharge`, `academicSummary.computeAcademicSummary`,
  `routes/transcript.loadTranscript`.
- Database records: `enrollments`, `student_profiles`, `finance_transactions`,
  `finance_charge_lines`.
- Recommended fix: Separate academic-attempt completion from active registration (for example,
  `completed` plus explicit transcript/GPA inclusion rules), close attempts atomically during
  term completion/finalization, and exclude Graduated students from routine charge generation.

### P3 — Attendance threshold does not enforce exam eligibility

- Severity: **High**
- Affected modules: Attendance, examinations
- Reproduction:
  1. Mark the only attendance session absent (0%).
  2. Request the student's final exam through `GET /api/exams/:id`.
- Expected: 403 response with an attendance-ineligibility code.
- Actual: 200 response with full exam details. An `attendance_exam_block` notification existed,
  but it did not block access.
- Root cause: Attendance calculates thresholds only while posting notifications. Exam access
  checks finance holds but never calculates attendance eligibility.
- Relevant code: `routes/attendance.js` bulk handler; `routes/exams.js` `GET /:id` and
  `scopeExamsForUser`.
- Database records: `attendance`, `exams`, `notifications`.
- Recommended fix: Create one attendance-eligibility service and call it from exam list/detail,
  admit-card, and sitting/attempt workflows. Return a structured reason and allow only audited,
  authorized exceptions.

### P4 — No grade-entry window, result lock, or approval workflow

- Severity: **High**
- Affected modules: Terms, gradebook, academic records
- Reproduction: Inspect `terms`, grade routes, and schema; no grade-open/close fields or lock
  records exist. Faculty can publish and later alter results at any date.
- Expected: Submission allowed only in a configured window, publication/approval state retained,
  and later changes restricted and audited as corrections.
- Actual: Score and publish endpoints enforce ownership only. Changes are audit-logged but not
  governed by a window or approval state.
- Root cause: The grade model has draft scores and `published_grades`, but no term result-state
  machine or authorization workflow for reopening locked grades.
- Relevant code: `routes/grades.js`; `terms`; `published_grades`.
- Recommended fix: Add term grade windows and course result states (`draft`, `submitted`,
  `approved`, `published`, `locked`), with role-ordered approval and explicit reopen reasons.

### P5 — No formal Semester 1 academic initialization workflow

- Severity: **High**
- Affected modules: Admissions, student profile, progression, finance
- Reproduction: Create/admit a student and inspect available routes. A `semester_records` row is
  lazily created when progression history/evaluation is read.
- Expected: One explicit, transactional initialization action assigns curriculum/program,
  creates semester history, sets standing, evaluates billing, writes an audit event, and notifies
  the student.
- Actual: `ensureOpenRecord` can mutate records during a read-oriented history request; program
  and curriculum assignment are separate, and initialization has no single audit boundary.
- Root cause: Initialization behavior is distributed among profile creation, curriculum
  assignment, finance generation, and progression's lazy row creation.
- Relevant code: `academicProgression.ensureOpenRecord`, `routes/progression.js`,
  `routes/studentProfile.js`, `curriculum.assignStudent`.
- Database records: `student_profiles`, `student_programs`, `student_curriculum`,
  `semester_records`, finance ledger.
- Recommended fix: Add an idempotent `initializeAcademicProgram` service and authorized endpoint;
  keep reads side-effect free.

### P6 — Institutional hold management is incomplete

- Severity: **High**
- Affected modules: Graduation clearance, student records
- Reproduction: Search routes/services for library, disciplinary, dormitory, or administrative
  hold placement and release.
- Expected: Authorized offices can place/release typed holds with evidence, history, and audit.
- Actual: `holds` is evaluated by graduation, but there is no complete management service/API.
  Financial holds work independently through the finance ledger.
- Root cause: A generic table was added for evaluation before the operational workflows that own
  those holds.
- Relevant code: `graduationService.graduationAudit`; `holds` table in `db.js`.
- Recommended fix: Implement permission-scoped hold placement/release/history endpoints and UI,
  then integrate library/discipline/administrative owners.

### P7 — No alumni record or directory

- Severity: **Medium**
- Affected modules: Graduation, institutional records
- Reproduction: Finalize graduation and inspect schema/routes/pages.
- Expected: Alumni profile/record or an explicit integration event if the institution supports
  alumni management.
- Actual: Graduate registry exists, but no alumni table, service, endpoint, or page exists.
- Root cause: Graduation phase implemented the permanent graduate registry but not alumni.
- Recommended fix: Define alumni ownership and data boundaries, then create an idempotent alumni
  conversion event during finalization.

### P8 — Failed courses were counted as completed credits (fixed)

- Severity: **High (resolved in this task)**
- Affected modules: GPA, transcript, progression, graduation audit
- Reproduction: Complete Semester 1 (18 credits), assign an F to one 3-credit Semester 2 course,
  and calculate the cumulative summary.
- Expected: attempted credits 36, completed credits 18, failed count 1.
- Actual before fix: completed credits 21.
- Root cause: `computeAcademicSummary` incremented completed credits for every non-null grade.
- Fix: Earned/completed credits now increment only when the grading band has positive points;
  zero-point grades count as failures while still contributing attempted/GPA credits.
- Verification: The lifecycle assertion now reports 18 completed credits at the controlled F,
  and all graduation/notification tests pass.

### P9 — Profile semester status was stale after finalization (fixed)

- Severity: **Medium (resolved in this task)**
- Affected modules: Student profile, graduation
- Reproduction: Finalize an eligible student and compare `student_profiles.semesterStatus` with
  the terminal graduation state.
- Expected: Profile indicates Completed.
- Actual before fix: Profile remained Graduation Eligible after status became Graduated.
- Root cause: `finalizeGraduation` updated graduation fields but omitted the denormalized semester
  status mirror.
- Fix: Finalization now atomically sets `semesterStatus='Completed'`.
- Verification: Final evidence shows `studentStatus=Graduated`, `semesterStatus=Completed`, and
  `graduationStatus=Conferred`.

## 6. Integration Verification

| Integration | Result | Evidence / issue |
|---|---|---|
| Student records | Pass with fix | Profile synchronized to Graduated / Completed / Conferred |
| Curriculum | Pass | Exact configured semesters/courses/credits used by registration and audit |
| Enrollment | Partial | All gates passed; post-graduation active rows remain |
| Scheduling | Pass | Controlled conflict rejected |
| Attendance | Partial | Percentages and warnings correct; exam enforcement missing |
| Examinations | Fail | Financial hold enforced, attendance hold not enforced |
| Gradebook | Partial | Assessments and grade calculation work; no window/lock/final immutability |
| GPA and transcript | Pass with fix, then fail post-graduation | GPA correct; issued transcript remained mutable |
| Finance | Partial | Charge/payment/hold work; graduate can be billed again |
| Semester progression | Pass | Early progression blocked; two semesters recorded and calculated correctly |
| Graduation | Pass | Requirement-level audit, ordered approval, revalidation, frozen record |
| Alumni | Missing | No implementation |
| Notifications | Pass | 111 student lifecycle notifications in final evidence run |
| Reports | Pass | Program and department graduation counts both returned one graduate |
| Audit logs | Pass | 186 entries; attendance, grades, publication, progression, approvals, finance, issuance, and finalization present |

## 7. Missing Features

1. Grade-entry windows and a formal grade submit/approve/publish/lock/reopen lifecycle.
2. Enforced attendance-based exam eligibility and audited exception handling.
3. A historical completed-enrollment state distinct from active registration.
4. Post-graduation exclusion from routine billing.
5. Immutable/versioned final transcripts with formal corrections.
6. Alumni conversion and directory.
7. One explicit Semester 1 academic initialization workflow.
8. Operational library, disciplinary, dormitory, and administrative hold management.
9. A dedicated repeat-course workflow; failed attempts are visible and prerequisite logic works,
   but repeat scheduling/replacement policy is not modeled as an institutional process.

## 8. Changes Made

1. Added `npm run test:lifecycle` to `package.json`.
2. Added `electron/backend/tests/singleStudentLifecycle.test.cjs`, a repeatable in-memory HTTP
   integration test with real authentication, roles, services, calculations, workflows, negative
   tests, evidence output, and explicit TODO coverage for missing institutional controls.
3. Fixed `academicSummary.computeAcademicSummary` so failed courses do not earn completed credit.
4. Fixed `graduationService.finalizeGraduation` so the profile semester status becomes Completed.
5. Added this report.

No migration was required. No production or persistent test database was created. Every test row
was discarded with the in-memory database. The deliberate post-graduation grade mutation was
restored through the real gradebook endpoint before the test ended.

## 9. Controlled Failure Test Results

| Invalid action | Result |
|---|---|
| Course without prerequisite | Rejected 409 with missing-prerequisite message |
| Course without corequisite | Rejected 409; accepted after corequisite enrollment |
| Exceed maximum credit load | Rejected 409 with 21-credit-limit message |
| Conflicting schedule | Rejected 409 with time-slot conflict message |
| Duplicate enrollment | Rejected 409 |
| Grade submission outside window | **Not testable: model/workflow missing** |
| Progress before all results | Rejected progression; status Awaiting Results |
| Exam access below attendance threshold | **Failed: access allowed (200)** |
| Graduation with required courses incomplete | Finalization rejected 422 with requirement-level reasons |
| Graduation below 2.00 CGPA | Finalization rejected 422 with `LOW_GPA` |
| Graduation with financial hold | Finalization rejected 422 with financial `ACTIVE_HOLD` |
| Unauthorized graduation approval | Viewer rejected 403 |
| Enrollment after graduation | Rejected 409 |
| Progression after graduation | Did not advance |
| Grade mutation after final transcript issuance | **Failed: mutation allowed** |
| Normal billing after graduation | **Failed: $25 balance created** |

## 10. Final Conclusion

A correctly configured student can currently progress from Semester 1 through formal graduation
without manually editing student academic fields: the tested student completed two real semesters,
36 credits, finance clearance, four ordered approvals, and finalization through application routes.

That successful conferral does **not** make the system safe for real graduation processing. The
following blockers must be fixed before production use:

1. Freeze or formally version final grades and issued transcripts.
2. Separate completed academic attempts from active enrollments and close them atomically.
3. Exclude graduates from normal billing.
4. Enforce attendance-based exam eligibility.
5. Implement grade-entry windows and approval/locking.
6. Add auditable institutional hold workflows.
7. Add an explicit academic initialization transaction.
8. Decide and implement the alumni institutional-record requirement.

Until the critical transcript and post-graduation enrollment/billing defects are resolved and the
TODO integration tests are converted to passing enforcement tests, the system should **not** be
used as the authoritative engine for real university graduation processing.
