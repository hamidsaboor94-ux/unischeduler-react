import { useEffect, useState } from 'react';
import { fetchMigrationProgress } from '../api.js';

/** Polls GET /migrations/:id/progress every `intervalMs` while `enabled` — used by DryRunStep and
    ImportStep, the two steps that kick off a fire-and-forget engine run and need to watch it land.
    No polling precedent existed elsewhere in this codebase to reuse (the one other `setInterval`
    is an unrelated dashboard message carousel), so this is a small hook, not a generic job-poller
    abstraction — this app has exactly one thing that needs polling. */
export function useMigrationProgress(migrationId, { enabled = true, intervalMs = 1500 } = {}) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!enabled || !migrationId) return undefined;
    let cancelled = false;

    async function poll() {
      try {
        const p = await fetchMigrationProgress(migrationId);
        if (!cancelled) setProgress(p);
      } catch {
        // A transient poll failure isn't fatal — the next tick tries again.
      }
    }

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [migrationId, enabled, intervalMs]);

  return progress;
}
