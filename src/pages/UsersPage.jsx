import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from '../hooks/useAsyncAction.js';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { api, deleteUser } from '../api.js';
import { parseCsv, csvArrayRowsToAccountObjects, excelObjectRowsToAccountObjects, parseExcelFile } from '../utils.js';

export default function UsersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { allUsers, currentUser, reload, afterMutate } = useAppData();
  const { showSection } = useNavigation();
  const { openModal, confirmAction } = useModal();
  const { toast } = useToast();
  const { run: runImport, loading: importing } = useAsyncAction();
  const importInputRef = useRef(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  let filtered = roleFilter ? allUsers.filter(u => u.role === roleFilter) : allUsers;
  if (q) {
    filtered = filtered.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.idNumber || '').toLowerCase().includes(q)
    );
  }
  const { sorted, sortTh, sortArrow } = useTableSort('users', filtered, {
    idNumber: u => u.idNumber || '', name: u => u.name || '', email: u => u.email, role: u => u.role, joined: u => u.createdAt || '',
  });

  async function changeUserRole(id, role) {
    await afterMutate(api('PUT', `/users/${id}`, { role }), t('admin:usersPage.toast.roleUpdated'));
  }

  async function importAccountsFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    let rows;
    try {
      if (ext === 'csv') {
        rows = csvArrayRowsToAccountObjects(parseCsv(await file.text()));
      } else if (ext === 'xlsx' || ext === 'xls') {
        rows = excelObjectRowsToAccountObjects(await parseExcelFile(file));
      } else {
        toast(t('admin:usersPage.toast.unsupportedFileType'), 'warning');
        return;
      }
    } catch (err) {
      toast(t('admin:usersPage.toast.fileReadError'), 'error');
      return;
    }
    if (!rows.length) { toast(t('admin:usersPage.toast.noDataRows'), 'warning'); return; }
    try {
      const result = await runImport(api('POST', '/users/bulk-import', { rows }));
      await reload();
      toast(result.errors.length
        ? t('admin:usersPage.toast.importedWithSkipped', { created: result.created.length, skipped: result.errors.length })
        : t('admin:usersPage.toast.imported', { created: result.created.length }));
      openModal('account-credentials', null, { accounts: result.created, errors: result.errors });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <Section name="users">
      <div className="topbar">
        <i className="ti ti-users-group" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('admin:usersPage.title')}</h2>
        <div className="topbar-actions">
          <input
            type="text" className="select-sm" aria-label={t('admin:usersPage.searchAriaLabel')}
            placeholder={t('admin:usersPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
          />
          <select className="select-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">{t('admin:usersPage.allRoles')}</option>
            <option value="admin">{t('common:roles.admin')}</option>
            <option value="faculty">{t('common:roles.faculty')}</option>
            <option value="student">{t('common:roles.student')}</option>
          </select>
          <input
            type="file" ref={importInputRef} accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { importAccountsFile(e.target.files[0]); e.target.value = ''; }}
          />
          <button className={'btn-sm' + (importing ? ' btn-loading' : '')} disabled={importing} onClick={() => importInputRef.current?.click()}>
            {importing ? <span className="spinner"></span> : <><i className="ti ti-upload"></i> {t('admin:usersPage.bulkImport')}</>}
          </button>
          <button className="btn-primary" onClick={() => openModal('create-account')}><i className="ti ti-plus"></i> {t('admin:usersPage.createAccount')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th {...sortTh('idNumber')}>{t('admin:usersPage.table.idNumber')}{sortArrow('idNumber')}</th>
              <th {...sortTh('name')}>{t('common:fields.name')}{sortArrow('name')}</th>
              <th {...sortTh('email')}>{t('common:fields.email')}{sortArrow('email')}</th>
              <th {...sortTh('role')}>{t('common:fields.role')}{sortArrow('role')}</th>
              <th {...sortTh('joined')}>{t('admin:usersPage.table.joined')}{sortArrow('joined')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {sorted.map(u => (
                <tr key={u.id}>
                  <td><code>{u.idNumber || t('common:notApplicable')}</code></td>
                  <td>{u.name || t('common:notApplicable')}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={e => changeUserRole(u.id, e.target.value)}
                      disabled={u.id === currentUser.id}
                      title={u.id === currentUser.id ? t('admin:usersPage.cannotChangeOwnRole') : undefined}
                    >
                      <option value="admin">{t('common:roles.admin')}</option>
                      <option value="faculty">{t('common:roles.faculty')}</option>
                      <option value="student">{t('common:roles.student')}</option>
                    </select>
                  </td>
                  <td>{(u.createdAt || '').split(' ')[0]}</td>
                  <td><div className="row-actions">
                    {u.role === 'student' && (
                      <button className="btn-sm" onClick={() => showSection('student-profile', { studentId: u.id })}>{t('admin:usersPage.viewProfile')}</button>
                    )}
                    <button className="btn-sm" onClick={() => openModal('reset-password', u.id)}>{t('admin:usersPage.resetPassword')}</button>
                    <button
                      className="icon-btn danger" aria-label={t('admin:usersPage.deleteAriaLabel', { name: u.name || u.email })}
                      disabled={u.id === currentUser.id}
                      onClick={() => confirmAction(
                        t('admin:usersPage.confirmDelete', { name: u.name || u.email }),
                        () => afterMutate(deleteUser(u.id), t('admin:usersPage.toast.userRemoved'))
                      )}
                    >
                      <i className="ti ti-trash" aria-hidden="true"></i>
                    </button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
