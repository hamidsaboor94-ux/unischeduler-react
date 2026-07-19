import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { deleteDepartment } from '../api.js';

export default function DepartmentsPage() {
  const { t } = useTranslation(['management', 'common']);
  const { departments, courses, teachers, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();

  return (
    <Section name="departments">
      <div className="topbar">
        <i className="ti ti-building-community" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:departmentsPage.title')}</h2>
        <div className="topbar-actions">
          <button className="btn-primary" onClick={() => openModal('department')}><i className="ti ti-plus"></i> {t('management:departmentsPage.addDepartment')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr><th>{t('common:fields.name')}</th><th>{t('management:departmentsPage.columns.courses')}</th><th>{t('management:departmentsPage.columns.teachers')}</th><th></th></tr></thead>
            <tbody>
              {departments.map(d => {
                const courseCount = courses.filter(c => c.departmentId === d.id).length;
                const teacherCount = teachers.filter(t2 => t2.departmentId === d.id).length;
                return (
                  <tr key={d.id} onClick={() => openModal('department', d.id)}>
                    <td>{d.name}</td><td>{courseCount}</td><td>{teacherCount}</td>
                    <td><div className="row-actions">
                      <button className="icon-btn danger" aria-label={t('management:departmentsPage.deleteAria', { name: d.name })} onClick={e => { e.stopPropagation(); confirmAction(t('management:departmentsPage.confirmDelete', { name: d.name }), () => afterMutate(deleteDepartment(d.id), t('management:departmentsPage.toastRemoved'))); }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
