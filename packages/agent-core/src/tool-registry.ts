/** Coordinates agent execution, tool registration, and policy enforcement. */
/* 中文：协调智能体执行、工具注册和工具使用策略校验。 */
import { AppError, type ToolContext, type ToolResult, type ToolSpec } from '../../shared/src/index';
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
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
/* 中文：注册工具定义并提供工具查找及执行入口。 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  /** Initializes the module operation and connects it to its required lifecycle dependencies. */
  /* 中文：初始化模块操作，并连接执行所需的生命周期依赖。 */
  register(tool: RegisteredTool) {
    if (this.tools.has(tool.spec.name)) throw new AppError('INVALID_INPUT', '工具名称已存在');
    this.tools.set(tool.spec.name, tool);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  definitions() {
    return [...this.tools.values()].map((t) => t.spec);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  get(name: string) {
    return this.tools.get(name);
  }
}
