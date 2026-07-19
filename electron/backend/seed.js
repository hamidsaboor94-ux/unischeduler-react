/**
 * Populates demo data: departments, an active term, teachers, rooms,
 * courses (with a prerequisite and a deliberately low-capacity course to
 * demonstrate waitlisting), and a timetable. Safe to re-run — every insert
 * is guarded by a lookup so existing rows are reused instead of duplicated.
 *
 * Also seeds the one and only account created outside the app: a default
 * admin. There is no public self-registration — every other account is
 * created by an admin (single or bulk) from the Users page. Set
 * DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD before running this to choose
 * the admin's real credentials; otherwise a fallback dev login is used and a
 * warning is printed (never rely on the fallback outside local development).
 *
 * Usage: npm run seed
 */
const bcrypt = require('bcryptjs');
const { init, run, get, nextIdNumberForRole } = require('./db');

async function seedDefaultAdmin() {
  const email = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.edu').trim().toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123';
  if (!process.env.DEFAULT_ADMIN_EMAIL || !process.env.DEFAULT_ADMIN_PASSWORD) {
    console.warn(
      '\n⚠️  DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD not set — seeding the default admin with\n' +
      `   ${email} / ${password}. Set both env vars before seeding a real deployment.\n`
    );
  }
  const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return existing;
  const passwordHash = bcrypt.hashSync(password, 8);
  const idNumber = await nextIdNumberForRole('admin');
  const result = await run(
    'INSERT INTO users (name, email, passwordHash, role, mustChangePassword, idNumber) VALUES (?, ?, ?, ?, 0, ?)',
    ['Administrator', email, passwordHash, 'admin', idNumber]
  );
  return get('SELECT id, email FROM users WHERE id = ?', [result.id]);
}

async function upsertByName(table, name, extra = {}) {
  const existing = await get(`SELECT * FROM ${table} WHERE name = ?`, [name]);
  if (existing) return existing;
  const cols = ['name', ...Object.keys(extra)];
  const values = [name, ...Object.values(extra)];
  const result = await run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, values);
  return get(`SELECT * FROM ${table} WHERE id = ?`, [result.id]);
}

