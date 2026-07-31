/**
 * Whitelisted entity/field model for the custom report builder (see reportBuilder.js). This is
 * the ONLY place SQL column expressions and joins are named — a report request can only ever
 * select/filter/group by a `key` listed here, never raw SQL from the client. Column `expr`
 * strings are authored by us (not user input), so they're safe to interpolate directly; filter
 * VALUES always go through parameterized `?` placeholders in reportBuilder.js.
 */

const TYPE = { STRING: 'string', NUMBER: 'number', DATE: 'date', ENUM: 'enum' };

// Operators allowed per field type — also enforced server-side in reportBuilder.js, this list is
// just what's advertised to the UI.
const OPERATORS_BY_TYPE = {
  [TYPE.STRING]: ['equals', 'contains'],
  [TYPE.NUMBER]: ['equals', 'gt', 'gte', 'lt', 'lte', 'between'],
  [TYPE.DATE]: ['equals', 'before', 'after', 'between'],
  [TYPE.ENUM]: ['equals', 'in'],
};

const ENTITIES = {
  students: {
    label: 'Students',
    from: `student_profiles sp
           JOIN users u ON u.id = sp.studentId
           LEFT JOIN departments d ON d.id = sp.departmentId
           LEFT JOIN programs pr ON pr.id = sp.programId
           LEFT JOIN student_types st ON st.id = sp.studentTypeId
           LEFT JOIN teachers adv ON adv.id = sp.advisorTeacherId`,
    fields: {
      name: { expr: 'u.name', label: 'Name', type: TYPE.STRING },
      email: { expr: 'u.email', label: 'Email', type: TYPE.STRING },
      department: { expr: 'd.name', label: 'Department', type: TYPE.STRING, groupable: true },
      program: { expr: 'pr.name', label: 'Program', type: TYPE.STRING, groupable: true },
      studentType: { expr: 'st.name', label: 'Student type', type: TYPE.STRING, groupable: true },
      section: { expr: 'sp.section', label: 'Section', type: TYPE.STRING, groupable: true },
      batch: { expr: 'sp.batch', label: 'Batch', type: TYPE.STRING, groupable: true },
      programSemester: { expr: 'sp.programSemester', label: 'Semester', type: TYPE.NUMBER, groupable: true },
      admissionStatus: { expr: 'sp.admissionStatus', label: 'Admission status', type: TYPE.ENUM, groupable: true, values: ['Approved', 'Pending', 'Rejected'] },
      enrollmentStatus: { expr: 'sp.enrollmentStatus', label: 'Enrollment status', type: TYPE.ENUM, groupable: true, values: ['Regular', 'Part-time', 'Probation', 'Withdrawn'] },
      studentStatus: { expr: 'sp.studentStatus', label: 'Student status', type: TYPE.ENUM, groupable: true, values: ['Active', 'Graduated', 'Suspended', 'Withdrawn', 'On Leave'] },
      gender: { expr: 'sp.gender', label: 'Gender', type: TYPE.STRING, groupable: true },
      nationality: { expr: 'sp.nationality', label: 'Nationality', type: TYPE.STRING, groupable: true },
      advisor: { expr: 'adv.name', label: 'Advisor', type: TYPE.STRING, groupable: true },
      entryTestMarks: { expr: 'sp.entryTestMarks', label: 'Entry test marks', type: TYPE.NUMBER },
      createdAt: { expr: 'u.createdAt', label: 'Account created', type: TYPE.DATE },
    },
  },
  courses: {
    label: 'Courses',
    from: `courses c
           LEFT JOIN departments d ON d.id = c.departmentId
           LEFT JOIN teachers t ON t.id = c.teacherId
           LEFT JOIN rooms r ON r.id = c.roomId
           LEFT JOIN terms tm ON tm.id = c.termId`,
    fields: {
      code: { expr: 'c.code', label: 'Code', type: TYPE.STRING },
      name: { expr: 'c.name', label: 'Name', type: TYPE.STRING },
      department: { expr: 'd.name', label: 'Department', type: TYPE.STRING, groupable: true },
      teacher: { expr: 't.name', label: 'Teacher', type: TYPE.STRING, groupable: true },
      room: { expr: 'r.name', label: 'Room', type: TYPE.STRING, groupable: true },
      term: { expr: 'tm.name', label: 'Term', type: TYPE.STRING, groupable: true },
      credits: { expr: 'c.credits', label: 'Credits', type: TYPE.NUMBER },
      maxStudents: { expr: 'c.maxStudents', label: 'Capacity', type: TYPE.NUMBER },
    },
  },
  enrollments: {
    label: 'Enrollments',
    from: `enrollments e
           JOIN users u ON u.id = e.studentId
           JOIN courses c ON c.id = e.courseId
           LEFT JOIN departments d ON d.id = c.departmentId
           LEFT JOIN terms tm ON tm.id = c.termId`,
    fields: {
      studentName: { expr: 'u.name', label: 'Student', type: TYPE.STRING },
      courseCode: { expr: 'c.code', label: 'Course code', type: TYPE.STRING },
      courseName: { expr: 'c.name', label: 'Course name', type: TYPE.STRING },
      department: { expr: 'd.name', label: 'Department', type: TYPE.STRING, groupable: true },
      term: { expr: 'tm.name', label: 'Term', type: TYPE.STRING, groupable: true },
      status: { expr: 'e.status', label: 'Status', type: TYPE.ENUM, groupable: true, values: ['enrolled', 'waitlisted', 'dropped'] },
      grade: { expr: 'e.grade', label: 'Grade', type: TYPE.STRING, groupable: true },
      createdAt: { expr: 'e.createdAt', label: 'Enrolled on', type: TYPE.DATE },
    },
  },
  attendance: {
    label: 'Attendance',
    from: `attendance a
           JOIN users u ON u.id = a.studentId
           JOIN courses c ON c.id = a.courseId
           LEFT JOIN departments d ON d.id = c.departmentId`,
    fields: {
      studentName: { expr: 'u.name', label: 'Student', type: TYPE.STRING },
      courseCode: { expr: 'c.code', label: 'Course code', type: TYPE.STRING },
      department: { expr: 'd.name', label: 'Department', type: TYPE.STRING, groupable: true },
      date: { expr: 'a.date', label: 'Date', type: TYPE.DATE, groupable: true },
      status: { expr: 'a.status', label: 'Status', type: TYPE.ENUM, groupable: true, values: ['present', 'absent', 'late', 'excused'] },
    },
  },
  finance: {
    label: 'Finance transactions',
    from: `finance_transactions f
           JOIN users u ON u.id = f.studentId
           LEFT JOIN terms tm ON tm.id = f.termId`,
    fields: {
      studentName: { expr: 'u.name', label: 'Student', type: TYPE.STRING },
      term: { expr: 'tm.name', label: 'Term', type: TYPE.STRING, groupable: true },
      type: { expr: 'f.type', label: 'Type', type: TYPE.STRING, groupable: true },
      method: { expr: 'f.method', label: 'Method', type: TYPE.STRING, groupable: true },
      amount: { expr: 'f.amount', label: 'Amount', type: TYPE.NUMBER },
      reference: { expr: 'f.reference', label: 'Reference', type: TYPE.STRING },
      createdAt: { expr: 'f.createdAt', label: 'Date', type: TYPE.DATE, groupable: true },
    },
  },
  applications: {
    label: 'Admissions applications',
    from: `applications ap
           LEFT JOIN departments d ON d.id = ap.desiredDepartmentId`,
    fields: {
      fullName: { expr: 'ap.fullName', label: 'Applicant name', type: TYPE.STRING },
      department: { expr: 'd.name', label: 'Desired department', type: TYPE.STRING, groupable: true },
      status: { expr: 'ap.status', label: 'Status', type: TYPE.ENUM, groupable: true, values: ['Submitted', 'Under Review', 'Entry Test Scheduled', 'Waitlisted', 'Accepted', 'Rejected'] },
      source: { expr: 'ap.source', label: 'Source', type: TYPE.ENUM, groupable: true, values: ['public', 'admin'] },
      entryTestMarks: { expr: 'ap.entryTestMarks', label: 'Entry test marks', type: TYPE.NUMBER },
      createdAt: { expr: 'ap.createdAt', label: 'Submitted on', type: TYPE.DATE },
      decidedAt: { expr: 'ap.decidedAt', label: 'Decided on', type: TYPE.DATE },
    },
  },
};

function listEntities() {
  return Object.entries(ENTITIES).map(([key, entity]) => ({
    key,
    label: entity.label,
    fields: Object.entries(entity.fields).map(([fieldKey, field]) => ({
      key: fieldKey,
      label: field.label,
      type: field.type,
      groupable: !!field.groupable,
      operators: OPERATORS_BY_TYPE[field.type],
      values: field.values || null,
    })),
  }));
}

module.exports = { ENTITIES, TYPE, OPERATORS_BY_TYPE, listEntities };
