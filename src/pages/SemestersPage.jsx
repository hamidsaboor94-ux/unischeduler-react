import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { api, deleteTerm } from '../api.js';
import { fmtDate } from '../utils.js';

export default function SemestersPage() {
  const { t } = useTranslation(['management', 'common']);
  const { terms, setActiveTermIdOptimistic, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();

  function setActiveTerm(id) {
    setActiveTermIdOptimistic(id);
    afterMutate(api('PUT', `/terms/${id}`, { isActive: 1 }), t('management:semestersPage.toastActiveUpdated'));
  }

  return (
    <Section name="semesters">
      <div className="topbar">
        <i className="ti ti-calendar-time" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:semestersPage.title')}</h2>
        <div className="topbar-actions">
          <button className="btn-primary" onClick={() => openModal('term')}><i className="ti ti-plus"></i> {t('management:semestersPage.addSemester')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr><th>{t('common:fields.name')}</th><th>{t('management:semestersPage.columns.start')}</th><th>{t('management:semestersPage.columns.end')}</th><th>{t('management:semestersPage.columns.creditLimit')}</th><th>{t('common:fields.status')}</th><th></th></tr></thead>
            <tbody>
              {terms.map(tm => (
                <tr key={tm.id} onClick={() => openModal('term', tm.id)}>
                  <td>{tm.name}</td><td>{tm.startDate ? fmtDate(tm.startDate) : '—'}</td><td>{tm.endDate ? fmtDate(tm.endDate) : '—'}</td>
                  <td>{tm.creditLimit != null ? t('management:semestersPage.creditsValue', { count: tm.creditLimit }) : '—'}</td>
                  <td><span className={'pill ' + (tm.isActive ? 'pill-green' : 'pill-gray')}>{tm.isActive ? t('management:semestersPage.active') : t('management:semestersPage.inactive')}</span></td>
                  <td><div className="row-actions">
                    {!tm.isActive && <button className="btn-sm" onClick={e => { e.stopPropagation(); setActiveTerm(tm.id); }}>{t('management:semestersPage.setActive')}</button>}
                    <button className="btn-sm" onClick={e => { e.stopPropagation(); openModal('rollover', null, { targetTermId: tm.id }); }} title={t('management:semestersPage.copyCoursesTitle')}><i className="ti ti-copy"></i> {t('management:semestersPage.copyCoursesIn')}</button>
                    <button className="icon-btn danger" aria-label={t('management:semestersPage.deleteAria', { name: tm.name })} onClick={e => { e.stopPropagation(); confirmAction(t('management:semestersPage.confirmDelete', { name: tm.name }), () => afterMutate(deleteTerm(tm.id), t('management:semestersPage.toastRemoved'))); }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