async function upsertCourse(data) {
  const existing = await get('SELECT * FROM courses WHERE code = ?', [data.code]);
  if (existing) return existing;
  const cols = Object.keys(data);
  const result = await run(`INSERT INTO courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(data));
  return get('SELECT * FROM courses WHERE id = ?', [result.id]);
}

async function ensureSlot(courseId, day, time, roomId, termId) {
  const existing = await get('SELECT id FROM timetable_slots WHERE courseId = ? AND day = ? AND time = ?', [courseId, day, time]);
  if (existing) return existing;
  return run('INSERT INTO timetable_slots (courseId, day, time, roomId, termId) VALUES (?, ?, ?, ?, ?)', [courseId, day, time, roomId, termId]);
}

async function ensureExam(courseId, date, time, roomId, invigilatorId, termId) {
  const existing = await get('SELECT id FROM exams WHERE courseId = ?', [courseId]);
  if (existing) return existing;
  return run('INSERT INTO exams (courseId, date, time, roomId, invigilatorId, termId) VALUES (?, ?, ?, ?, ?, ?)', [courseId, date, time, roomId, invigilatorId, termId]);
}

async function main() {
  await init();

  const admin = await seedDefaultAdmin();

  const depts = {};
  for (const name of ['Computer Science', 'Mathematics', 'Biology', 'Physics', 'Economics', 'History']) {
    depts[name] = await upsertByName('departments', name);
  }

  let term = await get('SELECT * FROM terms WHERE name = ?', ['Spring 2026']);
  await run('UPDATE terms SET isActive = 0');
  if (!term) {
    const result = await run('INSERT INTO terms (name, startDate, endDate, isActive) VALUES (?, ?, ?, 1)', ['Spring 2026', '2026-02-02', '2026-06-01']);
    term = await get('SELECT * FROM terms WHERE id = ?', [result.id]);
  } else {
    await run('UPDATE terms SET isActive = 1 WHERE id = ?', [term.id]);
    term.isActive = 1;
  }

  const teachers = {};
  const teacherSeed = [
    ['Dr. Chen', 'Computer Science'], ['Dr. Park', 'Computer Science'], ['Prof. Yates', 'Mathematics'],
    ['Dr. Rios', 'Biology'], ['Dr. Osei', 'Physics'], ['Prof. Kim', 'Economics'], ['Dr. Nwaka', 'History']
  ];
  for (const [name, dept] of teacherSeed) {
    teachers[name] = await upsertByName('teachers', name, { departmentId: depts[dept].id });
  }

  const rooms = {};
  const roomSeed = [
    ['Hall A', 'Lecture hall', 200, 'Projector, PA system'],
    ['Hall B', 'Lecture hall', 150, 'Projector'],
    ['Hall C', 'Exam hall', 100, '—'],
    ['Room A101', 'Classroom', 40, 'Whiteboard, projector'],
    ['Room B205', 'Classroom', 35, 'Whiteboard'],
    ['Room C302', 'Classroom', 60, 'Smart board'],
    ['Lab 1', 'Computer lab', 50, '30 workstations'],
    ['Lab 2', 'Science lab', 30, 'Fume hood, benches']
  ];
  for (const [name, type, capacity, equipment] of roomSeed) {
    rooms[name] = await upsertByName('rooms', name, { type, capacity, equipment });
  }

  const courses = {};
  const courseSeed = [
    ['CS101', 'Introduction to Computing', 'Computer Science', 4, 'Dr. Chen', 'Room A101', 130],
    ['CS301', 'Data Structures', 'Computer Science', 4, 'Dr. Park', 'Room A101', 35],
    ['MATH201', 'Calculus II', 'Mathematics', 3, 'Prof. Yates', 'Room B205', 30],
    ['MATH315', 'Linear Algebra', 'Mathematics', 3, 'Prof. Yates', 'Room B205', 6], // low cap — demonstrates waitlisting
    ['BIO110', 'Cell Biology', 'Biology', 4, 'Dr. Rios', 'Lab 1', 45],
    ['PHY202', 'Electromagnetism', 'Physics', 4, 'Dr. Osei', 'Room C302', 60],
    ['ECON301', 'Macroeconomics', 'Economics', 3, 'Prof. Kim', 'Hall C', 100],
    ['HIST220', 'World History', 'History', 3, 'Dr. Nwaka', 'Room B205', 25]
  ];
  for (const [code, name, dept, credits, teacher, room, maxStudents] of courseSeed) {
    courses[code] = await upsertCourse({
      code, name, departmentId: depts[dept].id, credits,
      teacherId: teachers[teacher].id, roomId: rooms[room].id, maxStudents, termId: term.id
    });
  }

  // CS301 (Data Structures) requires CS101 (Intro to Computing) first
  await run(
    'INSERT INTO course_prerequisites (courseId, prerequisiteCourseId) VALUES (?, ?) ON CONFLICT (courseId, prerequisiteCourseId) DO NOTHING',
    [courses.CS301.id, courses.CS101.id]
  );

  const slotSeed = [
    ['CS101', 'Mon', '08:00', 'Room A101'], ['BIO110', 'Mon', '10:00', 'Lab 1'], ['MATH201', 'Mon', '12:00', 'Room B205'],
    ['CS301', 'Tue', '10:00', 'Room A101'], ['MATH315', 'Tue', '14:00', 'Room B205'], ['ECON301', 'Tue', '16:00', 'Hall C'],
    ['BIO110', 'Wed', '08:00', 'Lab 1'], ['CS101', 'Wed', '12:00', 'Room A101'], ['HIST220', 'Wed', '14:00', 'Room B205'],
    ['PHY202', 'Thu', '08:00', 'Room C302'], ['ECON301', 'Thu', '10:00', 'Hall C'],
    ['HIST220', 'Fri', '08:00', 'Room B205'], ['PHY202', 'Fri', '12:00', 'Room C302']
  ];
  for (const [code, day, time, room] of slotSeed) {
    await ensureSlot(courses[code].id, day, time, rooms[room].id, term.id);
  }

  const examSeed = [
    ['CS101', '2026-06-03', '13:00', 'Hall A', 'Dr. Chen'],
    ['MATH201', '2026-06-03', '13:00', 'Room B205', null], // no invigilator — demonstrates the notice
    ['BIO110', '2026-06-04', '10:00', 'Lab 1', 'Dr. Rios'],
    ['ECON301', '2026-06-05', '14:00', 'Hall C', null],
    ['PHY202', '2026-06-06', '09:00', 'Room C302', 'Dr. Osei'],
    ['CS301', null, null, null, null], // unscheduled — demonstrates auto-schedule
    ['HIST220', '2026-06-07', '11:00', 'Room B205', null]
  ];
  for (const [code, date, time, room, invigilator] of examSeed) {
    await ensureExam(
      courses[code].id, date, time, room ? rooms[room].id : null,
      invigilator ? teachers[invigilator].id : null, term.id
    );
  }

  console.log('Seed complete.');
  console.log(`Departments: ${Object.keys(depts).length}, Teachers: ${Object.keys(teachers).length}, Rooms: ${Object.keys(rooms).length}, Courses: ${Object.keys(courses).length}`);
  console.log(`Active term: "${term.name}" (id ${term.id})`);
  console.log(`Default admin: ${admin.email} — log in with this, then create faculty/student accounts from the Users page.`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
