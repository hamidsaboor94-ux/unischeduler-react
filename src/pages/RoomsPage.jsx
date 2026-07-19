import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../components/Section.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useTableSort } from '../hooks/useTableSort.jsx';
import { deleteRoom } from '../api.js';
import { roomStatus } from '../utils.js';

export default function RoomsPage() {
  const { t } = useTranslation(['management', 'common']);
  const { rooms, exams, conflictsData, afterMutate } = useAppData();
  const { openModal, confirmAction } = useModal();
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  const filtered = q ? rooms.filter(r => r.name.toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q)) : rooms;
  const { sorted, sortTh, sortArrow } = useTableSort('rooms', filtered, {
    name: r => r.name, type: r => r.type, capacity: r => r.capacity,
  });

  return (
    <Section name="rooms">
      <div className="topbar">
        <i className="ti ti-door" style={{ color: 'var(--text-muted)', fontSize: 16 }} aria-hidden="true"></i>
        <h2>{t('management:roomsPage.title')}</h2>
        <div className="topbar-actions">
          <input type="text" className="select-sm" aria-label={t('management:roomsPage.searchAriaLabel')} placeholder={t('management:roomsPage.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn-primary" onClick={() => openModal('room')}><i className="ti ti-plus"></i> {t('management:roomsPage.addRoom')}</button>
        </div>
      </div>
      <div id="content">
        <div className="panel">
          <table className="data-table">
            <thead><tr>
              <th {...sortTh('name')}>{t('common:fields.room')}{sortArrow('name')}</th>
              <th {...sortTh('type')}>{t('management:roomsPage.columns.type')}{sortArrow('type')}</th>
              <th {...sortTh('capacity')}>{t('management:roomsPage.columns.capacity')}{sortArrow('capacity')}</th>
              <th>{t('management:roomsPage.columns.equipment')}</th><th>{t('common:fields.status')}</th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map(r => {
                const status = roomStatus(rooms, exams, conflictsData, r.id);
                return (
                  <tr key={r.id}>
                    <td>{r.name}</td><td>{r.type}</td><td>{r.capacity}</td><td>{r.equipment}</td>
                    <td><span className={'pill ' + status.cls}>{t(`common:status.${status.key}`)}</span></td>
                    <td><div className="row-actions">
                      <button className="icon-btn" aria-label={t('management:roomsPage.editAria', { name: r.name })} onClick={e => { e.stopPropagation(); openModal('room', r.id); }}><i className="ti ti-pencil" aria-hidden="true"></i></button>
                      <button className="icon-btn danger" aria-label={t('management:roomsPage.deleteAria', { name: r.name })} onClick={e => { e.stopPropagation(); confirmAction(t('management:roomsPage.confirmDelete', { name: r.name }), () => afterMutate(deleteRoom(r.id), t('management:roomsPage.toastRemoved'))); }}><i className="ti ti-trash" aria-hidden="true"></i></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
