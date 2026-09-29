import { AppError } from "../../shared/src/index";
import type { RegisteredTool } from "./tool-registry";
export function enforceToolPolicy(tool: RegisteredTool) {
  if (tool.risk !== "read_only")
    throw new AppError(
      "PERMISSION_DENIED",
      "此工具需要明确授权，当前版本不允许执行",
    );
}
