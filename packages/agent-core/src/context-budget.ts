import { AppError, type ModelProfile, type ChatMessage, type ToolSpec } from "../../shared/src/index";
/** Conservative local estimate, not a universal upper bound for third-party tokenizers. */
export function assertContextBudget(profile:ModelProfile,messages:ChatMessage[],tools:ToolSpec[]):void {
  const bytes=new TextEncoder().encode(JSON.stringify({messages,tools})).byteLength;
  const overhead=256+messages.length*32+tools.length*128;
  const margin=Math.max(1024,Math.ceil(profile.contextWindow*0.05));
  if(bytes+overhead+margin+profile.maxOutputTokens>profile.contextWindow)
    throw new AppError("CONTEXT_TOO_LARGE","完整上下文超出预算，请缩小附件或输入、新建会话，或选择更大上下文模型");
}
