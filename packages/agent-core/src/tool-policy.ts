/** Coordinates agent execution, tool registration, and policy enforcement. */
import { AppError } from '../../shared/src/index';
import type { RegisteredTool } from './tool-registry';
/** Validates or normalizes untrusted input before it crosses this module boundary. */
export function enforceToolPolicy(tool: RegisteredTool) {
  if (tool.risk !== 'read_only')
    throw new AppError('PERMISSION_DENIED', '此工具需要明确授权，当前版本不允许执行');
}
