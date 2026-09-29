/** Provides the use Run Timer module for the desktop application. */
import { useEffect, useState } from 'react';
import type { RunRecord } from '../../../../../packages/shared/src/index';
const activeStatuses = ['queued', 'running', 'waiting_approval', 'waiting_input', 'cancelling'];
/** Performs use Run Timer for this module. */
export function useRunTimer(run: RunRecord): number {
  const [sample, setSample] = useState({ id: run.id, elapsed: run.elapsedMs });
  useEffect(() => {
    let alive = true,
      base = run.elapsedMs,
      anchor = performance.now();
    const active = activeStatuses.includes(run.status);
    setSample({ id: run.id, elapsed: base });
    /** Performs update for this module. */
    const update = async () => {
      try {
        const next = await window.desktop.runs.timing(run.id);
        if (!alive || next.runId !== run.id || (!active && next.active)) return;
        base = Math.max(base, next.elapsedMs);
        anchor = performance.now();
        setSample({ id: run.id, elapsed: base });
      } catch {
        /* Persisted checkpoint remains visible if refresh is unavailable. */
      }
    };
    void update();
    const timer = active
      ? setInterval(() => {
          setSample({ id: run.id, elapsed: base + Math.max(0, performance.now() - anchor) });
          void update();
        }, 1000)
      : undefined;
    return () => {
      alive = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [run.id, run.status, run.elapsedMs]);
  return sample.id === run.id ? sample.elapsed : run.elapsedMs;
}
