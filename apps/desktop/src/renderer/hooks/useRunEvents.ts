/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useEffect, useState } from 'react';
import type { RunEvent } from '../../../../../packages/shared/src/index';
/** Provides the UI state and lifecycle integration consumed by this renderer feature. */
/* 中文：为界面功能提供状态管理及生命周期衔接。 */
export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<RunEvent[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    setEvents([]);
    setError('');
    if (!runId) return;
    let alive = true;
    const received = new Map<number, RunEvent>();
    /** Implements one focused part of this module’s public responsibility. */
    /* 中文：实现本模块职责中的一项具体操作。 */
    const merge = (values: RunEvent[]) => {
      if (!alive) return;
      for (const e of values) if (e.runId === runId) received.set(e.seq, e);
      setEvents([...received.values()].sort((a, b) => a.seq - b.seq));
    };
    const unsubscribe = window.desktop.onRunEvent((e) => merge([e]));
    void (async () => {
      let after = 0;
      while (alive) {
        const page = await window.desktop.runs.events(runId, after);
        merge(page);
        if (page.length < 500) break;
        after = page.at(-1)!.seq;
      }
    })().catch((e) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [runId]);
  return { events: events.filter((e) => e.runId === runId), error };
}
