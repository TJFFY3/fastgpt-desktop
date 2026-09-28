import { z } from "zod";
import {
  AppError,
  throwIfAborted,
  type ToolCall,
  type ToolContext,
  type ToolExecutor,
  type ToolResult,
} from "../../../../packages/shared/src/index";
import {
  ToolRegistry,
  enforceToolPolicy,
} from "../../../../packages/agent-core/src/index";
import type { RunRepository } from "../../../../packages/storage/src/index";
export function createBuiltinTools() {
  const registry = new ToolRegistry(),
    args = z.strictObject({ timezone: z.string().max(128).optional() });
  registry.register({
    spec: {
      name: "get_current_time",
      description:
        "获取指定 IANA 时区的当前日期与时间，不读取文件、不运行命令。",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA 时区，例如 Asia/Shanghai；默认为 UTC",
          },
        },
        additionalProperties: false,
      },
    },
    risk: "read_only",
    validate: (value) => {
      const result = args.safeParse(value);
      if (!result.success)
        throw new AppError("INVALID_INPUT", "时间工具参数无效");
      try {
        new Intl.DateTimeFormat("zh-CN", {
          timeZone: result.data.timezone ?? "UTC",
        });
      } catch {
        throw new AppError("INVALID_INPUT", "无效的 IANA 时区");
      }
      return result.data;
    },
    execute: async (value) => ({
      content: JSON.stringify({
        timezone: value.timezone ?? "UTC",
        time: new Intl.DateTimeFormat("zh-CN", {
          timeZone: (value.timezone as string) ?? "UTC",
          dateStyle: "full",
          timeStyle: "long",
        }).format(new Date()),
      }),
      isError: false,
    }),
  });
  return registry;
}
export class ToolGateway implements ToolExecutor {
  constructor(
    private runs: RunRepository,
    private registry: ToolRegistry,
  ) {}
  async execute(
    call: ToolCall,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    throwIfAborted(signal);
    const tool = this.registry.get(call.name);
    if (!tool) throw new AppError("PERMISSION_DENIED", "工具未注册");
    enforceToolPolicy(tool);
    let value: unknown;
    try {
      value = JSON.parse(call.arguments);
    } catch {
      throw new AppError("INVALID_INPUT", "工具参数不是有效 JSON");
    }
    const args = tool.validate(value);
    throwIfAborted(signal);
    const reservation = this.runs.reserveToolCall(
      context.namespace,
      context.runId,
      call,
    );
    if (reservation === "completed")
      return this.runs.toolResult(context.namespace, context.runId, call.id)!;
    if (reservation === "unresolved")
      throw new AppError(
        "TOOL_UNRESOLVED",
        "工具之前的执行结果未知，已阻止自动重复执行",
      );
    let result = await tool.execute(args, context, signal);
    if (Buffer.byteLength(result.content) > 1024 * 1024)
      result = {
        content: "工具结果超过 1 MiB 限制，已拒绝返回。",
        isError: true,
      };
    this.runs.completeToolCall(
      context.namespace,
      context.runId,
      call.id,
      result,
    );
    return result;
  }
}
