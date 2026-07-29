import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { fetchCoursePrerequisites } from '../../api.js';
import { teacherName, roomName, fmt12Hour, addMinutes } from '../../utils.js';

/** Compact quick-reference card opened by clicking a class card on My Schedule, or a row in the
    My Courses table — course basics only (code/name via the modal's own header, description,
    prerequisites, room, lecturer, day/time, credits). Deliberately NOT registered in ModalHost's
    isWide()/isMedium() lists, so it renders at the default compact modal width (380px) rather
    than a full-width workspace. Everything shows at once — no expand/collapse, no separate
    "view full course" step; Announcements/Assignments/Materials stay in the full course-activity
    view, which this card never fetches or shows any of.
    `prefill.slot` is the base recurring timetable_slots row for the clicked card (day/time/room
    as normally scheduled) — a one-off moved/cancelled occurrence still shows its regular weekly
    slot here, not the ad-hoc override, since this is a quick reference card, not the exception
    detail view. `prefill.course` is a fallback for a My Courses row from a past/other term —
    AppDataContext's `courses` is scoped to the active term, so a past-term course wouldn't
    otherwise resolve here. */
export default function CourseQuickLookModal({ editId: courseId, prefill }) {
  const { t } = useTranslation(['academics', 'common']);
  const { courses, teachers, rooms } = useAppData();
  const { closeModal } = useModal();
  const [prereqs, setPrereqs] = useState(null);

  const course = courses.find(c => c.id === courseId) || prefill?.course;
  const slot = prefill?.slot;

  useEffect(() => {
    if (!courseId) return;
    fetchCoursePrerequisites(courseId).then(setPrereqs).catch(() => setPrereqs([]));
  }, [courseId]);

  if (!course) return null;

  const endTime = slot ? addMinutes(slot.time, slot.durationMinutes || 60) : null;

  return (
    <>
      <div id="modal-body">
        {/* No description column exists on courses yet — shows a clear placeholder instead of
            breaking or leaving a gap; see chat report. Capped to 3 lines so a long description
            can't blow out this compact card — it's a summary, not the full text. */}
        <p className="quicklook-description">
          {course.description || t('academics:courseQuickLook.noDescription')}
        </p>

        <div className="quicklook-rows">
          {slot?.roomId != null && (
            <div className="quicklook-row"><i className="ti ti-map-pin" aria-hidden="true"></i><span>{roomName(rooms, slot.roomId)}</span></div>
          )}
          {course.teacherId != null && (
            <div className="quicklook-row"><i className="ti ti-user" aria-hidden="true"></i><span>{teacherName(teachers, course.teacherId)}</span></div>
          )}
          {slot && (
            <div className="quicklook-row"><i className="ti ti-clock" aria-hidden="true"></i><span>{t('common:days.' + slot.day)} · {fmt12Hour(slot.time)}–{fmt12Hour(endTime)}</span></div>
          )}
          {course.credits != null && (
            <div className="quicklook-row"><i className="ti ti-award" aria-hidden="true"></i><span>{t('academics:courseQuickLook.credits', { count: course.credits })}</span></div>
          )}
        </div>

        <div className="panel-title" style={{ marginTop: 14, marginBottom: 6 }}>{t('academics:courseQuickLook.prerequisites')}</div>
        {prereqs === null && <div className="field-hint">{t('common:actions.loading')}</div>}
        {prereqs?.length === 0 && <div className="field-hint">{t('academics:courseQuickLook.noPrerequisites')}</div>}
        {!!prereqs?.length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {prereqs.map(p => <span key={p.id} className="pill pill-gray">{p.code}</span>)}
          </div>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
