/** Authority for elapsed time: wall-clock timestamps never participate in durations. */
export class RunClock {
  private active = new Map<
    string,
    { started: number; last: number; timer: ReturnType<typeof setInterval> }
  >();
  private finished = new Map<string, number>();
  constructor(
    private persist: (runId: string, elapsedMs: number) => void,
    private now: () => number = () => performance.now(),
    private onError: (runId: string, error: unknown) => void = () => {},
  ) {}
  /** Handles start within this module's workflow. */
  start(runId: string): void {
    if (this.active.has(runId) || this.finished.has(runId))
      throw new Error('Clock already started');
    const started = this.now();
    const timer = setInterval(() => {
      try {
        this.checkpoint(runId);
      } catch (error) {
        clearInterval(timer);
        this.onError(runId, error);
      }
    }, 5000);
    timer.unref?.();
    this.active.set(runId, { started, last: 0, timer });
  }
  /** Handles elapsed within this module's workflow. */
  elapsed(runId: string): number {
    const state = this.active.get(runId);
    if (!state) return this.finished.get(runId) ?? 0;
    state.last = Math.max(state.last, Math.floor(this.now() - state.started), 0);
    return state.last;
  }
  /** Handles checkpoint within this module's workflow. */
  checkpoint(runId: string): number {
    const elapsed = this.elapsed(runId);
    if (this.active.has(runId)) this.persist(runId, elapsed);
    return elapsed;
  }
  /** Handles finish within this module's workflow. */
  finish(runId: string): number {
    const state = this.active.get(runId),
      elapsed = this.checkpoint(runId);
    if (state) {
      clearInterval(state.timer);
      this.active.delete(runId);
      this.finished.set(runId, elapsed);
      if (this.finished.size > 1000) this.finished.delete(this.finished.keys().next().value!);
    }
    return elapsed;
  }
  /** Handles dispose within this module's workflow. */
  dispose(): void {
    for (const state of this.active.values()) clearInterval(state.timer);
    this.active.clear();
    this.finished.clear();
  }
}
