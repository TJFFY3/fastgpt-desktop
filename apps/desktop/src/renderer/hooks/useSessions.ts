/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionRecord } from '../../../../../packages/shared/src/index';
/** Provides the UI state and lifecycle integration consumed by this renderer feature. */
/* 中文：为界面功能提供状态管理及生命周期衔接。 */
export function useSessions(query: string, archived: boolean, onError: (message: string) => void) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]),
    revision = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++revision.current;
    try {
      const values = await window.desktop.sessions.list({ query, archived });
      if (ticket === revision.current) setSessions(values);
    } catch (e) {
      onError(String(e));
    }
  }, [query, archived, onError]);
  useEffect(() => {
    void refresh();
    return () => {
      revision.current++;
    };
  }, [refresh]);
  return { sessions, refresh };
}
