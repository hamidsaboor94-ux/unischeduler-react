import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import SlotForm from './SlotForm.jsx';
import ResetTimetableConfirm from './ResetTimetableConfirm.jsx';
import PdfImportPreview from './PdfImportPreview.jsx';
import PdfImportResult from './PdfImportResult.jsx';
import RoomForm from './RoomForm.jsx';
import TeacherForm from './TeacherForm.jsx';
import DepartmentForm from './DepartmentForm.jsx';
import TermForm from './TermForm.jsx';
import RolloverForm from './RolloverForm.jsx';
import CourseForm from './CourseForm.jsx';
import BulkAssignDept from './BulkAssignDept.jsx';
import ImportErrors from './ImportErrors.jsx';
import ExamForm from './ExamForm.jsx';
import RosterModal from './RosterModal.jsx';
import StudentListModal from './StudentListModal.jsx';
import CreateAccountForm from './CreateAccountForm.jsx';
import AccountCredentials from './AccountCredentials.jsx';
import ResetPasswordForm from './ResetPasswordForm.jsx';
import SlotExceptionsModal from './SlotExceptionsModal.jsx';
import ProfileModal from './ProfileModal.jsx';
import ConflictDetailModal from './ConflictDetailModal.jsx';
import CourseActionsModal from './CourseActionsModal.jsx';
import CourseActivityModal from './CourseActivityModal.jsx';
import MoveSlotModal from './MoveSlotModal.jsx';
import AutoGenerateExamTypeForm from './AutoGenerateExamTypeForm.jsx';
import ApplicationStatusChangeModal from './ApplicationStatusChangeModal.jsx';
import ApplicationApproveModal from './ApplicationApproveModal.jsx';

/** Title text per modal type — mirrors the original's inline `title.textContent = ...` in openModal().
    Filled in incrementally as each modal type is built; unhandled types fall back to a blank title
    rather than crashing (a page that hasn't wired up its modal yet just shows nothing). */
function modalTitle(modal, appData, t) {
  switch (modal.type) {
    case 'confirm': return t('modal.areYouSure');
    case 'slot': return modal.editId ? t('modal.editSlot') : t('modal.addSlot');
    case 'slot-exceptions': {
      const slot = appData.slots.find(s => s.id === modal.editId);
      const course = slot && appData.courses.find(c => c.id === slot.courseId);
      return t('modal.oneOffExceptions') + (course ? ` — ${course.code}` : '');
    }
    case 'reset-timetable-confirm': return t('modal.resetTimetable', { label: modal.prefill.label });
    case 'pdf-import-preview': return t('modal.pdfImportPreview');
    case 'pdf-import-result': return t('modal.pdfImportComplete');
    case 'room': return modal.editId ? t('modal.editRoom') : t('modal.addRoom');
    case 'teacher': return modal.editId ? t('modal.editTeacher') : t('modal.addTeacher');
    case 'department': return modal.editId ? t('modal.editDepartment') : t('modal.addDepartment');
    case 'term': return modal.editId ? t('modal.editSemester') : t('modal.addSemester');
    case 'rollover': {
      const target = appData.terms.find(term => term.id === modal.prefill.targetTermId);
      return t('modal.copyCoursesInto', { term: target ? target.name : '' });
    }
    case 'course': return modal.editId ? t('modal.editCourse') : t('modal.addCourse');
    case 'bulk-assign-dept': return t('modal.assignDepartment');
    case 'import-errors': return modal.prefill?.title || t('modal.importCompletedWithErrors');
    case 'exam': return modal.editId ? t('modal.editExam') : t('modal.scheduleExam');
    case 'auto-generate-exam-type': return t('modal.autoGenerateExamType');
    case 'roster': {
      const course = appData.courses.find(c => c.id === modal.editId);
      return t('modal.roster', { code: course ? course.code : '' });
    }
    case 'studentList': return t('modal.affectedStudents', { count: modal.prefill.studentIds.length });
    case 'create-account': return t('modal.createAccount');
    case 'account-credentials': {
      const n = modal.prefill.accounts.length;
      return n === 1 ? t('modal.accountCreated') : t('modal.accountsCreated', { count: n });
    }
    case 'reset-password': {
      const user = appData.allUsers.find(u => u.id === modal.editId);
      return t('modal.resetPassword', { name: user ? user.name || user.email : '' });
    }
    case 'profile': return t('modal.myProfile');
    case 'conflict-detail': return modal.prefill?.issue?.title || t('modal.conflictDetail');
    case 'course-actions': {
      const course = appData.courses.find(c => c.id === modal.editId);
      return course ? `${course.code} — ${course.name}` : '';
    }
    case 'course-activity': {
      const course = appData.courses.find(c => c.id === modal.editId);
      return course ? `${course.code} — ${course.name}` : '';
    }
    case 'move-slot': {
      const slot = appData.slots.find(s => s.id === modal.editId);
      const course = slot && appData.courses.find(c => c.id === slot.courseId);
      return t('modal.moveSlot', { code: course ? course.code : '' });
    }
    case 'application-status-change': return t('modal.applicationStatusChange', { name: modal.prefill?.fullName || '' });
    case 'application-approve': return t('modal.applicationApprove', { name: modal.prefill?.fullName || '' });
    default: return '';
  }
}

