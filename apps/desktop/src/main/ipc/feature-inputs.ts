import { z } from "zod";
const id=z.string().min(1).max(512),session=z.strictObject({sessionId:id});
export const attachmentInputs={
  "attachments:pick":session,
  "attachments:import":z.strictObject({sessionId:id,paths:z.array(z.string().min(1).max(8192).refine(p=>!/[\x00-\x1f]/.test(p))).min(1).max(16)}),
  "attachments:list":session,
  "attachments:remove":z.strictObject({id}),
};
export const workspaceInputs={
  "workspaces:ensure":session,"workspaces:preview":session,
  "workspaces:import":z.strictObject({sessionId:id,grantId:z.string().uuid()}),
  "workspaces:list":z.strictObject({sessionId:id,cursor:z.string().min(1).max(512).optional()}),
  "workspaces:read":z.strictObject({sessionId:id,path:z.string().min(1).max(1024),offset:z.number().int().nonnegative(),maxBytes:z.number().int().min(4).max(65536)}),
  "workspaces:diff":session,
};
export const featureInputs={...attachmentInputs,...workspaceInputs};
