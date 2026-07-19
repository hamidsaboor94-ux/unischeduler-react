import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { saveCourse } from '../../api.js';

export default function BulkAssignDept({ prefill }) {
  const { t } = useTranslation(['management', 'common']);
  const { courseIds } = prefill;
  const { departments, reload } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [deptId, setDeptId] = useState('');

  async function handleAssign() {
    const departmentId = Number(deptId);
    if (!departmentId) { toast(t('management:bulkAssignDept.toastPickDepartment'), 'warning'); return; }
    try {
      await run(Promise.all(courseIds.map(id => saveCourse({ departmentId }, id))));
      closeModal();
      await reload();
      toast(t('management:bulkAssignDept.toastAssigned', { count: courseIds.length }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <div id="modal-body">
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 14 }}>
          {t('management:bulkAssignDept.description', { count: courseIds.length })}
        </div>
        <div className="form-row">
          <div className="form-label">{t('common:fields.department')}</div>
          <select value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">{t('management:bulkAssignDept.none')}</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} style={{ marginInlineEnd: 0 }} disabled={loading} onClick={handleAssign}>
          {loading ? <span className="spinner"></span> : t('management:bulkAssignDept.assign')}
        </button>
      </div>
    </>
  );
}
