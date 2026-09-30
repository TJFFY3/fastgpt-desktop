/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import { namespaceSchema, type Namespace } from '../../shared/src/index';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function namespaceKey(namespace: Namespace) {
  const n = namespaceSchema.parse(namespace);
  return JSON.stringify([n.instanceId, n.accountId, n.teamId]);
}
