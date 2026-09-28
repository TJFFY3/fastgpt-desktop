import { AppError, approvalRecordSchema, approvalDecisionSchema, type ApprovalRecord, type ApprovalDecision, type Namespace } from "../../shared/src/index";
import type { Database } from "./database";
import type { RunRepository } from "./run-repository";
import { activeStatuses } from "./run-repository";
import { namespaceKey } from "./namespace";
export class ApprovalRepository {
  constructor(private db:Database,private runs:RunRepository) {}
  get(n:Namespace,id:string):ApprovalRecord {
    const r=this.db.raw.prepare("SELECT data FROM approvals WHERE namespace_key=? AND id=?").get(namespaceKey(n),id);
    if(!r) throw new AppError("NOT_FOUND","授权记录不存在");
    return approvalRecordSchema.parse(JSON.parse(r.data as string));
  }
  insert(n:Namespace,record:ApprovalRecord):void {
    const a=approvalRecordSchema.parse(record),run=this.runs.get(n,a.view.runId),key=namespaceKey(n);
    if(a.namespaceKey!==key || a.sessionId!==run.sessionId) throw new AppError("NOT_FOUND","授权归属无效");
    if(a.view.state!=="pending" || !activeStatuses.includes(run.status) || run.status==="cancelling") throw new AppError("PERMISSION_DENIED","当前运行不能授权");
    this.db.raw.prepare("INSERT INTO approvals(namespace_key,id,session_id,run_id,data) VALUES(?,?,?,?,?)").run(key,a.view.id,a.sessionId,a.view.runId,JSON.stringify(a));
  }
  decide(n:Namespace,id:string,decision:ApprovalDecision):ApprovalRecord {
    return this.db.transaction(()=>{
      approvalDecisionSchema.parse(decision);
      const a=this.get(n,id),run=this.runs.get(n,a.view.runId);
      if(a.view.state!=="pending" || !activeStatuses.includes(run.status) || run.status==="cancelling") throw new AppError("PERMISSION_DENIED","授权已失效");
      a.view.state=decision;
      this.db.raw.prepare("UPDATE approvals SET data=? WHERE namespace_key=? AND id=?").run(JSON.stringify(a),namespaceKey(n),id);
      return a;
    });
  }
  revokeRun(n:Namespace,runId:string):void {
    this.runs.get(n,runId);
    for(const row of this.db.raw.prepare("SELECT data FROM approvals WHERE namespace_key=? AND run_id=?").all(namespaceKey(n),runId)) {
      const a=approvalRecordSchema.parse(JSON.parse(row.data as string));
      if(a.view.state==="pending") {
        a.view.state="revoked";
        this.db.raw.prepare("UPDATE approvals SET data=? WHERE namespace_key=? AND id=?").run(JSON.stringify(a),namespaceKey(n),a.view.id);
      }
    }
  }
}
