const crudRouter = require('./crudRouter');
const { get } = require('../db');

module.exports = crudRouter({
  table: 'teachers',
  fields: ['name', 'departmentId', 'userId'],
  // Department Heads only see/manage teachers in their own department.
  scopeColumn: 'departmentId',
  guardDelete: async (id) => {
    const teaching = await get('SELECT id FROM courses WHERE teacherId = ? LIMIT 1', [id]);
    if (teaching) return 'Cannot remove — this teacher is still assigned to a course.';
    const invigilating = await get('SELECT id FROM exams WHERE invigilatorId = ? LIMIT 1', [id]);
    if (invigilating) return 'Cannot remove — this teacher is still assigned as an invigilator.';
    const advising = await get('SELECT studentId FROM student_profiles WHERE advisorTeacherId = ? LIMIT 1', [id]);
    if (advising) return 'Cannot remove — this teacher is still assigned as an academic advisor.';
    return null;
  }
});
