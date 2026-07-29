const bcrypt = require('bcryptjs');
const { run, nextIdNumberForRole } = require('./db');
const { generateTempPassword } = require('./tempPassword');

/**
 * Creates one user with a random temporary password (hashed at rest) and, for
 * faculty, a linked teacher record — the single account-creation path in the
 * app. Used by manual admin creation, bulk import, and the PDF timetable
 * importer's auto-created faculty accounts, so every account (however it
 * originated) behaves identically: never emailed, temp password returned once
 * for the caller to hand over, and `mustChangePassword` forces a real password
 * on first login.
 *
 * Pass `teacherId` to link the new account to an EXISTING (bare, login-less)
 * teacher record instead of creating a new one — used when the PDF importer
 * matches a lecturer name to a teacher that was added without ever getting a
 * login.
 *
 * Caller must already have validated name/email/role and checked no account
 * exists with that email.
 */
async function createAccountWithTempPassword({ name, email, role, departmentId, collegeId, teacherId }) {
  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 8);
  const idNumber = await nextIdNumberForRole(role);
  const result = await run(
    'INSERT INTO users (name, email, passwordHash, role, mustChangePassword, idNumber, departmentId, collegeId) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    [name, email, passwordHash, role, idNumber, departmentId ?? null, collegeId ?? null]
  );
  let resolvedTeacherId = teacherId ?? null;
  // Faculty and Student Advisors both get a linked teachers row: faculty so they
  // can be assigned to courses, advisors so they can be set as a student's
  // advisor (student_profiles.advisorTeacherId references teachers.id).
  if (role === 'faculty' || role === 'advisor') {
    if (teacherId) {
      await run('UPDATE teachers SET userId = ? WHERE id = ?', [result.id, teacherId]);
    } else {
      const teacherResult = await run(
        'INSERT INTO teachers (name, departmentId, userId) VALUES (?, ?, ?)',
        [name, departmentId ?? null, result.id]
      );
      resolvedTeacherId = teacherResult.id;
    }
  }
  // Every student user is a canonical student the moment the account exists — Finance,
  // Enrollment, Attendance and Gradebook all key off student_profiles.studentId (= this user's
  // id), so a student created here (User Management / bulk-import) must be exactly as "real" as
  // one created through the Admissions approval flow, which already creates this row itself.
  if (role === 'student') {
    await run(
      'INSERT OR IGNORE INTO student_profiles (studentId, departmentId, enrollmentDate) VALUES (?, ?, DATE(\'now\'))',
      [result.id, departmentId ?? null]
    );
  }
  return { id: result.id, name, email, role, tempPassword, teacherId: resolvedTeacherId, idNumber };
}

module.exports = { createAccountWithTempPassword };
