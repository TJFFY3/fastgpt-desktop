import {
  AppError,
  type ToolContext,
  type ToolResult,
  type ToolSpec,
  type ApprovalRequestView,
  type ToolCall,
} from "../../shared/src/index";
export interface RegisteredTool {
  spec: ToolSpec;
  risk: "read_only" | "mutating";
  approval?(args:Record<string,unknown>,context:ToolContext):ApprovalRequestView;
  validate(value: unknown): Record<string, unknown>;
  execute(
    args: Record<string, unknown>,
    context: ToolContext,
    signal: AbortSignal,
    call?:ToolCall,
  ): Promise<ToolResult>;
}
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  register(tool: RegisteredTool) {
    if (this.tools.has(tool.spec.name))
      throw new AppError("INVALID_INPUT", "工具名称已存在");
    this.tools.set(tool.spec.name, tool);
  }
  definitions() {
    return [...this.tools.values()].map((t) => t.spec);
  }
  get(name: string) {
    return this.tools.get(name);
  }
}
