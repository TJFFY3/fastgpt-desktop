/** Implements an Electron main-process service or integration boundary. */
import { namespaceSchema, type Namespace } from '../../../../packages/shared/src/index';
/** Owns the module boundary represented by principal Service and coordinates its collaborators. */
export class PrincipalService {
  private namespace: Namespace = Object.freeze({
    instanceId: 'local',
    accountId: 'local-user',
    teamId: 'personal',
  });
  constructor(private revoke: (namespace: Namespace) => Promise<void>) {}
  /** Implements one focused part of this module’s public responsibility. */
  current() {
    return this.namespace;
  }
  /** Implements one focused part of this module’s public responsibility. */
  async switchTo(namespace: Namespace) {
    const value = namespaceSchema.parse(namespace);
    await this.revoke(this.namespace);
    this.namespace = Object.freeze(value);
  }
}
