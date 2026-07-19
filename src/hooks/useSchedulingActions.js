import { api } from '../api.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsyncAction } from './useAsyncAction.js';

/** Port of autoScheduleAll() — shared by the Dashboard and Exams pages. Builds every missing
    exam row for the active term's courses, then schedules date/time/room/invigilator for
    anything still unscheduled. Returns the full result ({created, scheduled, unresolved}) so
    the caller can show a detailed summary, not just a toast. `examType`, when passed (the
    Exams page always passes one via its type-selection dialog), scopes the whole run to just
    that exam type — the Dashboard's shortcut button omits it, which keeps its old
    any-type behavior unchanged. */
export function useAutoSchedule() {
  const { activeTermId, reload } = useAppData();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  async function autoScheduleAll(examType) {
    const type = typeof examType === 'string' ? examType : undefined;
    const result = await run(api('POST', '/exams/auto-schedule', { termId: activeTermId, examType: type }));
    await reload();
    const parts = [];
    if (result.created > 0) parts.push(`created ${result.created} exam${result.created === 1 ? '' : 's'}`);
    if (result.scheduled > 0) parts.push(`scheduled ${result.scheduled}`);
    const typeLabel = result.examType ? result.examType[0].toUpperCase() + result.examType.slice(1) : '';
    const label = typeLabel ? `${typeLabel} exams: ` : 'Auto-generate: ';
    let msg = parts.length ? `${label}${parts.join(', ')}.` : `Nothing to do — every ${typeLabel ? typeLabel.toLowerCase() + ' ' : ''}exam already exists and is scheduled.`;
    const flagged = (result.unresolved?.length || 0) + (result.needsInvigilator?.length || 0);
    if (result.unresolved?.length) msg += ` ${result.unresolved.length} exam${result.unresolved.length === 1 ? '' : 's'} couldn't be scheduled.`;
    if (result.needsInvigilator?.length) msg += ` ${result.needsInvigilator.length} still need${result.needsInvigilator.length === 1 ? 's' : ''} an invigilator.`;
    if (flagged) msg += ' See details below.';
    toast(msg, flagged ? 'warning' : 'info');
    return result;
  }
  return { autoScheduleAll, loading };
}

/** Port of autoResolveAll() — shared by the Conflicts and Timetable/Exams "suggest fix" actions. */
export function useAutoResolve() {
  const { activeTermId, reload } = useAppData();
  const { toast } = useToast();
  const { run, loading } = useAsyncAction();
  async function autoResolveAll() {
    const result = await run(api('POST', '/conflicts/auto-resolve', { termId: activeTermId }));
    await reload();
    toast(result.fixed > 0 ? `Auto-resolved ${result.fixed} issue${result.fixed > 1 ? 's' : ''}.` : 'No auto-fixable issues found.');
  }
  return { autoResolveAll, loading };
}
