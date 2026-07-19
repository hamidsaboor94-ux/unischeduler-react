import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useModal } from '../../context/ModalContext.jsx';
import { useModalSave } from '../../hooks/useModalSave.js';
import { saveRoom, deleteRoom } from '../../api.js';
import { roomById } from '../../utils.js';

const ROOM_TYPES = ['Lecture hall', 'Exam hall', 'Classroom', 'Computer lab', 'Science lab'];
const ROOM_TYPE_KEYS = {
  'Lecture hall': 'lectureHall', 'Exam hall': 'examHall', 'Classroom': 'classroom',
  'Computer lab': 'computerLab', 'Science lab': 'scienceLab',
};

export default function RoomForm({ editId }) {
  const { t } = useTranslation(['management', 'common']);
  const { rooms, afterMutate } = useAppData();
  const { closeModal, confirmAction } = useModal();
  const { save, loading } = useModalSave();

  const seed = editId ? roomById(rooms, editId) : { name: '', type: 'Classroom', capacity: 30, equipment: '' };
  const [name, setName] = useState(seed.name);
  const [type, setType] = useState(seed.type);
  const [capacity, setCapacity] = useState(seed.capacity);
  const [equipment, setEquipment] = useState(seed.equipment);

  function handleSave() {
    return save(() => saveRoom({
      name: name.trim(), type, capacity: Number(capacity) || 1, equipment: equipment.trim() || '—',
    }, editId), {
      validate: () => (!name.trim() ? t('management:roomForm.validateName') : null),
    });
  }

  function handleDelete() {
    closeModal();
    confirmAction(t('management:roomForm.confirmDelete', { name: seed.name }), () => afterMutate(deleteRoom(editId), t('management:roomForm.toastRemoved')));
  }

  return (
    <>
      <div id="modal-body">
        <div className="form-row">
          <div className="form-label">{t('management:roomForm.nameLabel')}</div>
          <input type="text" placeholder={t('management:roomForm.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row-2">
          <div className="form-row">
            <div className="form-label">{t('management:roomForm.typeLabel')}</div>
            <select value={type} onChange={e => setType(e.target.value)}>
              {ROOM_TYPES.map(rt => <option key={rt} value={rt}>{t(`management:roomForm.types.${ROOM_TYPE_KEYS[rt]}`)}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-label">{t('management:roomForm.capacityLabel')}</div>
            <input type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-label">{t('management:roomForm.equipmentLabel')}</div>
          <input type="text" placeholder={t('management:roomForm.equipmentPlaceholder')} value={equipment} onChange={e => setEquipment(e.target.value)} />
        </div>
      </div>
      <div id="modal-footer" className="modal-footer">
        {editId && <button className="modal-danger-btn" onClick={handleDelete}>{t('common:actions.delete')}</button>}
        <button className="btn-sm" onClick={closeModal}>{t('common:actions.cancel')}</button>
        <button className={'btn-primary' + (loading ? ' btn-loading' : '')} disabled={loading} onClick={handleSave}>
          {loading ? <span className="spinner"></span> : <><i className="ti ti-check"></i> {t('common:actions.save')}</>}
        </button>
      </div>
    </>
  );
}
