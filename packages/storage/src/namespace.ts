/** Provides the namespace module for the desktop application. */
import { namespaceSchema, type Namespace } from '../../shared/src/index';
/** Performs namespace Key for this module. */
export function namespaceKey(namespace: Namespace) {
  const n = namespaceSchema.parse(namespace);
  return JSON.stringify([n.instanceId, n.accountId, n.teamId]);
}
