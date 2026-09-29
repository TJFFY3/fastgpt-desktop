/** Provides the tool policy module for the desktop application. */
import { AppError } from '../../shared/src/index';
import type { RegisteredTool } from './tool-registry';
/** Performs enforce Tool Policy for this module. */
export function enforceToolPolicy(tool: RegisteredTool) {
  if (tool.risk !== 'read_only')
    throw new AppError('PERMISSION_DENIED', '此工具需要明确授权，当前版本不允许执行');
}
