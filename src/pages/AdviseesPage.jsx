import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { fetchAdvisees } from '../api.js';

/** A Student Advisor's advisee roster. The list is scoped entirely on the
    backend (students whose advisorTeacherId is this advisor's), so there is no
    client-side filtering to trust — clicking through opens each advisee's
    read-only profile. */
export default function AdviseesPage() {
  const { t } = useTranslation(['studentProfile', 'shell', 'common']);
  const { currentUser } = useAppData();
  const { activeSection, showSection } = useNavigation();
  const [advisees, setAdvisees] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentUser.role !== 'advisor') return;
    let cancelled = false;
    setLoading(true);
    fetchAdvisees()
      .then(rows => { if (!cancelled) setAdvisees(rows); })
      .catch(() => { if (!cancelled) setAdvisees([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser.role, activeSection]);

  return (
    <Section name="advisees">
      <div className="topbar">
        <i className="ti ti-users" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('shell:sidebar.nav.advisees')}</h2>
      </div>
      <div id="content">
        <div className="panel">
          {advisees.length === 0 ? (
            <div className="empty-state">
              {loading ? t('studentProfile:advisees.loading') : t('studentProfile:advisees.empty')}
            </div>
          ) : (
            <table className="data-table">
              <thead><tr>
                <th>{t('common:fields.name')}</th>
                <th>{t('common:fields.email')}</th>
                <th>{t('studentProfile:advisees.department')}</th>
                <th>{t('studentProfile:advisees.semester')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                {advisees.map(s => (
                  <tr key={s.studentId}>
                    <td>{s.name}</td>
                    <td>{s.email}</td>
                    <td>{s.departmentName || t('common:notApplicable')}</td>
                    <td>{s.programSemester || t('common:notApplicable')}</td>
                    <td>
                      <button className="btn-sm" onClick={() => showSection('student-profile', { studentId: s.studentId })}>
                        {t('studentProfile:advisees.view')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Section>
  );
}
