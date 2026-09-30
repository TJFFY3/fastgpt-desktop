/** Contracts for permission-scoped FastGPT resource catalogs. */
/* 中文：定义 FastGPT 连接状态和经过服务端授权的资源列表，不向界面返回密钥。 */
export type FastGptConnection = {
  baseUrl: string;
  credentialState: 'persistent' | 'session_only' | 'missing';
};
/* 中文：只传递展示需要的元数据，不暴露完整模型配置或其他成员信息。 */
export type FastGptResource = {
  id: string;
  name: string;
  intro: string;
  type: string;
  folder: boolean;
};
export type FastGptCatalogQuery = {
  kind: 'agents' | 'knowledge';
  parentId?: string | null;
  searchKey?: string;
  offset?: number;
};
