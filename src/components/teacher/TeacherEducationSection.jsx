import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import {
  addTeacherEducation, deleteTeacherEducation, downloadTeacherEducationCertificate, downloadTeacherEducationTranscript,
  verifyTeacherEntity, rejectTeacherEntity,
} from '../../api.js';
import { VerificationBadge, VerifyActions, DEGREES } from './teacherProfileShared.jsx';

/** Degree/qualification history — add-form + table, shared by TeacherProfilePage (Full Profile)
    and FacultyOnboardingPage (wizard Step 3: Education). */
export default function TeacherEducationSection({ teacherId, education, canWrite, onChanged }) {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { confirmAction } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const { run: runVerify } = useAsyncAction();

  const [degree, setDegree] = useState(DEGREES[0]);
  const [field, setField] = useState('');
  const [institution, setInstitution] = useState('');
  const [country, setCountry] = useState('');
  const [startYear, setStartYear] = useState('');
  const [year, setYear] = useState('');
  const [gpa, setGpa] = useState('');
  const fileRef = useRef(null);
  const transcriptRef = useRef(null);

  async function handleAdd() {
    if (!degree) { toast(t('teacherProfile:education.errors.degreeRequired'), 'warning'); return; }
    try {
      await run(addTeacherEducation({
        teacherId, degree, fieldOfStudy: field.trim() || undefined,
        institution: institution.trim() || undefined, country: country.trim() || undefined,
        startYear: startYear || undefined, year: year || undefined, gpa: gpa.trim() || undefined,
        file: fileRef.current?.files?.[0], transcript: transcriptRef.current?.files?.[0],
      }));
      await onChanged();
      setField(''); setInstitution(''); setCountry(''); setStartYear(''); setYear(''); setGpa('');
      if (fileRef.current) fileRef.current.value = '';
      if (transcriptRef.current) transcriptRef.current.value = '';
      toast(t('teacherProfile:education.toasts.added'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleDelete(edu) {
    confirmAction(t('teacherProfile:education.confirmDelete', { degree: edu.degree }), async () => {
      try {
        await deleteTeacherEducation(edu.id);
        await onChanged();
        toast(t('teacherProfile:education.toasts.deleted'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function handleVerify(edu) {
    try {
      await runVerify(verifyTeacherEntity('education', edu.id));
      await onChanged();
      toast(t('teacherProfile:verification.toasts.verified'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleReject(edu) {
    confirmAction(t('teacherProfile:verification.confirmReject'), async () => {
      try {
        await runVerify(rejectTeacherEntity('education', edu.id));
        await onChanged();
        toast(t('teacherProfile:verification.toasts.rejected'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const na = t('common:notApplicable');

  return (
    <div className="panel">
      <div className="panel-header"><div className="panel-title">{t('teacherProfile:sections.education')}</div></div>
      {canWrite && (
        <div className="profile-doc-upload no-print" style={{ flexWrap: 'wrap' }}>
          <select value={degree} onChange={e => setDegree(e.target.value)}>
            {DEGREES.map(d => <option key={d} value={d}>{t(`teacherProfile:degreeOptions.${d}`)}</option>)}
          </select>
          <input type="text" placeholder={t('teacherProfile:education.fieldOfStudyPlaceholder')} value={field} onChange={e => setField(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:education.institutionPlaceholder')} value={institution} onChange={e => setInstitution(e.target.value)} />
          <input type="text" placeholder={t('teacherProfile:education.countryPlaceholder')} value={country} onChange={e => setCountry(e.target.value)} style={{ width: 110 }} />
          <input type="number" placeholder={t('teacherProfile:education.startYearPlaceholder')} value={startYear} onChange={e => setStartYear(e.target.value)} style={{ width: 90 }} />
          <input type="number" placeholder={t('teacherProfile:education.yearPlaceholder')} value={year} onChange={e => setYear(e.target.value)} style={{ width: 90 }} />
          <input type="text" placeholder={t('teacherProfile:education.gpaPlaceholder')} value={gpa} onChange={e => setGpa(e.target.value)} style={{ width: 80 }} />
          <label className="field-hint">{t('teacherProfile:education.certificate')}<input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg" /></label>
          <label className="field-hint">{t('teacherProfile:education.transcript')}<input type="file" ref={transcriptRef} accept=".pdf,.png,.jpg,.jpeg" /></label>
          <button className={'btn-sm' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleAdd}>
            {loading ? <span className="spinner"></span> : <><i className="ti ti-plus"></i> {t('teacherProfile:education.add')}</>}
          </button>
        </div>
      )}
      {education.length === 0 && <div className="field-hint" style={{ padding: '10px 0' }}>{t('teacherProfile:education.empty')}</div>}
      {education.length > 0 && (
        <table className="data-table">
          <thead><tr>
            <th>{t('teacherProfile:education.degreeHeader')}</th>
            <th>{t('teacherProfile:education.fieldHeader')}</th>
            <th>{t('teacherProfile:education.institutionHeader')}</th>
            <th>{t('teacherProfile:education.yearHeader')}</th>
            <th>{t('teacherProfile:verification.statusHeader')}</th>
            <th className="no-print"></th>
          </tr></thead>
          <tbody>
            {education.map(edu => (
              <tr key={edu.id}>
                <td>{t(`teacherProfile:degreeOptions.${edu.degree}`, edu.degree)}</td>
                <td>{edu.fieldOfStudy || na}</td>
                <td>{edu.institution || na}{edu.country ? `, ${edu.country}` : ''}</td>
                <td>{edu.year ?? na}</td>
                <td><VerificationBadge status={edu.verificationStatus} t={t} /></td>
                <td className="no-print"><div className="row-actions">
                  {edu.documentPath && (
                    <button className="btn-sm" onClick={() => downloadTeacherEducationCertificate(edu.id, `${edu.degree}-certificate`)}>
                      <i className="ti ti-download"></i> {t('teacherProfile:education.certificate')}
                    </button>
                  )}
                  {edu.transcriptPath && (
                    <button className="btn-sm" onClick={() => downloadTeacherEducationTranscript(edu.id, `${edu.degree}-transcript`)}>
                      <i className="ti ti-download"></i> {t('teacherProfile:education.transcript')}
                    </button>
                  )}
                  <VerifyActions canVerify={canWrite} status={edu.verificationStatus} t={t}
                    onVerify={() => handleVerify(edu)} onReject={() => handleReject(edu)} />
                  {canWrite && (
                    <button className="icon-btn danger" aria-label={t('teacherProfile:education.deleteAria')} onClick={() => handleDelete(edu)}>
                      <i className="ti ti-trash" aria-hidden="true"></i>
                    </button>
                  )}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
