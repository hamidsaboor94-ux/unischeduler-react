import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal } from '../../context/ModalContext.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { fetchMyProfile, updateMyProfile, changeMyPassword } from '../../api.js';

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** "My Profile" — opened from the sidebar avatar/name for whoever is currently logged in (any
    role). Always fetches a fresh /auth/me on open rather than trusting currentUser as-is, since
    currentUser after a fresh login doesn't include createdAt (the login response is a smaller
    shape than /auth/me's). */
export default function ProfileModal() {
  const { t } = useTranslation(['dashboard', 'common']);
  const ID_LABEL = { student: t('profile.studentId'), faculty: t('profile.facultyId'), admin: t('profile.adminId') };
  const { closeModal } = useModal();
  const { updateCurrentUser } = useAppData();
  const { toast } = useToast();
  const { run: runLoad, loading: loadingProfile } = useAsyncAction();
  const { run: runSaveProfile, loading: savingProfile } = useAsyncAction();
  const { run: runChangePassword, loading: changingPassword } = useAsyncAction();

  const [profile, setProfile] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    runLoad(fetchMyProfile())
      .then(p => { setProfile(p); setName(p.name || ''); setEmail(p.email || ''); })
      .catch(err => toast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveProfile() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) { toast(t('profile.errors.nameRequired'), 'warning'); return; }
    if (!trimmedEmail) { toast(t('profile.errors.emailRequired'), 'warning'); return; }
    try {
      const updated = await runSaveProfile(updateMyProfile({ name: trimmedName, email: trimmedEmail }));
      setProfile(updated);
      updateCurrentUser(updated);
      setEditingProfile(false);
      toast(t('profile.toasts.profileUpdated'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleChangePassword() {
    if (!currentPassword) { toast(t('profile.errors.currentPasswordRequired'), 'warning'); return; }
    if (newPassword.length < 8) { toast(t('profile.errors.newPasswordTooShort'), 'warning'); return; }
    if (newPassword !== confirmPassword) { toast(t('profile.errors.passwordsDontMatch'), 'warning'); return; }
    if (newPassword === currentPassword) { toast(t('profile.errors.newPasswordSameAsCurrent'), 'warning'); return; }
    try {
      await runChangePassword(changeMyPassword({ currentPassword, newPassword }));
      toast(t('profile.toasts.passwordChanged'));
      setShowPasswordForm(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!profile) {
    return <div id="modal-body"><div className="field-hint" style={{ padding: 14 }}>{loadingProfile ? t('common:actions.loading') : ''}</div></div>;
  }

  return (
    <>
      <div id="modal-body">
        {!editingProfile ? (
          <>
            <div className="form-row">
              <div className="form-label">{t('common:fields.fullName')}</div>
              <div className="form-static">{profile.name}</div>
            </div>
            <div className="form-row">
              <div className="form-label">{t('common:fields.email')}</div>
              <div className="form-static">{profile.email}</div>
            </div>
            {profile.idNumber && (
              <div className="form-row">
                <div className="form-label">{ID_LABEL[profile.role] || t('profile.genericId')}</div>
                <div className="form-static">{profile.idNumber}</div>
              </div>
            )}
            <div className="form-row">
              <div className="form-label">{t('common:fields.role')}</div>
              <div className="form-static">{t(`common:roles.${profile.role}`)}</div>
            </div>
            <div className="form-row">
              <div className="form-label">{t('profile.memberSince')}</div>
              <div className="form-static">{fmtDateTime(profile.createdAt)}</div>
            </div>
            <button className="btn-sm" onClick={() => setEditingProfile(true)}>
              <i className="ti ti-pencil"></i> {t('profile.editNameEmail')}
            </button>
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="form-label">{t('common:fields.fullName')}</div>
              <input type="text" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-label">{t('common:fields.email')}</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm" onClick={() => { setEditingProfile(false); setName(profile.name); setEmail(profile.email); }}>{t('common:actions.cancel')}</button>
              <button className={'btn-primary' + (savingProfile ? ' btn-loading' : '')} disabled={savingProfile} onClick={handleSaveProfile}>
                {savingProfile ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
              </button>
            </div>
          </>
        )}

        <hr className="form-divider" />

        {!showPasswordForm ? (
          <button className="btn-sm" onClick={() => setShowPasswordForm(true)}>
            <i className="ti ti-key"></i> {t('common:actions.changePassword')}
          </button>
        ) : (
          <>
            <div className="form-row">
              <div className="form-label">{t('common:fields.currentPassword')}</div>
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-label">{t('common:fields.newPassword')}</div>
              <input type="password" autoComplete="new-password" placeholder={t('profile.newPasswordPlaceholder')} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-label">{t('profile.confirmNewPassword')}</div>
              <input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm" onClick={() => { setShowPasswordForm(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}>{t('common:actions.cancel')}</button>
              <button className={'btn-primary' + (changingPassword ? ' btn-loading' : '')} disabled={changingPassword} onClick={handleChangePassword}>
                {changingPassword ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.changePassword')}</>}
              </button>
            </div>
          </>
        )}
      </div>
      <div id="modal-footer" className="modal-footer">
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.close')}</button>
      </div>
    </>
  );
}
