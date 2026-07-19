import { useAsyncAction } from './useAsyncAction.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/** Shared tail of saveModalInner() across every entity modal type: run the save, close on
    success, toast, and unconditionally-on-success reload — a single toast(err.message, 'error')
    on failure, modal stays open so the user can fix the field. `validate()` returning a string
    shows it as a warning toast and aborts before the request is made (mirrors each type's early
    "toast('...', 'warning'); return;" guards in the original). */
export function useModalSave() {
  const { reload } = useAppData();
  const { closeModal } = useModal();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();

  async function save(makePromise, { successMessage = 'Saved.', validate } = {}) {
    if (validate) {
      const problem = validate();
      if (problem) { toast(problem, 'warning'); return false; }
    }
    try {
      const result = await run(makePromise());
      closeModal();
      if (successMessage) toast(successMessage);
      await reload();
      return result;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }
  return { save, loading };
}
