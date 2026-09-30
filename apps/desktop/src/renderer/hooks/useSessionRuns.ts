/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunEvent, RunRecord } from '../../../../../packages/shared/src/index';
/** Provides the UI state and lifecycle integration consumed by this renderer feature. */
/* 中文：为界面功能提供状态管理及生命周期衔接。 */
export function useSessionRuns(sessionId: string | null) {
  const scope = useRef({ sessionId, generation: 0 });
  const [runs, setRuns] = useState<RunRecord[]>([]),
    [eventsByRun, setEvents] = useState(new Map<string, RunEvent[]>());
  const loading = useRef(new Set<string>());
  const merge = useCallback((values: RunEvent[], generation: number) => {
    if (scope.current.generation !== generation) return;
    setEvents((previous) => {
      const result = new Map(previous);
      for (const e of values) {
        if (e.sessionId !== scope.current.sessionId) continue;
        const bySeq = new Map((result.get(e.runId) ?? []).map((v) => [v.seq, v]));
        bySeq.set(e.seq, e);
        result.set(
          e.runId,
          [...bySeq.values()].sort((a, b) => a.seq - b.seq),
        );
      }
      return result;
    });
  }, []);
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const generation = scope.current.generation,
      values = await window.desktop.runs.list(sessionId);
    if (scope.current.generation === generation && scope.current.sessionId === sessionId)
      setRuns(values);
  }, [sessionId]);
  const loadEvents = useCallback(
    async (runId: string) => {
      if (!sessionId || loading.current.has(runId)) return;
      const generation = scope.current.generation;
      loading.current.add(runId);
      try {
        let after = 0;
        while (scope.current.generation === generation) {
          const page = await window.desktop.runs.events(runId, after);
          merge(page, generation);
          if (page.length < 500) break;
          after = page.at(-1)!.seq;
        }
      } finally {
        if (scope.current.generation === generation) loading.current.delete(runId);
      }
    },
    [sessionId, merge],
  );
  useEffect(() => {
    scope.current = { sessionId, generation: scope.current.generation + 1 };
    const generation = scope.current.generation;
    setRuns([]);
    setEvents(new Map());
    loading.current.clear();
    const unsubscribe = window.desktop.onRunEvent((e) => {
      if (e.sessionId !== sessionId || scope.current.generation !== generation) return;
      merge([e], generation);
      if (e.type === 'status') void refresh().catch(() => {});
    });
    void refresh().catch(() => {});
    return () => {
      scope.current.generation++;
      unsubscribe();
    };
  }, [sessionId, refresh, merge]);
  return { runs: runs.filter((r) => r.sessionId === sessionId), eventsByRun, refresh, loadEvents };
}
