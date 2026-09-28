import {
  namespaceSchema,
  type Namespace,
} from "../../../../packages/shared/src/index";
export class PrincipalService {
  private namespace: Namespace = Object.freeze({
    instanceId: "local",
    accountId: "local-user",
    teamId: "personal",
  });
  constructor(private revoke: (namespace: Namespace) => Promise<void>) {}
  current() {
    return this.namespace;
  }
  async switchTo(namespace: Namespace) {
    const value = namespaceSchema.parse(namespace);
    await this.revoke(this.namespace);
    this.namespace = Object.freeze(value);
  }
}
