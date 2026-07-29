import { useEffect, useState } from 'react';
import { fetchStudentPhotoUrl } from '../api.js';
import { initials } from '../utils.js';

/** Avatar for a student row/card/header — only fetches the photo (an authenticated blob fetch,
    same reasoning as TeacherPhotoUpload) when the row already says one exists (`photoPath`
    truthy), so a list of students with no photos never fires a request per row. Falls back to
    initials otherwise. */
export default function StudentAvatar({ studentId, name, photoPath, size = 'sm' }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    if (photoPath && studentId != null) {
      fetchStudentPhotoUrl(studentId).then(u => { if (!cancelled) { objectUrl = u; setUrl(u); } });
    } else {
      setUrl(null);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [studentId, photoPath]);

  const cls = size === 'lg' ? 'avatar-lg' : 'avatar-sm';
  return url ? <img src={url} alt="" className={cls} style={{ objectFit: 'cover' }} /> : <div className={cls}>{initials(name)}</div>;
}
