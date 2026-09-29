import type { ApprovalDecision, RunEvent, RunRecord } from "../../../../../packages/shared/src/index";
import { useRunTimer } from "../hooks/useRunTimer";
import { statusLabel } from "./RunDetails";
import { ApprovalCard } from "./ApprovalCard";
import { useCommandTimer } from "../hooks/useCommandTimer";
function CommandTrace({runId,start,done,output,terminal}:{runId:string;start:Extract<RunEvent,{type:"command_started"}>;done?:Extract<RunEvent,{type:"command_finished"}>;output:RunEvent[];terminal:boolean}){const elapsed=useCommandTimer(runId,start.id,terminal,done?.elapsedMs);return <section className="trace-command"><div>命令 · {start.cwd}</div><pre>{start.command}</pre><pre data-testid="command-output">{output.map(v=>v.type==="command_output"?v.text:"").join("")}</pre><small data-testid="command-elapsed">{done?`退出码 ${done.exitCode??"未知"} · ${formatDuration(elapsed)} · ${done.reason}${done.truncated?" · 输出已截断":""}`:terminal?`已中断 / 结果未知 · ${formatDuration(elapsed)}`:`执行中 · ${formatDuration(elapsed)}`}</small></section>;}
export function formatDuration(ms:number):string {
  const seconds=Math.max(0,Math.floor(ms/1000));return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
}
export function RunTrace({run,events,latest=false,onOpen,onDecide}:{run:RunRecord;events:RunEvent[];latest?:boolean;onOpen?():void;onDecide?(id:string,decision:ApprovalDecision):Promise<void>}) {
  const status=events.flatMap(e=>e.type==="status"?[e.status]:[]).at(-1) ?? run.status;
  const elapsed=useRunTimer({...run,status});
  const reasoning=events.flatMap(e=>e.type==="reasoning_delta"?[e.text]:[]).join("");
  const steps=new Set(events.flatMap(e=>e.type==="tool_started"?[e.call.id]:e.type==="command_started"?[e.id]:[])).size;
  return <details className="run-trace" data-run-id={run.id} open={latest || undefined} onToggle={e=>{if(e.currentTarget.open) onOpen?.();}}>
    <summary><span>执行过程</span><span className={`run-status ${status}`} data-testid={latest?"run-status":`run-status-${run.id}`}>{statusLabel[status]}</span><span data-testid="run-elapsed">总耗时 {formatDuration(elapsed)}</span><span>{steps} 步</span></summary>
    <div className="trace-model">{run.modelSnapshot?`${run.modelSnapshot.name} · ${run.modelSnapshot.modelId}`:"旧记录未保存模型快照/运行关联"}</div>
    {reasoning?<details className="trace-reasoning"><summary>模型公开思考（服务返回）</summary><pre>{reasoning}</pre>{events.some(e=>e.type==="reasoning_truncated")&&<p>超过 1 MiB，公开思考已截断；最终回答不受影响。</p>}</details>:status==="running"?<p className="trace-hint">模型处理中</p>:null}
    {events.map(e=>{
      if(e.type==="tool_started") {
        const done=events.find(v=>v.type==="tool_finished"&&v.id===e.call.id);
        return <details className="trace-step" key={e.seq}><summary><code>{e.call.name}</code><span>{done?.type==="tool_finished"?(done.result.isError?"失败":"完成"):["queued","running","waiting_approval","waiting_input","cancelling"].includes(status)?"处理中":"已中断 / 结果未知"}</span></summary><pre>{e.call.arguments}</pre>{done?.type==="tool_finished"&&<pre>{done.result.content}</pre>}</details>;
      }
      if(e.type==="command_started") {
        const done=events.find(v=>v.type==="command_finished"&&v.id===e.id),output=events.filter(v=>v.type==="command_output"&&v.id===e.id);
        return <CommandTrace key={e.seq} runId={run.id} start={e} done={done?.type==="command_finished"?done:undefined} output={output} terminal={!["running","waiting_approval","cancelling"].includes(status)}/>;
      }
      if(e.type==="approval_requested") {
        const decision=events.find(v=>v.type==="approval_decided"&&v.approvalId===e.approval.id);
        return <ApprovalCard key={e.seq} approval={e.approval} decision={decision?.type==="approval_decided"?decision.decision:undefined} active={status==="waiting_approval"} onDecide={onDecide}/>;
      }
      if(e.type==="error") return <p className="trace-error" key={e.seq}>{e.code}：{e.message}</p>;
      if(e.type==="workspace_checkpoint") return <p className="trace-hint" key={e.seq}>工作区检查点已保存 · 版本 {e.revision}</p>;
      return null;
    })}
    {status==="interrupted"&&<p className="trace-hint">上次运行意外退出，未自动重试。</p>}
  </details>;
}
