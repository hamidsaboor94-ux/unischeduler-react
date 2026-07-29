const crudRouter = require('./crudRouter');
const { get } = require('../db');

// Configurable student categories (Regular, International, Scholarship, ...) — seeded with a
// default set (see db.js) but fully admin-editable; fee_rules/fee_items optionally target one.
module.exports = crudRouter({
  table: 'student_types',
  fields: ['name', 'isActive', 'sortOrder'],
  guardDelete: async (id) => {
    const inProfile = await get('SELECT studentId FROM student_profiles WHERE studentTypeId = ? LIMIT 1', [id]);
    if (inProfile) return 'Cannot remove — students are still assigned this type.';
    const inFeeRule = await get('SELECT id FROM fee_rules WHERE studentTypeId = ? LIMIT 1', [id]);
    if (inFeeRule) return 'Cannot remove — this student type still has fee rules configured for it.';
    const inFeeItem = await get('SELECT id FROM fee_items WHERE studentTypeId = ? LIMIT 1', [id]);
    if (inFeeItem) return 'Cannot remove — this student type still has fixed fees configured for it.';
    return null;
  }
});
