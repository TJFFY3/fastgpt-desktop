/** Coordinates agent execution, tool registration, and policy enforcement. */
import { AppError, type ToolContext, type ToolResult, type ToolSpec } from '../../shared/src/index';
/** Specifies the contract callers must satisfy at this module boundary. */
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
/** Owns the module boundary represented by tool Registry and coordinates its collaborators. */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  /** Initializes the module operation and connects it to its required lifecycle dependencies. */
  register(tool: RegisteredTool) {
    if (this.tools.has(tool.spec.name)) throw new AppError('INVALID_INPUT', '工具名称已存在');
    this.tools.set(tool.spec.name, tool);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  definitions() {
    return [...this.tools.values()].map((t) => t.spec);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  get(name: string) {
    return this.tools.get(name);
  }
}
