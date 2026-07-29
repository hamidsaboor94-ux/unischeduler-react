const crudRouter = require('./crudRouter');
const { get } = require('../db');

// Colleges (a.k.a. faculties) are an optional layer above departments — a Dean
// is scoped to every department in their college. Managed by admins; readable
// by anyone (like departments) so the org structure can be displayed.
module.exports = crudRouter({
  table: 'colleges',
  fields: ['name'],
  guardDelete: async (id) => {
    const inUse = await get('SELECT id FROM departments WHERE collegeId = ? LIMIT 1', [id]);
    if (inUse) return 'Cannot remove — this college still has departments assigned to it.';
    const inUser = await get('SELECT id FROM users WHERE collegeId = ? LIMIT 1', [id]);
    if (inUser) return 'Cannot remove — a Dean is still assigned to this college.';
    return null;
  }
});
