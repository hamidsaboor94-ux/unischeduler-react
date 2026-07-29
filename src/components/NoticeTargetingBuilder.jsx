import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext.jsx';
import { NOTICE_AUDIENCES } from '../noticeConstants.js';
import { roleLabel } from '../roleNames.js';

/** Reads every selected <option> of a native multi-select into a plain array — used by every
    filter below instead of a bespoke chip-picker, since a native multi-select is fully
    accessible and needs no extra CSS to fit this app's existing form styling. */
function selectedValues(e) {
  return [...e.target.selectedOptions].map(o => o.value);
}

const AUDIENCE_ICON = { students: 'ti-school', faculty: 'ti-chalkboard', staff: 'ti-briefcase', roles: 'ti-shield', users: 'ti-user' };

function MultiSelectField({ label, options, valueKey, labelFn, selected, onChange, size = 4 }) {
  return (
    <div className="form-row">
      <div className="form-label">{label}</div>
      <select multiple size={Math.min(size, Math.max(3, options.length))} value={selected.map(String)} onChange={e => onChange(selectedValues(e))}>
        {options.map(opt => {
          const value = String(typeof opt === 'object' ? opt[valueKey] : opt);
          return <option key={value} value={value}>{labelFn ? labelFn(opt) : value}</option>;
        })}
      </select>
    </div>
  );
}

