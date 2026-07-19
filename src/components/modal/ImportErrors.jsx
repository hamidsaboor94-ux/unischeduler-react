import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';

/** Port of showImportErrors() — a read-only list of skipped/failed rows after a bulk import. */
export default function ImportErrors({ prefill }) {
  const { t } = useTranslation(['timetable', 'common']);
  const { errors, rowLabel } = prefill;
  const { closeModal } = useModal();
  return (
    <>
      <div id="modal-body">
        <div className="roster-list">
          {errors.map((e, i) => (
            <div className="roster-row" key={i}>
              <span>{rowLabel || t('timetable:importErrors.rowLabelDefault')} {e.row}</span>
              <span style={{ color: 'var(--danger)' }}>{e.error}</span>
            </div>
          ))}
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
