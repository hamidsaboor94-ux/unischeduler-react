import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';

/** Port of showAffectedStudents() — resolves ids to names via the loaded rosters. */
export default function StudentListModal({ prefill }) {
  const { t } = useTranslation(['academics', 'common']);
  const { studentIds } = prefill;
  const { courseRosters } = useAppData();
  const { closeModal } = useModal();

  const studentMap = new Map();
  courseRosters.forEach(roster => roster.forEach(r => studentMap.set(r.studentId, r)));

  return (
    <>
      <div id="modal-body">
        <div className="roster-list">
          {studentIds.map(id => {
            const s = studentMap.get(id);
            return (
              <div className="roster-row" key={id}>
                <span>{s ? <><code className="roster-id">{s.idNumber || '—'}</code> {s.name}</> : t('academics:studentListModal.studentFallback', { id })}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
