const crudRouter = require('./crudRouter');
const { get } = require('../db');

module.exports = crudRouter({
  table: 'departments',
  // collegeId groups a department under a college (optional) — this is what a
  // Dean is scoped by. Editable by admins on the Departments page.
  fields: ['name', 'collegeId'],
  guardDelete: async (id) => {
    const inUse = await get('SELECT id FROM courses WHERE departmentId = ? LIMIT 1', [id]);
    if (inUse) return 'Cannot remove — this department still has courses assigned to it.';
    const inProfile = await get('SELECT studentId FROM student_profiles WHERE departmentId = ? LIMIT 1', [id]);
    if (inProfile) return 'Cannot remove — this department still has students assigned to it.';
    const inApplication = await get('SELECT id FROM applications WHERE desiredDepartmentId = ? LIMIT 1', [id]);
    if (inApplication) return 'Cannot remove — this department still has applications referencing it.';
    return null;
  }
});