function isWide(modal) {
  if (modal.type === 'pdf-import-preview') return true;
  if (modal.type === 'pdf-import-result') return (modal.prefill?.facultyAccountsCreated?.length || 0) > 0;
  if (modal.type === 'conflict-detail') return true;
  if (modal.type === 'course-actions' || modal.type === 'course-activity') return true;
  return false;
}

function ModalBody({ modal }) {
  switch (modal.type) {
    case 'confirm': return <ConfirmDialog message={modal.prefill?.message} confirmLabel={modal.prefill?.confirmLabel} />;
    case 'slot': return <SlotForm editId={modal.editId} prefill={modal.prefill} />;
    case 'slot-exceptions': return <SlotExceptionsModal editId={modal.editId} prefill={modal.prefill} />;
    case 'reset-timetable-confirm': return <ResetTimetableConfirm prefill={modal.prefill} />;
    case 'pdf-import-preview': return <PdfImportPreview prefill={modal.prefill} />;
    case 'pdf-import-result': return <PdfImportResult prefill={modal.prefill} />;
    case 'room': return <RoomForm editId={modal.editId} />;
    case 'teacher': return <TeacherForm editId={modal.editId} />;
    case 'department': return <DepartmentForm editId={modal.editId} />;
    case 'term': return <TermForm editId={modal.editId} />;
    case 'rollover': return <RolloverForm prefill={modal.prefill} />;
    case 'course': return <CourseForm editId={modal.editId} />;
    case 'bulk-assign-dept': return <BulkAssignDept prefill={modal.prefill} />;
    case 'import-errors': return <ImportErrors prefill={modal.prefill} />;
    case 'exam': return <ExamForm editId={modal.editId} />;
    case 'auto-generate-exam-type': return <AutoGenerateExamTypeForm prefill={modal.prefill} />;
    case 'roster': return <RosterModal editId={modal.editId} />;
    case 'studentList': return <StudentListModal prefill={modal.prefill} />;
    case 'create-account': return <CreateAccountForm />;
    case 'account-credentials': return <AccountCredentials prefill={modal.prefill} />;
    case 'reset-password': return <ResetPasswordForm editId={modal.editId} />;
    case 'profile': return <ProfileModal />;
    case 'conflict-detail': return <ConflictDetailModal prefill={modal.prefill} />;
    case 'course-actions': return <CourseActionsModal editId={modal.editId} prefill={modal.prefill} />;
    case 'course-activity': return <CourseActivityModal editId={modal.editId} prefill={modal.prefill} />;
    case 'move-slot': return <MoveSlotModal editId={modal.editId} prefill={modal.prefill} />;
    case 'application-status-change': return <ApplicationStatusChangeModal prefill={modal.prefill} />;
    case 'application-approve': return <ApplicationApproveModal prefill={modal.prefill} />;
    default: return null;
  }
}

export default function ModalHost() {
  const { t } = useTranslation('shell');
  const { modal, closeModal } = useModal();
  const appData = useAppData();
  const boxRef = useRef(null);
  const isOpen = !!modal.type;
  useModalFocusTrap(isOpen, boxRef, closeModal);

  function closeIfOutside(e) {
    if (e.target === e.currentTarget) closeModal();
  }

  return (
    <div id="modal-overlay" className={isOpen ? 'open' : ''} onClick={closeIfOutside}>
      <div className={'modal-box' + (isWide(modal) ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={boxRef}>
        <div className="modal-header">
          <span className="modal-title" id="modal-title">{isOpen ? modalTitle(modal, appData, t) : ''}</span>
          <button className="modal-close" aria-label={t('modal.closeDialog')} onClick={closeModal}><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>
        {isOpen && <ModalBody modal={modal} />}
      </div>
    </div>
  );
}
