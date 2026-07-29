import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { fetchCoursePrerequisites } from '../../api.js';
import { teacherName, roomName, fmt12Hour } from '../../utils.js';

/** Compact schedule/instructor/credits/prerequisites summary — the same facts
    CourseDetailModal/CourseQuickLookModal already show students before they register,
    surfaced here for Registrar/Admin before they manage or enroll into a course's roster.
    `slots` comes from AppDataContext (already loaded for admin/registrar, term-scoped same
    as `courses`), so this needs its own fetch only for prerequisites. */
export default function CourseScheduleSummary({ course }) {
  const { t } = useTranslation(['academics', 'common']);
  const { teachers, rooms, slots } = useAppData();
  const [prereqs, setPrereqs] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPrereqs(null);
    fetchCoursePrerequisites(course.id)
      .then(rows => { if (!cancelled) setPrereqs(rows); })
      .catch(() => { if (!cancelled) setPrereqs([]); });
    return () => { cancelled = true; };
  }, [course.id]);

  const courseSlots = slots.filter(s => s.courseId === course.id);

  return (
    <div className="quicklook-rows" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      {course.teacherId != null && (
        <div className="quicklook-row"><i className="ti ti-user" aria-hidden="true"></i><span>{teacherName(teachers, course.teacherId)}</span></div>
      )}
      <div className="quicklook-row">
        <i className="ti ti-clock" aria-hidden="true"></i>
        <span>
          {courseSlots.length
            ? courseSlots.map(s => `${t('common:days.' + s.day)} ${fmt12Hour(s.time)} · ${roomName(rooms, s.roomId)}`).join(' · ')
            : t('academics:courseDetailModal.noScheduleYet')}
        </span>
      </div>
      {course.credits != null && (
        <div className="quicklook-row"><i className="ti ti-award" aria-hidden="true"></i><span>{t('academics:courseQuickLook.credits', { count: course.credits })}</span></div>
      )}
      <div className="quicklook-row">
        <i className="ti ti-list-check" aria-hidden="true"></i>
        <span>
          {t('academics:courseQuickLook.prerequisites')}:{' '}
          {prereqs === null
            ? t('common:actions.loading')
            : prereqs.length ? prereqs.map(p => p.code).join(', ') : t('academics:courseQuickLook.noPrerequisites')}
        </span>
      </div>
    </div>
  );
}
