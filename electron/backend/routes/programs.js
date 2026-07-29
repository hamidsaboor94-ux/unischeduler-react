const crudRouter = require('./crudRouter');
const { get } = require('../db');

// A degree/major track within a department (e.g. "BSc Computer Science") — the level fee_rules
// and fee_items can target most specifically. See db.js for the table; this is what finally
// wires it up to real reads/writes (previously schema-only).
module.exports = crudRouter({
  table: 'programs',
  fields: ['name', 'departmentId', 'degreeLevel', 'totalCredits', 'numberOfSemesters'],
  guardDelete: async (id) => {
    const inProfile = await get('SELECT studentId FROM student_profiles WHERE programId = ? LIMIT 1', [id]);
    if (inProfile) return 'Cannot remove — this program still has students assigned to it.';
    const inFeeRule = await get(`SELECT id FROM fee_rules WHERE scope = 'program' AND scopeId = ? LIMIT 1`, [id]);
    if (inFeeRule) return 'Cannot remove — this program still has fee rules configured for it.';
    const inFeeItem = await get(`SELECT id FROM fee_items WHERE scope = 'program' AND scopeId = ? LIMIT 1`, [id]);
    if (inFeeItem) return 'Cannot remove — this program still has fixed fees configured for it.';
    return null;
  }
});
