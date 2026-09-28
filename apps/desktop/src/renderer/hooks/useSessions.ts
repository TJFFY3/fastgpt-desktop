import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRecord } from "../../../../../packages/shared/src/index";
export function useSessions(
  query: string,
  archived: boolean,
  onError: (message: string) => void,
) {
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
