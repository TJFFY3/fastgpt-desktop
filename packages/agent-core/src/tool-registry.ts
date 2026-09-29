/** Provides the tool registry module for the desktop application. */
import { AppError, type ToolContext, type ToolResult, type ToolSpec } from '../../shared/src/index';
/** Describes the registered Tool contract used by this module. */
export interface RegisteredTool {
  spec: ToolSpec;
  risk: 'read_only' | 'mutating';
  validate(value: unknown): Record<string, unknown>;
  execute(
    args: Record<string, unknown>,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<ToolResult>;
}
/** Coordinates tool Registry responsibilities for this module. */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  /** Handles register within this module's workflow. */
  register(tool: RegisteredTool) {
    if (this.tools.has(tool.spec.name)) throw new AppError('INVALID_INPUT', '工具名称已存在');
    this.tools.set(tool.spec.name, tool);
  }
  /** Handles definitions within this module's workflow. */
  definitions() {
    return [...this.tools.values()].map((t) => t.spec);
  }
  /** Handles get within this module's workflow. */
  get(name: string) {
    return this.tools.get(name);
  }
}
