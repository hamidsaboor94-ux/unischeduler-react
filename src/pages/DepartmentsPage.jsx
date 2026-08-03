import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { deleteDepartment, saveCollege, deleteCollege, deleteProgram } from '../api.js';
import CurriculumManager from '../components/CurriculumManager.jsx';

// Single-institution deployment — no college/faculty layer in use yet. Set to true to bring
// back the Colleges panel and the College column; the colleges table, collegeId column, and
// all data-fetching stay intact underneath either way.
const SHOW_COLLEGES = false;

export default function DepartmentsPage() {
  const { t } = useTranslation(['management', 'common']);
  const { departments, colleges, programs, courses, teachers, currentUser, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();
  const { toast } = useToast();
  const [newCollege, setNewCollege] = useState('');

  const collegeName = (id) => colleges.find(c => c.id === id)?.name;

  async function addCollege() {
    const name = newCollege.trim();
    if (!name) return;
    try {
      await afterMutate(saveCollege({ name }), t('management:collegesPanel.toastAdded'));
      setNewCollege('');
    } catch (err) { toast(err.message, 'error'); }
  }

  return (
    <Section name="departments">
      <div className="topbar">
        <i className="ti ti-building-community" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:departmentsPage.title')}</h2>
        <div className="topbar-actions">
          <button className="btn-primary" onClick={() => openModal('program')}><i className="ti ti-plus"></i> {t('management:programsPanel.addProgram')}</button>
          <button className="btn-primary" onClick={() => openModal('department')}><i className="ti ti-plus"></i> {t('management:departmentsPage.addDepartment')}</button>
        </div>
      </div>
      <div id="content">
        {/* Colleges: the optional layer above departments that a Dean is scoped to. Hidden on
            this single-institution deployment via SHOW_COLLEGES above — not removed, so it's a
            one-line flip to bring back if the app grows to multiple colleges/faculties. */}
        {SHOW_COLLEGES && (
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
              <i className="ti ti-building-arch" aria-hidden="true"></i>
              <strong>{t('management:collegesPanel.title')}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('management:collegesPanel.hint')}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 14px 14px' }}>
              {colleges.map(c => {
                const deptCount = departments.filter(d => d.collegeId === c.id).length;
                return (
                  <span key={c.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 999 }}>
                    {c.name} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>· {deptCount}</span>
                    <button
                      className="icon-btn danger" aria-label={t('management:collegesPanel.deleteAria', { name: c.name })}
                      onClick={() => confirmAction(t('management:collegesPanel.confirmDelete', { name: c.name }), () => afterMutate(deleteCollege(c.id), t('management:collegesPanel.toastRemoved')))}
                    ><i className="ti ti-x" aria-hidden="true"></i></button>
                  </span>
                );
              })}
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <input
                  type="text" className="select-sm" placeholder={t('management:collegesPanel.addPlaceholder')}
                  value={newCollege} onChange={e => setNewCollege(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCollege(); }}
                />
                <button className="btn-sm" onClick={addCollege}><i className="ti ti-plus"></i> {t('management:collegesPanel.add')}</button>
              </span>
            </div>
          </div>
        )}

        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th>{t('common:fields.name')}</th>
              {SHOW_COLLEGES && <th>{t('common:fields.college')}</th>}
              <th>{t('management:departmentsPage.columns.courses')}</th>
              <th>{t('management:departmentsPage.columns.teachers')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {departments.map(d => {
                const courseCount = courses.filter(c => c.departmentId === d.id).length;
                const teacherCount = teachers.filter(t2 => t2.departmentId === d.id).length;
                return (
                  <tr key={d.id} onClick={() => openModal('department', d.id)}>
                    <td>{d.name}</td>
                    {SHOW_COLLEGES && <td>{collegeName(d.collegeId) || <span style={{ color: 'var(--text-muted)' }}>{t('common:notApplicable')}</span>}</td>}
                    <td>{courseCount}</td><td>{teacherCount}</td>
                    <td><div className="row-actions">
                      <button className="icon-btn danger" aria-label={t('management:departmentsPage.deleteAria', { name: d.name })} onClick={e => { e.stopPropagation(); confirmAction(t('management:departmentsPage.confirmDelete', { name: d.name }), () => afterMutate(deleteDepartment(d.id), t('management:departmentsPage.toastRemoved'))); }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Programs/degrees — the level fee_rules and fee_items can target most specifically
            (see FinancePage.jsx's Term Fee Configuration panel). */}
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header" style={{ padding: '10px 14px' }}><strong>{t('management:programsPanel.title')}</strong></div>
          {programs.length === 0 ? (
            <div className="empty-state">{t('management:programsPanel.none')}</div>
          ) : (
            <table className="data-table">
              <thead><tr>
                <th>{t('common:fields.name')}</th>
                <th>{t('common:fields.department')}</th>
                <th>{t('management:programsPanel.degreeLevel')}</th>
                <th>{t('management:programsPanel.totalCredits')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                {programs.map(p => {
                  const deptName = departments.find(d => d.id === p.departmentId)?.name;
                  return (
                    <tr key={p.id} onClick={() => openModal('program', p.id)}>
                      <td>{p.name}</td>
                      <td>{deptName || <span style={{ color: 'var(--text-muted)' }}>{t('common:notApplicable')}</span>}</td>
                      <td>{p.degreeLevel ? t(`management:programForm.degreeLevels.${p.degreeLevel}`) : '—'}</td>
                      <td>{p.totalCredits ?? '—'}</td>
                      <td><div className="row-actions">
                        <button className="icon-btn danger" aria-label={t('management:programsPanel.deleteAria', { name: p.name })} onClick={e => { e.stopPropagation(); confirmAction(t('management:programForm.confirmDelete', { name: p.name }), () => afterMutate(deleteProgram(p.id), t('management:programForm.toastRemoved'))); }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <CurriculumManager programs={programs} courses={courses} currentUser={currentUser} />
      </div>
    </Section>
  );
}
