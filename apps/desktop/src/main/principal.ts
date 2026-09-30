/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
import { namespaceSchema, type Namespace } from '../../../../packages/shared/src/index';
/** Owns the module boundary represented by principal Service and coordinates its collaborators. */
/* 中文：管理当前进程的身份及数据访问命名空间。 */
export class PrincipalService {
  private namespace: Namespace = Object.freeze({
    instanceId: 'local',
    accountId: 'local-user',
    teamId: 'personal',
  });
  constructor(private revoke: (namespace: Namespace) => Promise<void>) {}
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  current() {
    return this.namespace;
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  async switchTo(namespace: Namespace) {
    const value = namespaceSchema.parse(namespace);
    await this.revoke(this.namespace);
    this.namespace = Object.freeze(value);
  }
}
