import { z } from "zod";
const id=z.string().min(1).max(512),session=z.strictObject({sessionId:id});
export const featureInputs={
  "attachments:pick":session,
  "attachments:import":z.strictObject({sessionId:id,paths:z.array(z.string().min(1).max(8192).refine(p=>!/[\x00-\x1f]/.test(p))).min(1).max(16)}),
  "attachments:list":session,
  "attachments:remove":z.strictObject({id}),
};
