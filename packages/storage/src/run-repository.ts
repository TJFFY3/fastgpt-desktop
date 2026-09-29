/** Provides the run repository module for the desktop application. */
import { randomUUID } from 'node:crypto';
import {
  AppError,
  agentEventSchema,
  runRecordSchema,
  modelSnapshotSchema,
  runStartSchema,
  type ModelSnapshot,
  type AgentEvent,
  type Namespace,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type ToolCall,
  type ToolResult,
} from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
import type { SessionRepository } from './session-repository';
import type { AttachmentRepository } from './attachment-repository';
export const activeStatuses: RunStatus[] = [
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'cancelling',
];
/** Configures allowed, the module data used by this workflow. */
const allowed: Partial<Record<RunStatus, RunStatus[]>> = {
  queued: ['running', 'cancelling', 'cancelled', 'failed', 'interrupted'],
  running: [
    'waiting_approval',
    'waiting_input',
    'cancelling',
    'completed',
    'cancelled',
    'failed',
    'interrupted',
  ],
  waiting_approval: ['running', 'cancelling', 'failed', 'interrupted'],
  waiting_input: ['running', 'cancelling', 'failed', 'interrupted'],
  cancelling: ['cancelled', 'failed', 'interrupted'],
};
/** Performs record for this module. */
function record(r: Record<string, unknown>): RunRecord {
  return runRecordSchema.parse({
    id: r.id as string,
    sessionId: r.session_id as string,
    status: r.status as RunStatus,
    errorCode: r.error_code as string | null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    modelSnapshot: r.model_snapshot ? JSON.parse(r.model_snapshot as string) : null,
    elapsedMs: r.elapsed_ms ?? 0,
    timingUpdatedAt: r.timing_updated_at ?? null,
  });
}
/** Coordinates run Repository responsibilities for this module. */
export class RunRepository {
  constructor(
    private db: Database,
    private sessions: SessionRepository,
    private attachments: AttachmentRepository,
  ) {}
  /** Handles create With User Message within this module's workflow. */
  createWithUserMessage(
    n: Namespace,
    sessionId: string,
    text: string,
    options: { snapshot?: ModelSnapshot; attachmentIds?: string[] } = {},
  ): RunRecord {
    return this.db.transaction(() => {
      this.sessions.get(n, sessionId);
      if (this.list(n, sessionId).some((r) => activeStatuses.includes(r.status)))
        throw new AppError('RUN_ACTIVE', '会话已有正在执行的任务');
      const request = runStartSchema.parse({
        sessionId,
        text,
        attachmentIds: options.attachmentIds ?? [],
      });
      const id = randomUUID(),
        time = Date.now();
      this.db.raw
        .prepare(
          "INSERT INTO runs(namespace_key,session_id,id,status,error_code,created_at,updated_at,model_snapshot) VALUES(?,?,?,'queued',NULL,?,?,?)",
        )
        .run(
          namespaceKey(n),
          sessionId,
          id,
          time,
          time,
          options.snapshot ? JSON.stringify(modelSnapshotSchema.parse(options.snapshot)) : null,
        );
      const message = this.sessions.appendMessage(
        n,
        sessionId,
        { role: 'user', content: request.text || '已添加文件' },
        'complete',
        { runId: id, attachmentIds: request.attachmentIds },
      );
      this.attachments.markSent(n, request.attachmentIds, message.id);
      return this.get(n, id);
    });
  }
  /** Handles get within this module's workflow. */
  get(n: Namespace, id: string): RunRecord {
    const row = this.db.raw
      .prepare('SELECT * FROM runs WHERE namespace_key=? AND id=?')
      .get(namespaceKey(n), id);
    if (!row) throw new AppError('NOT_FOUND', '运行不存在');
    return record(row);
  }
  /** Handles list within this module's workflow. */
  list(n: Namespace, sessionId: string): RunRecord[] {
    this.sessions.get(n, sessionId);
    return this.db.raw
      .prepare(
        'SELECT * FROM runs WHERE namespace_key=? AND session_id=? ORDER BY created_at,rowid',
      )
      .all(namespaceKey(n), sessionId)
      .map(record);
  }
  /** Handles save Timing within this module's workflow. */
  saveTiming(n: Namespace, id: string, elapsedMs: number): RunRecord {
    const run = this.get(n, id);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new AppError('INVALID_INPUT', '耗时无效');
    if (!activeStatuses.includes(run.status)) return run;
    this.db.raw
      .prepare(
        'UPDATE runs SET elapsed_ms=MAX(elapsed_ms,?),timing_updated_at=? WHERE namespace_key=? AND id=?',
      )
      .run(elapsedMs, Date.now(), namespaceKey(n), id);
    return this.get(n, id);
  }
  /** Handles transition within this module's workflow. */
  transition(
    n: Namespace,
    id: string,
    status: RunStatus,
    errorCode: string | null = null,
  ): RunRecord {
    const old = this.get(n, id);
    if (!allowed[old.status]?.includes(status))
      throw new AppError('INVALID_INPUT', '不允许的运行状态转换');
    this.db.raw
      .prepare('UPDATE runs SET status=?,error_code=?,updated_at=? WHERE namespace_key=? AND id=?')
      .run(status, errorCode, Date.now(), namespaceKey(n), id);
    return this.get(n, id);
  }
  /** Handles append Event within this module's workflow. */
  appendEvent(
    n: Namespace,
    id: string,
    event: AgentEvent,
    metadata?: { messageId: string },
  ): RunEvent {
    return this.db.transaction(() => {
      const run = this.get(n, id),
        value = agentEventSchema.parse(event),
        key = namespaceKey(n),
        row = this.db.raw
          .prepare(
            'SELECT COALESCE(MAX(seq),0)+1 AS seq FROM run_events WHERE namespace_key=? AND run_id=?',
          )
          .get(key, id)!;
      /** Configures result, the module data used by this workflow. */
      const result = {
        ...value,
        ...(metadata ? { messageId: metadata.messageId } : {}),
        runId: id,
        sessionId: run.sessionId,
        seq: row.seq as number,
        createdAt: Date.now(),
      };
      if (
        metadata &&
        (event.type !== 'assistant_message' ||
          !this.db.raw
            .prepare('SELECT 1 FROM messages WHERE namespace_key=? AND session_id=? AND id=?')
            .get(key, run.sessionId, metadata.messageId))
      )
        throw new AppError('INVALID_INPUT', '消息事件归属不匹配');
      this.db.raw
        .prepare('INSERT INTO run_events(namespace_key,run_id,seq,data) VALUES(?,?,?,?)')
        .run(key, id, result.seq, JSON.stringify(result));
      return result;
    });
  }
  /** Handles events within this module's workflow. */
  events(n: Namespace, id: string, afterSeq = 0): RunEvent[] {
    this.get(n, id);
    return this.db.raw
      .prepare(
        'SELECT data FROM run_events WHERE namespace_key=? AND run_id=? AND seq>? ORDER BY seq LIMIT 500',
      )
      .all(namespaceKey(n), id, afterSeq)
      .map((r) => JSON.parse(r.data as string));
  }
  /** Handles recover Interrupted within this module's workflow. */
  recoverInterrupted(): number {
    return this.db.transaction(() => {
      const rows = this.db.raw
        .prepare(
          "SELECT * FROM runs WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling')",
        )
        .all();
      for (const row of rows) {
        /** Configures n, the module data used by this workflow. */
        const [instanceId, accountId, teamId] = JSON.parse(row.namespace_key as string),
          n = { instanceId, accountId, teamId },
          run = record(row);
        let partial = '';
        let after = 0;
        while (true) {
          const page = this.events(n, run.id, after);
          for (const e of page) {
            if (e.type === 'text_delta') partial += e.text;
            if (e.type === 'assistant_message' && e.message.role === 'assistant') partial = '';
          }
          if (page.length < 500) break;
          after = page.at(-1)!.seq;
        }
        if (partial)
          this.sessions.appendMessage(
            n,
            run.sessionId,
            { role: 'assistant', content: partial },
            'interrupted',
            { runId: run.id },
          );
        this.transition(n, run.id, 'interrupted', 'WORKER_INTERRUPTED');
        this.appendEvent(n, run.id, { type: 'status', status: 'interrupted' });
      }
      return rows.length;
    });
  }
  /** Handles reserve Tool Call within this module's workflow. */
  reserveToolCall(
    n: Namespace,
    id: string,
    call: ToolCall,
  ): 'reserved' | 'completed' | 'unresolved' {
    return this.db.transaction(() => {
      this.get(n, id);
      const key = namespaceKey(n),
        row = this.db.raw
          .prepare('SELECT * FROM tool_calls WHERE namespace_key=? AND run_id=? AND call_id=?')
          .get(key, id, call.id);
      if (row) {
        if (row.name !== call.name || row.arguments !== call.arguments)
          throw new AppError('MODEL_PROTOCOL_ERROR', '工具调用编号重复且参数不一致');
        return row.result === null ? 'unresolved' : 'completed';
      }
      this.db.raw
        .prepare(
          'INSERT INTO tool_calls(namespace_key,run_id,call_id,name,arguments,result) VALUES(?,?,?,?,?,NULL)',
        )
        .run(key, id, call.id, call.name, call.arguments);
      return 'reserved';
    });
  }
  /** Handles tool Result within this module's workflow. */
  toolResult(n: Namespace, id: string, callId: string): ToolResult | null {
    this.get(n, id);
    const r = this.db.raw
      .prepare('SELECT result FROM tool_calls WHERE namespace_key=? AND run_id=? AND call_id=?')
      .get(namespaceKey(n), id, callId);
    return r?.result ? JSON.parse(r.result as string) : null;
  }
  /** Handles complete Tool Call within this module's workflow. */
  completeToolCall(n: Namespace, id: string, callId: string, result: ToolResult) {
    this.get(n, id);
    const changed = this.db.raw
      .prepare(
        'UPDATE tool_calls SET result=? WHERE namespace_key=? AND run_id=? AND call_id=? AND result IS NULL',
      )
      .run(JSON.stringify(result), namespaceKey(n), id, callId);
    if (!changed.changes) throw new AppError('INVALID_INPUT', '工具调用未预留或已经完成');
  }
}