function GroupFilters({ group, meta, onFilterChange }) {
  const { t } = useTranslation('announcements');
  const { branding } = useAppData();
  const f = group.filters || {};

  if (group.audience === 'students') {
    return (
      <div className="form-row-2">
        <MultiSelectField label={t('targeting.filters.department')} options={meta.departments} valueKey="id" labelFn={d => d.name}
          selected={f.departmentIds || []} onChange={v => onFilterChange('departmentIds', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.college')} options={meta.colleges} valueKey="id" labelFn={c => c.name}
          selected={f.collegeIds || []} onChange={v => onFilterChange('collegeIds', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.program')} options={meta.programs} valueKey="id" labelFn={p => p.name}
          selected={f.programIds || []} onChange={v => onFilterChange('programIds', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.semester')} options={meta.semesters} valueKey={null} labelFn={s => t('targeting.filters.semesterN', { n: s })}
          selected={f.semesters || []} onChange={v => onFilterChange('semesters', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.section')} options={meta.sections} valueKey={null}
          selected={f.sections || []} onChange={v => onFilterChange('sections', v)} />
        <MultiSelectField label={t('targeting.filters.status')} options={meta.studentStatuses} valueKey={null}
          selected={f.statuses || []} onChange={v => onFilterChange('statuses', v)} />
        <MultiSelectField label={t('targeting.filters.course')} options={meta.courses} valueKey="id" labelFn={c => `${c.code} — ${c.name}`}
          selected={f.courseIds || []} onChange={v => onFilterChange('courseIds', v.map(Number))} />
      </div>
    );
  }
  if (group.audience === 'faculty') {
    return (
      <div className="form-row-2">
        <MultiSelectField label={t('targeting.filters.department')} options={meta.departments} valueKey="id" labelFn={d => d.name}
          selected={f.departmentIds || []} onChange={v => onFilterChange('departmentIds', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.college')} options={meta.colleges} valueKey="id" labelFn={c => c.name}
          selected={f.collegeIds || []} onChange={v => onFilterChange('collegeIds', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.designation')} options={meta.facultyDesignations} valueKey={null}
          selected={f.designations || []} onChange={v => onFilterChange('designations', v)} />
        <MultiSelectField label={t('targeting.filters.employmentType')} options={meta.facultyEmploymentTypes} valueKey={null}
          selected={f.employmentTypes || []} onChange={v => onFilterChange('employmentTypes', v)} />
        <MultiSelectField label={t('targeting.filters.status')} options={meta.facultyStatuses} valueKey={null}
          selected={f.statuses || []} onChange={v => onFilterChange('statuses', v)} />
        <MultiSelectField label={t('targeting.filters.course')} options={meta.courses} valueKey="id" labelFn={c => `${c.code} — ${c.name}`}
          selected={f.courseIds || []} onChange={v => onFilterChange('courseIds', v.map(Number))} />
      </div>
    );
  }
  if (group.audience === 'staff') {
    return (
      <div className="form-row-2">
        <MultiSelectField label={t('targeting.filters.staffRole')} options={meta.staffRoles} valueKey={null} labelFn={r => roleLabel(r, t, branding)}
          selected={f.roles || []} onChange={v => onFilterChange('roles', v)} />
        <MultiSelectField label={t('targeting.filters.department')} options={meta.departments} valueKey="id" labelFn={d => d.name}
          selected={f.departmentIds || []} onChange={v => onFilterChange('departmentIds', v.map(Number))} />
        <MultiSelectField label={t('targeting.filters.college')} options={meta.colleges} valueKey="id" labelFn={c => c.name}
          selected={f.collegeIds || []} onChange={v => onFilterChange('collegeIds', v.map(Number))} />
      </div>
    );
  }
  if (group.audience === 'roles') {
    return (
      <div className="form-row">
        <MultiSelectField label={t('targeting.filters.role')} options={meta.allRoles} valueKey={null} labelFn={r => roleLabel(r, t, branding)}
          selected={f.roles || []} onChange={v => onFilterChange('roles', v)} size={6} />
      </div>
    );
  }
  return null;
}

/** "Specific Users" search + chip picker — the one audience that isn't a native multi-select
    since it needs a live server search (see GET /notices/meta/users-search) rather than a fixed
    option list. */
function UserPickerFilter({ group, onFilterChange, searchUsers }) {
  const { t } = useTranslation('announcements');
  const selected = group.filters?.selectedUsers || [];
  return (
    <div>
      <div className="form-row">
        <div className="form-label">{t('targeting.filters.searchUsers')}</div>
        <UserSearchInput
          onPick={(user) => {
            if (selected.some(u => u.id === user.id)) return;
            const nextSelected = [...selected, user];
            onFilterChange('selectedUsers', nextSelected);
            onFilterChange('userIds', nextSelected.map(u => u.id));
          }}
          searchUsers={searchUsers}
        />
      </div>
      {selected.length > 0 && (
        <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {selected.map(u => (
            <span key={u.id} className="pill pill-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {u.name || u.email}
              <button type="button" className="icon-btn" style={{ width: 16, height: 16 }} aria-label={t('targeting.filters.removeUser')}
                onClick={() => {
                  const nextSelected = selected.filter(x => x.id !== u.id);
                  onFilterChange('selectedUsers', nextSelected);
                  onFilterChange('userIds', nextSelected.map(x => x.id));
                }}>
                <i className="ti ti-x" aria-hidden="true"></i>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="field-hint" style={{ marginTop: 4 }}>{t('targeting.filters.selectedCount', { count: selected.length })}</div>
    </div>
  );
}

function UserSearchInput({ onPick, searchUsers }) {
  const { t } = useTranslation('announcements');
  return (
    <SearchBox onSearch={searchUsers} onPick={onPick} placeholder={t('targeting.filters.searchUsersPlaceholder')} />
  );
}

// Kept as its own tiny component (rather than inlined) purely so its debounce timer/results
// state don't get recreated identity issues from the parent's re-renders on every keystroke.
function SearchBox({ onSearch, onPick, placeholder }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const timer = useRef(null);

  function handleChange(e) {
    const value = e.target.value;
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try { setResults(await onSearch(value)); } catch { setResults([]); }
    }, 300);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input type="text" value={q} onChange={handleChange} placeholder={placeholder} />
      {results.length > 0 && (
        <div className="panel" style={{ position: 'absolute', zIndex: 5, width: '100%', maxHeight: 200, overflowY: 'auto', padding: 4 }}>
          {results.map(u => (
            <button key={u.id} type="button" className="btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2 }}
              onClick={() => { onPick(u); setQ(''); setResults([]); }}>
              {u.name || u.email} <span className="field-hint">{u.email} · {u.idNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NoticeTargetingBuilder({ groups, onChange, meta, searchUsers, disabled }) {
  const { t } = useTranslation('announcements');

  function addGroup(audience) {
    onChange([...groups, { audience, filters: {} }]);
  }
  function removeGroup(index) {
    onChange(groups.filter((_, i) => i !== index));
  }
  function updateGroupFilter(index, key, value) {
    onChange(groups.map((g, i) => (i === index ? { ...g, filters: { ...g.filters, [key]: value } } : g)));
  }

  return (
    <div className="notice-targeting-builder">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {NOTICE_AUDIENCES.map(a => (
          <button key={a} type="button" className="btn-sm" disabled={disabled} onClick={() => addGroup(a)}>
            <i className={`ti ${AUDIENCE_ICON[a]}`} aria-hidden="true"></i> {t(`targeting.audiences.${a}`)}
          </button>
        ))}
      </div>

      {groups.length === 0 && <div className="field-hint">{t('targeting.empty')}</div>}

      {groups.map((group, i) => (
        <div key={i} className="panel" style={{ marginBottom: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="pill pill-blue"><i className={`ti ${AUDIENCE_ICON[group.audience]}`} aria-hidden="true"></i> {t(`targeting.audiences.${group.audience}`)}</span>
            {!disabled && (
              <button type="button" className="icon-btn danger" aria-label={t('targeting.removeGroup')} onClick={() => removeGroup(i)}>
                <i className="ti ti-trash" aria-hidden="true"></i>
              </button>
            )}
          </div>
          {group.audience === 'users'
            ? <UserPickerFilter group={group} onFilterChange={(k, v) => updateGroupFilter(i, k, v)} searchUsers={searchUsers} />
            : <GroupFilters group={group} meta={meta} onFilterChange={(k, v) => updateGroupFilter(i, k, v)} />}
        </div>
      ))}
    </div>
  );
}
