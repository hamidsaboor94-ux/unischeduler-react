import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchMyGrades } from '../api.js';

/** A student's own grades, per enrolled course — final letter grade plus the per-item
    (assignment/quiz/midterm/exam/final) breakdown, if the teacher has entered any. Scoped
    entirely server-side by GET /grades/me (WHERE studentId = req.user.sub), so there is no
    course/student picker here — a student can never even ask to see anyone else's. */
export default function MyGradesPage() {
  const { t } = useTranslation(['gradebook', 'common']);
  const { sectionFocus } = useNavigation();
  const { toast } = useToast();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const panelRefs = useRef(new Map());

  useEffect(() => {
    (async () => {
      try {
        setCourses(await fetchMyGrades());
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A course quick action ("Grades") lands here wanting to jump straight to its panel.
  useEffect(() => {
    if (sectionFocus?.section === 'mygrades' && sectionFocus.courseId != null) {
      panelRefs.current.get(sectionFocus.courseId)?.scrollIntoView({ block: 'start' });
    }
  }, [sectionFocus, courses]);

  return (
    <Section name="mygrades">
      <div className="topbar">
        <i className="ti ti-report-analytics" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('gradebook:myGradesPage.title')}</h2>
      </div>
      <div id="content">
        {loading ? (
          <div className="field-hint" style={{ padding: 14 }}>{t('common:actions.loading')}</div>
        ) : !courses.length ? (
          <div className="field-hint" style={{ padding: 14 }}>{t('gradebook:myGradesPage.noCourses')}</div>
        ) : courses.map(c => {
          const quizItems = c.items.filter(i => i.category === 'quiz');
          function itemLabel(item) {
            if (item.category === 'quiz') return `${t('gradebook:gradebookPage.categories.quiz')} ${quizItems.indexOf(item) + 1}`;
            return t(`gradebook:gradebookPage.categories.${item.category}`);
          }
          return (
            <div className="panel" key={c.course.id} style={{ marginBottom: 14 }} ref={el => { if (el) panelRefs.current.set(c.course.id, el); }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">{c.course.code} — {c.course.name}</div>
                  <div className="panel-subtitle">
                    {t('gradebook:myGradesPage.total')}: {c.hasAnyScore ? `${c.totalEarned} / ${c.totalPossible}` : t('gradebook:myGradesPage.notGradedYet')}
                    {'  ·  '}{t('gradebook:myGradesPage.average')}: {c.average != null ? `${c.average}%` : t('common:notApplicable')}
                    {'  ·  '}{t('gradebook:myGradesPage.letterGrade')}: {c.letterGrade || (c.hasAnyScore ? t('gradebook:myGradesPage.inProgress') : t('common:notApplicable'))}
                  </div>
                </div>
              </div>
              {c.items.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('gradebook:myGradesPage.table.item')}</th>
                      <th>{t('gradebook:myGradesPage.table.score')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.items.map(item => (
                      <tr key={item.id}>
                        <td>{itemLabel(item)}</td>
                        <td>{item.score != null ? `${item.score} / ${item.maxScore}` : t('gradebook:myGradesPage.notGraded')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="field-hint" style={{ padding: '8px 0' }}>{t('gradebook:myGradesPage.noItemsYet')}</div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
