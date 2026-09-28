import { namespaceSchema, type Namespace } from '../../shared/src/index';
export function namespaceKey(namespace: Namespace) { const n = namespaceSchema.parse(namespace); return JSON.stringify([n.instanceId, n.accountId, n.teamId]); }
