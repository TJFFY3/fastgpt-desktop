import { useEffect, useState } from "react";
import type { RunEvent } from "../../../../../packages/shared/src/index";
export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<RunEvent[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    setEvents([]);
    setError("");
    if (!runId) return;
    let alive = true;
    const received = new Map<number, RunEvent>();
    const merge = (values: RunEvent[]) => {
      if (!alive) return;
      for (const e of values) if (e.runId === runId) received.set(e.seq, e);
      setEvents([...received.values()].sort((a, b) => a.seq - b.seq));
    };
    const unsubscribe = window.desktop.onRunEvent((e) => merge([e]));
    void window.desktop.runs
      .events(runId)
      .then(merge)
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [runId]);
  return { events: events.filter((e) => e.runId === runId), error };
}
