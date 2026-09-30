/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useEffect, useState } from 'react';
import type { RunRecord } from '../../../../../packages/shared/src/index';
const activeStatuses = ['queued', 'running', 'waiting_approval', 'waiting_input', 'cancelling'];
/** Provides the UI state and lifecycle integration consumed by this renderer feature. */
/* 中文：为界面功能提供状态管理及生命周期衔接。 */
export function useRunTimer(run: RunRecord): number {
  const [sample, setSample] = useState({ id: run.id, elapsed: run.elapsedMs });
  useEffect(() => {
    let alive = true,
      base = run.elapsedMs,
      anchor = performance.now();
    const active = activeStatuses.includes(run.status);
    setSample({ id: run.id, elapsed: base });
    /** Persists or updates state while maintaining this module’s data invariants. */
    /* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
    const update = async () => {
      try {
        const next = await window.desktop.runs.timing(run.id);
        if (!alive || next.runId !== run.id || (!active && next.active)) return;
        base = Math.max(base, next.elapsedMs);
        anchor = performance.now();
        setSample({ id: run.id, elapsed: base });
      } catch {
        /* Persisted checkpoint remains visible if refresh is unavailable. */
        /* 中文：刷新失败时继续显示已保存的耗时检查点。 */
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
