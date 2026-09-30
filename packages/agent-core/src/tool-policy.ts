/** Coordinates agent execution, tool registration, and policy enforcement. */
/* 中文：协调智能体执行、工具注册和工具使用策略校验。 */
import { AppError } from '../../shared/src/index';
import type { RegisteredTool } from './tool-registry';
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function enforceToolPolicy(tool: RegisteredTool) {
  if (tool.risk !== 'read_only')
    throw new AppError('PERMISSION_DENIED', '此工具需要明确授权，当前版本不允许执行');
}
