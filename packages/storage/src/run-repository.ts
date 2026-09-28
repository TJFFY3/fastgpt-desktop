import { randomUUID } from "node:crypto";
import {
  AppError,
  agentEventSchema,
  type AgentEvent,
  type Namespace,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type ToolCall,
  type ToolResult,
} from "../../shared/src/index";
import type { Database } from "./database";
import { namespaceKey } from "./namespace";
import type { SessionRepository } from "./session-repository";
export const activeStatuses: RunStatus[] = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "cancelling",
];
const allowed: Partial<Record<RunStatus, RunStatus[]>> = {
  queued: ["running", "cancelling", "cancelled", "failed", "interrupted"],
  running: [
    "waiting_approval",
    "waiting_input",
    "cancelling",
    "completed",
    "cancelled",
    "failed",
    "interrupted",
  ],
  waiting_approval: ["running", "cancelling", "failed", "interrupted"],
  waiting_input: ["running", "cancelling", "failed", "interrupted"],
  cancelling: ["cancelled", "failed", "interrupted"],
};
function record(r: Record<string, unknown>): RunRecord {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    status: r.status as RunStatus,
    errorCode: r.error_code as string | null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}
export class RunRepository {
  constructor(
    private db: Database,
    private sessions: SessionRepository,
  ) {}
  createWithUserMessage(
    n: Namespace,
    sessionId: string,
    text: string,
  ): RunRecord {
    return this.db.transaction(() => {
      this.sessions.get(n, sessionId);
      if (
        this.list(n, sessionId).some((r) => activeStatuses.includes(r.status))
      )
        throw new AppError("RUN_ACTIVE", "会话已有正在执行的任务");
      this.sessions.appendMessage(
        n,
        sessionId,
        { role: "user", content: text },
        "complete",
      );
      const id = randomUUID(),
        time = Date.now();
      this.db.raw
        .prepare("INSERT INTO runs VALUES(?,?,?,'queued',NULL,?,?)")
        .run(namespaceKey(n), sessionId, id, time, time);
      return this.get(n, id);
    });
  }
  get(n: Namespace, id: string): RunRecord {
    const row = this.db.raw
      .prepare("SELECT * FROM runs WHERE namespace_key=? AND id=?")
      .get(namespaceKey(n), id);
    if (!row) throw new AppError("NOT_FOUND", "运行不存在");
    return record(row);
  }
  list(n: Namespace, sessionId: string): RunRecord[] {
    this.sessions.get(n, sessionId);
    return this.db.raw
      .prepare(
        "SELECT * FROM runs WHERE namespace_key=? AND session_id=? ORDER BY created_at,rowid",
      )
      .all(namespaceKey(n), sessionId)
      .map(record);
  }
  transition(
    n: Namespace,
    id: string,
    status: RunStatus,
    errorCode: string | null = null,
  ): RunRecord {
    const old = this.get(n, id);
    if (!allowed[old.status]?.includes(status))
      throw new AppError("INVALID_INPUT", "不允许的运行状态转换");
    this.db.raw
      .prepare(
        "UPDATE runs SET status=?,error_code=?,updated_at=? WHERE namespace_key=? AND id=?",
      )
      .run(status, errorCode, Date.now(), namespaceKey(n), id);
    return this.get(n, id);
  }
  appendEvent(n: Namespace, id: string, event: AgentEvent): RunEvent {
    return this.db.transaction(() => {
      const run = this.get(n, id),
        value = agentEventSchema.parse(event),
        key = namespaceKey(n),
        row = this.db.raw
          .prepare(
            "SELECT COALESCE(MAX(seq),0)+1 AS seq FROM run_events WHERE namespace_key=? AND run_id=?",
          )
          .get(key, id)!;
      const result = {
        ...value,
        runId: id,
        sessionId: run.sessionId,
        seq: row.seq as number,
        createdAt: Date.now(),
      };
      this.db.raw
        .prepare("INSERT INTO run_events VALUES(?,?,?,?)")
        .run(key, id, result.seq, JSON.stringify(result));
      return result;
    });
  }
  events(n: Namespace, id: string, afterSeq = 0): RunEvent[] {
    this.get(n, id);
    return this.db.raw
      .prepare(
        "SELECT data FROM run_events WHERE namespace_key=? AND run_id=? AND seq>? ORDER BY seq",
      )
      .all(namespaceKey(n), id, afterSeq)
      .map((r) => JSON.parse(r.data as string));
  }
  recoverInterrupted(): number {
    return this.db.transaction(() => {
      const rows = this.db.raw
        .prepare(
          "SELECT * FROM runs WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling')",
        )
        .all();
      for (const row of rows) {
        const [instanceId, accountId, teamId] = JSON.parse(
            row.namespace_key as string,
          ),
          n = { instanceId, accountId, teamId },
          run = record(row);
        let partial = "";
        for (const e of this.events(n, run.id)) {
          if (e.type === "text_delta") partial += e.text;
          if (e.type === "assistant_message" && e.message.role === "assistant")
            partial = "";
        }
        if (partial)
          this.sessions.appendMessage(
            n,
            run.sessionId,
            { role: "assistant", content: partial },
            "interrupted",
          );
        this.transition(n, run.id, "interrupted", "WORKER_INTERRUPTED");
        this.appendEvent(n, run.id, { type: "status", status: "interrupted" });
      }
      return rows.length;
    });
  }
  reserveToolCall(
    n: Namespace,
    id: string,
    call: ToolCall,
  ): "reserved" | "completed" | "unresolved" {
    return this.db.transaction(() => {
      this.get(n, id);
      const key = namespaceKey(n),
        row = this.db.raw
          .prepare(
            "SELECT * FROM tool_calls WHERE namespace_key=? AND run_id=? AND call_id=?",
          )
          .get(key, id, call.id);
      if (row) {
        if (row.name !== call.name || row.arguments !== call.arguments)
          throw new AppError(
            "MODEL_PROTOCOL_ERROR",
            "工具调用编号重复且参数不一致",
          );
        return row.result === null ? "unresolved" : "completed";
      }
      this.db.raw
        .prepare("INSERT INTO tool_calls VALUES(?,?,?,?,?,NULL)")
        .run(key, id, call.id, call.name, call.arguments);
      return "reserved";
    });
  }
  toolResult(n: Namespace, id: string, callId: string): ToolResult | null {
    this.get(n, id);
    const r = this.db.raw
      .prepare(
        "SELECT result FROM tool_calls WHERE namespace_key=? AND run_id=? AND call_id=?",
      )
      .get(namespaceKey(n), id, callId);
    return r?.result ? JSON.parse(r.result as string) : null;
  }
  completeToolCall(
    n: Namespace,
    id: string,
    callId: string,
    result: ToolResult,
  ) {
    this.get(n, id);
    const changed = this.db.raw
      .prepare(
        "UPDATE tool_calls SET result=? WHERE namespace_key=? AND run_id=? AND call_id=? AND result IS NULL",
      )
      .run(JSON.stringify(result), namespaceKey(n), id, callId);
    if (!changed.changes)
      throw new AppError("INVALID_INPUT", "工具调用未预留或已经完成");
  }
}
