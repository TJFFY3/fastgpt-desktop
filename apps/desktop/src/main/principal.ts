/** Provides the principal module for the desktop application. */
import { namespaceSchema, type Namespace } from '../../../../packages/shared/src/index';
/** Coordinates principal Service responsibilities for this module. */
export class PrincipalService {
  private namespace: Namespace = Object.freeze({
    instanceId: 'local',
    accountId: 'local-user',
    teamId: 'personal',
  });
  constructor(private revoke: (namespace: Namespace) => Promise<void>) {}
  /** Handles current within this module's workflow. */
  current() {
    return this.namespace;
  }
  /** Handles switch To within this module's workflow. */
  async switchTo(namespace: Namespace) {
    const value = namespaceSchema.parse(namespace);
    await this.revoke(this.namespace);
    this.namespace = Object.freeze(value);
  }
}
