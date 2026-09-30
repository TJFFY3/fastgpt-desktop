/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import {
  AppError,
  approvalRecordSchema,
  approvalDecisionSchema,
  type ApprovalRecord,
  type ApprovalDecision,
  type Namespace,
} from '../../shared/src/index';
import type { Database } from './database';
import type { RunRepository } from './run-repository';
import { activeStatuses } from './run-repository';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by approval Repository and coordinates its collaborators. */
/* 中文：按命名空间存储和查询工具操作审批记录。 */
export class ApprovalRepository {
  constructor(
    private db: Database,
    private runs: RunRepository,
  ) {}
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  get(n: Namespace, id: string): ApprovalRecord {
    const r = this.db.raw
      .prepare('SELECT data FROM approvals WHERE namespace_key=? AND id=?')
      .get(namespaceKey(n), id);
    if (!r) throw new AppError('NOT_FOUND', '授权记录不存在');
    return approvalRecordSchema.parse(JSON.parse(r.data as string));
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  insert(n: Namespace, record: ApprovalRecord): void {
    const a = approvalRecordSchema.parse(record),
      run = this.runs.get(n, a.view.runId),
      key = namespaceKey(n);
    if (a.namespaceKey !== key || a.sessionId !== run.sessionId)
      throw new AppError('NOT_FOUND', '授权归属无效');
    if (
      a.view.state !== 'pending' ||
      !activeStatuses.includes(run.status) ||
      run.status === 'cancelling'
    )
      throw new AppError('PERMISSION_DENIED', '当前运行不能授权');
    this.db.raw
      .prepare('INSERT INTO approvals(namespace_key,id,session_id,run_id,data) VALUES(?,?,?,?,?)')
      .run(key, a.view.id, a.sessionId, a.view.runId, JSON.stringify(a));
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  decide(n: Namespace, id: string, decision: ApprovalDecision): ApprovalRecord {
    return this.db.transaction(() => {
      approvalDecisionSchema.parse(decision);
      const a = this.get(n, id),
        run = this.runs.get(n, a.view.runId);
      if (
        a.view.state !== 'pending' ||
        !activeStatuses.includes(run.status) ||
        run.status === 'cancelling'
      )
        throw new AppError('PERMISSION_DENIED', '授权已失效');
      a.view.state = decision;
      this.db.raw
        .prepare('UPDATE approvals SET data=? WHERE namespace_key=? AND id=?')
        .run(JSON.stringify(a), namespaceKey(n), id);
      return a;
    });
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  revokeRun(n: Namespace, runId: string): void {
    this.runs.get(n, runId);
    for (const row of this.db.raw
      .prepare('SELECT data FROM approvals WHERE namespace_key=? AND run_id=?')
      .all(namespaceKey(n), runId)) {
      const a = approvalRecordSchema.parse(JSON.parse(row.data as string));
      if (a.view.state === 'pending') {
        a.view.state = 'revoked';
        this.db.raw
          .prepare('UPDATE approvals SET data=? WHERE namespace_key=? AND id=?')
          .run(JSON.stringify(a), namespaceKey(n), a.view.id);
      }
    }
  }
}
