import type {
  RunEvent,
  RunStatus,
} from "../../../../../packages/shared/src/index";
export const statusLabel: Record<RunStatus, string> = {
  queued: "等待运行",
  running: "运行中",
  waiting_approval: "等待授权",
  waiting_input: "等待输入",
  cancelling: "停止中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "执行失败",
  interrupted: "已中断",
};
export function RunDetails({
  status,
  events,
}: {
  status: RunStatus | null;
  events: RunEvent[];
}) {
  const calls = events.filter((e) => e.type === "tool_started");
  return (
    <div className="run-details">
      {status && (
        <span className={`run-status ${status}`} data-testid="run-status">
          <i />
          {statusLabel[status]}
        </span>
      )}
      {status === "interrupted" && <span>上次运行意外退出，未自动重试。</span>}
      {calls.map((e) => {
        const result = events.find(
          (v) => v.type === "tool_finished" && v.id === e.call.id,
        );
        return (
          <details className="tool-detail" key={e.seq}>
            <summary>
              <code>{e.call.name}</code>
              <span>
                {result?.type === "tool_finished"
                  ? result.result.isError
                    ? "失败"
                    : "完成"
                  : status === "running"
                    ? "执行中"
                    : "结果未知"}
              </span>
            </summary>
            <pre>{e.call.arguments}</pre>
            {result?.type === "tool_finished" && (
              <pre>{result.result.content}</pre>
            )}
          </details>
        );
      })}
    </div>
  );
}
