import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { uploadTeacherPhoto, fetchTeacherPhotoUrl } from '../../api.js';
import { initials } from '../../utils.js';

/** Avatar + upload control shared by the Full Profile header and the onboarding wizard's
    Documents step. Owns its own fetch of the photo (needs an auth header a plain <img src>
    can't send) and revokes the previous object URL so they don't pile up. */
export default function TeacherPhotoUpload({ teacherId, name, photoPath, canWrite, onUploaded, size = 'lg' }) {
  const { t } = useTranslation(['teacherProfile', 'common']);
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  const [photoUrl, setPhotoUrl] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let url = null;
    if (teacherId != null) {
      fetchTeacherPhotoUrl(teacherId).then(u => { if (!cancelled) { url = u; setPhotoUrl(u); } });
    } else {
      setPhotoUrl(null);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [teacherId, photoPath]);

  async function handleUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    try {
      await run(uploadTeacherPhoto(teacherId, file));
      if (inputRef.current) inputRef.current.value = '';
      await onUploaded?.();
      toast(t('teacherProfile:toasts.photoUploaded'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const avatarClass = size === 'lg' ? 'avatar-lg' : 'avatar-sm';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {photoUrl ? <img src={photoUrl} alt="" className={avatarClass} style={{ objectFit: 'cover' }} /> : <div className={avatarClass}>{initials(name)}</div>}
      {canWrite && (
        <div className="no-print">
          <input type="file" ref={inputRef} accept=".png,.jpg,.jpeg" style={{ display: 'none' }} onChange={handleUpload} />
          <button className={'btn-sm' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={() => inputRef.current?.click()}>
            {loading ? <span className="spinner"></span> : <><i className="ti ti-camera"></i> {t('teacherProfile:changePhoto')}</>}
          </button>
        </div>
      )}
    </div>
  );
}
