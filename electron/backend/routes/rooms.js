const crudRouter = require('./crudRouter');
const { get } = require('../db');
const { isPositiveInt } = require('../validate');

module.exports = crudRouter({
  table: 'rooms',
  fields: ['name', 'type', 'capacity', 'equipment'],
  validate: (body) => {
    if (body.capacity !== undefined && !isPositiveInt(body.capacity)) return 'Capacity must be a positive number.';
    return null;
  },
  guardDelete: async (id) => {
    const inCourse = await get('SELECT id FROM courses WHERE roomId = ? LIMIT 1', [id]);
    if (inCourse) return 'Cannot remove — this room is assigned to a course.';
    const inSlot = await get('SELECT id FROM timetable_slots WHERE roomId = ? LIMIT 1', [id]);
    if (inSlot) return 'Cannot remove — this room is used in the timetable.';
    const inExam = await get('SELECT id FROM exams WHERE roomId = ? LIMIT 1', [id]);
    if (inExam) return 'Cannot remove — this room is booked for an exam.';
    return null;
  }
});
