import { AppError, attachmentRecordSchema, type AttachmentRecord, type Namespace } from "../../shared/src/index";
import type { Database } from "./database";
import type { SessionRepository } from "./session-repository";
import { namespaceKey } from "./namespace";
export class AttachmentRepository {
  constructor(private db:Database,private sessions:SessionRepository) {}
  list(n:Namespace,sid:string):AttachmentRecord[] {
    this.sessions.get(n,sid);
    return this.db.raw.prepare("SELECT data FROM attachments WHERE namespace_key=? AND session_id=? ORDER BY rowid").all(namespaceKey(n),sid).map(r=>attachmentRecordSchema.parse(JSON.parse(r.data as string)));
  }
  get(n:Namespace,id:string):AttachmentRecord {
    const r=this.db.raw.prepare("SELECT data FROM attachments WHERE namespace_key=? AND id=?").get(namespaceKey(n),id);
    if(!r) throw new AppError("NOT_FOUND","附件不存在");
    return attachmentRecordSchema.parse(JSON.parse(r.data as string));
  }
  insert(n:Namespace,record:AttachmentRecord):void {
    const a=attachmentRecordSchema.parse(record);this.sessions.get(n,a.sessionId);
    this.db.raw.prepare("INSERT INTO attachments(namespace_key,id,session_id,data) VALUES(?,?,?,?)").run(namespaceKey(n),a.id,a.sessionId,JSON.stringify(a));
  }
  markSent(n:Namespace,ids:string[],messageId:string):void {
    this.db.transaction(()=>{
      const key=namespaceKey(n),message=this.db.raw.prepare("SELECT session_id FROM messages WHERE namespace_key=? AND id=?").get(key,messageId);
      if(!message) throw new AppError("NOT_FOUND","消息不存在");
      if(new Set(ids).size!==ids.length || ids.length>16) throw new AppError("INVALID_INPUT","附件编号无效");
      for(const id of ids) {
        const a=this.get(n,id);
        if(a.sessionId!==message.session_id) throw new AppError("NOT_FOUND","附件不属于此会话");
        if(a.state!=="ready") throw new AppError("INVALID_INPUT","附件已经发送");
        this.db.raw.prepare("UPDATE attachments SET data=? WHERE namespace_key=? AND id=?").run(JSON.stringify({...a,state:"sent"}),key,id);
        this.db.raw.prepare("INSERT INTO message_attachments(namespace_key,message_id,attachment_id) VALUES(?,?,?)").run(key,messageId,id);
      }
    });
  }
  removeDraft(n:Namespace,id:string):void {
    const a=this.get(n,id);
    if(a.state!=="ready") throw new AppError("INVALID_INPUT","已发送附件不能作为草稿移除");
    this.db.raw.prepare("DELETE FROM attachments WHERE namespace_key=? AND id=?").run(namespaceKey(n),id);
  }
}
