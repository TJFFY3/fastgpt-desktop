# FastGPT Desktop Agent — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可启动的桌面 Agent，支持配置 OpenAI 兼容模型、流式对话、受控工具调用、Session 管理、取消和重启恢复，完成设计阶段 A。

**Architecture:** React 界面通过受限 preload 访问主进程业务服务。主进程拥有 SQLite、身份命名空间、凭据和工具授权，可信 utility process 运行独立 Agent 核心；所有运行事件先持久化再发送给界面。FastGPT、记忆、Docker 和 Skill 后续通过已有边界接入，不在本阶段提供伪实现。

**Tech Stack:** npm workspaces、Electron 44.4.5、electron-vite 5.0.0、Vite 7.3.6、@vitejs/plugin-react 5.2.0、React/React DOM 19.3.0、TypeScript 5.9.3、Zod 4.6.5、Vitest 5.0.2、Playwright 1.63.0、electron-builder 26.15.3；SQLite 使用内置 `node:sqlite`。

**Spec:** [已确认架构设计](../specs/2026-09-28-fastgpt-desktop-agent-design.md)，重点为 3、4.1、4.2、5、6.A 和 7 中需求 1/2。

## Global Constraints

- 桌面技术栈采用 Electron + React + TypeScript。
- 同时对接 FastGPT 社区版和商业版。
- 首版采用本地 Docker 沙箱执行 Agent 代码和 Skill 脚本。
- 默认会话与记忆本地持久化，首版不包含跨设备同步。
- Agent 编排进程只用于稳定性和职责隔离，不能当作恶意脚本的安全沙箱。
- 密钥放入操作系统安全存储；无法使用安全存储时允许仅本次运行使用，不自动降级为明文持久化。界面只显示脱敏信息。
- 首版每个 Session 只允许一个活动 Run；不同 Session 可以并行，避免同一会话消息顺序冲突。
- 保存运行事件和工具结果；崩溃后未结束的 Run 标记为 interrupted，禁止自动重放有副作用的操作。
- 身份命名空间和授权接口从阶段 A 就进入数据与工具设计。
- C 的脚本能力在沙箱未通过验证时不可启用。
- 协议和隔离测试可使用受控模拟服务，但真实模型、两版 FastGPT、SSO 与目标操作系统必须分别联调；模拟通过不能替代这些验收。

阶段 A 只交付需求 1/2 和其必要的公共边界；B–F 保留在架构路线中，不能在 A 的交付说明中宣称完成。首版唯一内置工具为只读 `get_current_time`，没有宿主机 shell、文件执行、Docker 或 Skill 脚本工具。

## Review Focus

1. SSE 的 UTF-8、JSON、工具参数跨块，多个 tool index 交错、正常 EOF 与不完整工具调用：解析完整后才允许执行（Task 3/5）。
2. 页面导航、子 frame 和伪造 IPC 参数试图提升权限：来源和 schema 检查失败即拒绝，界面不能选择可信身份（Task 1/6）。
3. 同一模型服务对请求体参数和流格式支持不同：手动配置能力、无工具模式、401/429、超时和取消必须可用（Task 3/4）。
4. 运行取消、worker 崩溃或重复 toolCallId 导致执行重复：保存调用状态，不重放副作用，取消后不调度新工具（Task 2/5/8）。
5. 系统凭据存储暂时不可用或 Linux 使用 basic_text：只在内存存储，重启要求重填密钥，日志与 IPC 不回传原始凭据（Task 4/6/8）。

---

## 已核对环境与依赖决策

- 当前目录原先没有 Git 仓库、代码或既有依赖；已有设计文档需保留。执行阶段先检查状态，再初始化本地仓库，不创建远程仓库、不推送。
- 开发 Node 为 22.23.2；最低开发版本定为 22.12.0。Electron 44.4.5 内置 Node 24.21.0，依据 [官方发布页](https://releases.electronjs.org/release/v44.4.5)。
- 本机 `node:sqlite` 内存查询已验证可用；Node 22 会显示 ExperimentalWarning。存储只使用 Node 22 与 Electron 内置 Node 24 共有的 DatabaseSync/StatementSync API，必须在真实 Electron 进程验证导入与重启持久化。
- electron-vite 5.0.0 的 peerDependencies 只覆盖 Vite 5/6/7，因此固定 Vite 7.3.6，不使用 Vite 8；React 插件固定 5.2.0。上述版本已通过 npm 元数据检查，实施时使用精确版本并提交 package-lock.json。
- Docker Desktop 的 Linux ARM64 Engine 已响应版本请求，后续 C 阶段可进行真实隔离测试；A 阶段不创建容器或拉取镜像。
- 使用 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 包装安全凭据后端，显式拒绝 basic_text。使用 [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) 运行可信编排代码，不加载用户脚本。

## 文件与数据结构

```text
apps/desktop/
  electron.vite.config.ts
  src/main/                 应用启动、安全配置、IPC、凭据、业务服务
  src/preload/index.ts      仅暴露 DesktopApi
  src/worker/index.ts       Agent utility process 入口和 RPC
  src/renderer/             中文会话界面和模型设置
packages/shared/src/       类型、Zod schemas、错误、worker 协议
packages/storage/src/      SQLite schema、迁移、参数化仓储
packages/model-adapter/src/ SSE 解析和 Chat Completions 请求
packages/agent-core/src/    工具注册/策略、AgentRunner
tests/fixtures/            可控模型服务与通用测试数据
tests/e2e/                 真实 Electron 测试
```

SQLite 由主进程单一写入者持有。阶段 A 建表 `providers`、`credentials`（仅密文）、`sessions`、`messages`、`runs`、`run_events`、`tool_calls`、`schema_migrations`。所有业务表包含 namespaceKey；session/message/run 外键关系与唯一索引必须约束同一命名空间。每个 Run 的事件 seq 单调递增，每个 Session 的消息 seq 单调递增。

## Task 1: 工程基础与可信数据契约

**Files:** Create `package.json`、`package-lock.json`、`.gitignore`、`tsconfig.base.json`、`tsconfig.json`、`vitest.config.ts`、`apps/desktop/package.json`、四个 `packages/*/package.json`、`packages/shared/src/{types,schemas,errors,worker-protocol,index}.ts`、`packages/shared/tests/schemas.test.ts`、`tests/fixtures/data.ts`。

**Interfaces:** 此任务定义所有后续任务共用类型；共享包不引入 Electron、数据库或任何凭据实现。

- `Namespace = { instanceId: string; accountId: string; teamId: string }`，可信本地值为三项均 `local`。
- `ModelCapabilities = { tools: boolean; temperature: boolean; outputTokenField: 'max_tokens' | 'max_completion_tokens' }`。
- `ProviderDraft = { name, baseUrl, modelId: string; contextWindow, maxOutputTokens, timeoutMs: number; allowInsecureHttp:boolean; capabilities: ModelCapabilities }`；`ModelProfile` 增加 `id: string` 和 `credentialRef: string | null`。界面 DTO `ProviderView` 去掉 credentialRef，增加 `credentialState: 'persistent' | 'session_only' | 'missing'`。
- `ToolCall = { id, name, arguments: string }`；`ToolSpec = { name, description: string; parameters: Record<string, unknown> }`；`ToolResult = { content: string; isError: boolean }`。
- `ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; toolCalls?: ToolCall[]; toolCallId?: string }`。
- `SessionDraft = { title: string; providerId: string }`；`SessionPatch = { title?: string; pinned?: boolean; archived?: boolean }`；`SessionFilter = { query?: string; archived?: boolean }`；`SessionRecord` 增加 id、namespaceKey、createdAt、updatedAt 和默认 false 的 pinned/archived。
- `MessageRecord` 为 ChatMessage 加 id、sessionId、seq、status（complete/partial/interrupted）、createdAt。
- `RunStatus` 使用 spec 4.2 的完整枚举；`RunRecord = { id, sessionId: string; status: RunStatus; errorCode: string | null; createdAt, updatedAt: number }`。
- `ModelEvent` 为 discriminated union：`text_delta {text}`、`tool_call_delta {index,id?,name?,argumentsDelta?}`、`usage {inputTokens?,outputTokens?}`、`finish {reason}`。
- `AgentEvent` 为 union：`status {status}`、`text_delta {text}`、`assistant_message {message:ChatMessage}`、`tool_started {call:ToolCall}`、`tool_finished {id,result:ToolResult}`、`error {code,message}`。`RunEvent` 增加 runId、sessionId、seq、createdAt；不向界面发送 namespaceKey 或凭据。
- `RunInput = { runId,sessionId: string; namespace:Namespace; profile:ModelProfile; messages:ChatMessage[]; tools:ToolSpec[] }`；密钥不属于该可持久化结构。
- `AppError` 包含安全 code/message/retryable；错误码至少有 INVALID_INPUT、NOT_FOUND、FORBIDDEN、RUN_ACTIVE、ABORTED、TIMEOUT、AUTH_FAILED、RATE_LIMITED、MODEL_PROTOCOL_ERROR、TOOLS_UNSUPPORTED、CREDENTIAL_REQUIRED、WORKER_EXITED。
- `WorkerCommand` 为 start/cancel/tool_result/shutdown，start 含 RunInput 和内存 apiKey；`WorkerReply` 为 event/tool_request/ready。双方按当前 worker 绑定的 runId 校验，不允许任意指定另一个 Run。

- [ ] **Step 1 — 执行前检查：** 检查有无新文件和 Git 状态；仍为非 Git 目录时 `git init -b main`，只提交已确认 spec 和本计划。之后创建 npm workspace 与上述精确依赖；`node:sqlite` 保持外置内置模块，不增加 SQLite 原生 npm 扩展。
- [ ] **Step 2 — 写安全契约测试：** `schemas.test.ts` 断言空 name/modelId、负 timeout、maxOutputTokens >= contextWindow、extra namespace 字段、未知 worker 指令、缺少 toolCallId 的 tool 消息均被拒绝；schema 使用 strict object。

```ts
expect(providerDraftSchema.safeParse({ ...validDraft, maxOutputTokens: validDraft.contextWindow }).success).toBe(false);
expect(sendMessageSchema.safeParse({ sessionId: 's1', text: '你好', namespace: namespaceB }).success).toBe(false);
expect(workerCommandSchema.safeParse({ type: 'exec_shell', command: 'id' }).success).toBe(false);
```

- [ ] **Step 3 — 验证失败：** `npm test -- packages/shared/tests/schemas.test.ts`，预期契约未实现导致失败。
- [ ] **Step 4 — 实现并配置：** 定义上述类型和 schemas、安全错误 DTO；配置根脚本 test/typecheck/build/dev/test:e2e/package:dir。根 tsconfig 覆盖 packages 和 desktop 的 ts/tsx 源码，使用 strict/noEmit、ES2022、ESNext/Bundler；未开始的包不建立会因空 src 报错的独立编译项目。Provider 输入默认 contextWindow=32768、maxOutputTokens=4096、timeoutMs=120000、allowInsecureHttp=false、tools=false、temperature=false、outputTokenField=max_tokens，用户可显式修改。测试数据中的 namespaceA/B 不使用相同分隔字符串编码。
- [ ] **Step 5 — 验证与提交：** 上述测试及 `npm run typecheck` 通过；仅提交本任务文件，消息 `chore: bootstrap desktop agent workspace and contracts`。

## Task 2: SQLite 会话、配置与运行仓储

**Files:** Create `packages/storage/src/{database,migrations,namespace,credential-repository,provider-repository,session-repository,run-repository,index}.ts`、`packages/storage/tests/{sessions,runs,providers}.test.ts`。

**Interfaces:**

- `namespaceKey(namespace: Namespace): string` 使用 JSON 编码三项组成的数组，避免分隔符碰撞。
- `openStore(path: string): Store`；`Store = {providers:ProviderRepository;sessions:SessionRepository;runs:RunRepository;credentials:CredentialRepository;close():void}`。生产数据库路径由主进程从 app.getPath('userData') 构造，renderer 不可传入。
- `CredentialRepository.put(ns:Namespace,ref:string,ciphertext:Uint8Array):void`、`get(ns:Namespace,ref:string):Uint8Array|null`、`remove(ns:Namespace,ref:string):void`；只处理密文，不调用 Electron API。
- `ProviderRepository.save(ns:Namespace, draft:ProviderDraft, credentialRef:string|null, id?:string): ModelProfile`、`get(ns,id)`、`list(ns)`、`remove(ns,id)`。
- `SessionRepository.create(ns:Namespace,draft:SessionDraft):SessionRecord`、`list(ns,filter:SessionFilter):SessionRecord[]`、`get(ns,id)`、`update(ns,id,patch:SessionPatch)`、`remove(ns,id):void`、`messages(ns,id):MessageRecord[]`、`appendMessage(ns,id,message:ChatMessage,status:MessageRecord['status']):MessageRecord`。
- `RunRepository.createWithUserMessage(ns,sessionId,text:string):RunRecord` 原子写入消息与 queued Run；`get(ns,runId):RunRecord`、`list(ns,sessionId):RunRecord[]`、`transition(ns,runId,status,errorCode?:string):void`、`appendEvent(ns,runId,event:AgentEvent):RunEvent`、`events(ns,runId,afterSeq:number):RunEvent[]`、`recoverInterrupted():number`。
- `reserveToolCall(ns,runId,call:ToolCall): 'reserved'|'completed'|'unresolved'`、`toolResult(ns,runId,callId):ToolResult|null`、`completeToolCall(ns,runId,callId,result:ToolResult):void`；重复 ID 的不同参数返回 MODEL_PROTOCOL_ERROR；不允许自动重复执行 unresolved，completed 从已保存的结果返回。

- [ ] **Step 1 — 写仓储测试：** 临时目录建库，创建会话并 reopen 检查历史；跨 namespace 的 get/update/remove 拒绝；消息排序和事件 seq 唯一；同会话第二个活动 Run 返回 RUN_ACTIVE；启动恢复将所有活动状态变为 interrupted，取消/完成状态保持原值。

```ts
expect(store.sessions.messages(namespaceA, session.id).map(m => m.content)).toEqual(['你好', '你好，我是助手']);
expect(() => store.sessions.get(namespaceB, session.id)).toThrowError(/NOT_FOUND/);
expect(() => store.runs.createWithUserMessage(namespaceA, session.id, '第二次')).toThrowError(/RUN_ACTIVE/);
expect(store.runs.reserveToolCall(namespaceA, run.id, call)).toBe('unresolved'); // 已 reserved，再次申请
```

- [ ] **Step 2 — 验证失败：** `npm test -- packages/storage/tests`，预期仓储缺失导致失败。
- [ ] **Step 3 — 实现迁移与仓储：** 使用参数化 SQL、foreign_keys=ON、WAL、事务和活动 Run 的 partial unique index。删除活动会话须先由业务层取消并等待终态，仓储自行拒绝直接删除活动会话；删除已完成本地会话只级联其本地记录。未知 ID 和他人 ID 使用同一 NOT_FOUND。
- [ ] **Step 4 — 验证恢复边界：** 添加包含 SQL 特殊字符的 title/query/namespace 测试，以及事务中途失败不留下半条用户消息/Run 的测试；重复执行迁移不改变数据。Provider 不同 namespace 不串读，移除被会话引用的配置返回明确错误。
- [ ] **Step 5 — 验证与提交：** 存储测试及 typecheck 通过；消息 `feat: persist sessions and durable agent run records`。

## Task 3: OpenAI 兼容请求与 SSE 工具增量解析

**Files:** Create `packages/model-adapter/src/{endpoint,sse,chat-completions,errors,index}.ts`、`packages/model-adapter/tests/{sse,chat-completions}.test.ts`、`tests/fixtures/openai-server.ts`。

**Interfaces:** `normalizeChatEndpoint(baseUrl:string):URL`；`parseSse(body:ReadableStream<Uint8Array>,signal:AbortSignal):AsyncIterable<{event:string;data:string}>`；`ModelRequest = {profile:ModelProfile;apiKey:string;messages:ChatMessage[];tools:ToolSpec[];signal:AbortSignal}`；`ModelAdapter.stream(request:ModelRequest):AsyncIterable<ModelEvent>`、`probe(request:Omit<ModelRequest,'messages'|'tools'>):Promise<{reachable:boolean;tools:boolean|'unknown'}>`；`OpenAiChatAdapter` 实现 ModelAdapter。Probe 先用简单非流式文本请求验证连接；用户已启用 tools 时再用仅包含空参数的 `connection_probe` 定义验证 tool_calls，绝不执行 probe 工具。有效 tool_calls 返回 true，明确拒绝 tools 返回 false，没有调用或没有开启探测时返回 unknown。

- [ ] **Step 1 — 写协议测试：** fixture 服务监听随机 loopback 端口，覆盖标准非流式、SSE、CRLF、注释/空行、缺省 data-only event、[DONE]、多个 tool index、UTF-8/JSON 跨块、非 JSON 错误、401/429/503、超时、取消和不完整 EOF。

```ts
expect(textEvents.map(e => e.text).join('')).toBe('你好，世界');
expect(toolEvents.filter(e => e.index === 0).map(e => e.argumentsDelta ?? '').join('')).toBe('{"zone":"Asia/Shanghai"}');
expect(capturedBody).not.toHaveProperty('temperature'); // capabilities.temperature=false
expect(capturedBody).not.toHaveProperty('tools'); // capabilities.tools=false
expect(capturedBody.max_completion_tokens).toBe(profile.maxOutputTokens);
```

- [ ] **Step 2 — 验证失败：** `npm test -- packages/model-adapter/tests`，预期适配器缺失导致失败。
- [ ] **Step 3 — 实现端点与请求：** Base URL 表示 API 根，去掉尾斜线后追加 `/chat/completions`，不擅自插入 `/v1`；已填写完整 completions URL 则保持。仅允许 http/https，不允许 URL 内凭据、query 和 fragment。明文 HTTP 必须用户勾选针对该 origin 的 `allowInsecureHttp` 设置，测试 fixture 显式开启；禁止关闭 TLS 验证。
- [ ] **Step 4 — 实现解析和错误：** TextDecoder 流式解码，按完整 SSE 帧解析，不按网络块解析；将 SDK 形状映射为共享 ModelEvent。合并调用方取消与 timeout signal。只有尚未收到正文/工具增量时可对 429/503 最多重试 2 次，退避 250/500ms，尊重最多 5 秒的 Retry-After。不重试 401/协议错误/取消；错误 DTO 不包含原始响应正文、认证头或 apiKey。
- [ ] **Step 5 — 验证与提交：** 所有 fixture 测试通过，fake timer 验证退避与取消不真实等待；消息 `feat: add OpenAI-compatible streaming model adapter`。

## Task 4: 安全凭据与模型配置服务

**Files:** Create `apps/desktop/src/main/{credentials,provider-service}.ts`、`apps/desktop/tests/{credentials,providers}.test.ts`。

**Interfaces:** `SecretStore.put(secret:string,namespace:Namespace):Promise<{ref:string;state:'persistent'|'session_only'}>`、`get(ref,namespace):Promise<string|null>`、`status(ref,namespace):'persistent'|'session_only'|'missing'`、`remove(ref,namespace):Promise<void>`、`clearSessionOnly():void`；`SafeStorageBackend = {isAvailable():Promise<boolean>;isSecure():Promise<boolean>;encrypt(text:string):Promise<Uint8Array>;decrypt(data:Uint8Array):Promise<string>}` 作为可注入测试边界。SecretStore 持久部分仅通过 Task 2 的 CredentialRepository 保存密文。`ProviderService.save(ns,draft,apiKey?:string,id?:string):Promise<ProviderView>`、`list(ns):Promise<ProviderView[]>`、`test(ns,id):Promise<{reachable:boolean;tools:boolean|'unknown'}>`、`remove(ns,id):Promise<void>`、`resolve(ns,id):Promise<{profile:ModelProfile;apiKey:string}>`。

- [ ] **Step 1 — 写凭据测试：** 安全后端可用时数据库只出现密文；basic_text、未知后端、暂时不可用、加密失败时只进入内存；重启返回 missing；错误/ProviderView/日志不含测试密钥。非法 HTTP origin 在设置未允许时拒绝。

```ts
expect(saved.credentialState).toBe('session_only'); // 模拟不安全后端
expect(dbDump).not.toContain('secret-for-test');
expect(JSON.stringify(await service.list(namespaceA))).not.toContain('secret-for-test');
await expect(service.resolve(namespaceB, saved.id)).rejects.toThrow(/NOT_FOUND/);
```

- [ ] **Step 2 — 验证失败：** `npm test -- apps/desktop/tests/credentials.test.ts apps/desktop/tests/providers.test.ts`，预期服务缺失导致失败。
- [ ] **Step 3 — 实现存储和服务：** 主进程在 app.ready 后创建 SafeStorageBackend，优先安全可验证的异步能力；若不能验证安全后端则使用会话内存，绝不调用 setUsePlainTextEncryption(true)。持久化用 opaque ref + namespace + ciphertext；解密失败提示需要重填，不清除原密文。模型测试通过 Task 3，不能在 renderer 发起含 Key 的 fetch。
- [ ] **Step 4 — 验证修改一致性：** 重新保存不带 apiKey 时保留旧 Key；明确更换 Key 后清除旧 ref；删除被引用 provider 的失败不能先删除其凭据；模拟数据库保存失败时回收本次新增的凭据，原配置仍可用。
- [ ] **Step 5 — 验证与提交：** 测试与 typecheck 通过；消息 `feat: secure model credentials and provider configuration`。

## Task 5: Agent 循环、工具策略与 worker 生命周期

**Files:** Create `packages/agent-core/src/{runner,tool-registry,tool-policy,index}.ts`、`packages/agent-core/tests/runner.test.ts`、`apps/desktop/src/main/{agent-service,worker-supervisor,tool-gateway}.ts`、`apps/desktop/src/worker/index.ts`、`apps/desktop/tests/agent-service.test.ts`。

**Interfaces:** `ToolContext = {namespace:Namespace;sessionId,runId:string}`；`RegisteredTool = {spec:ToolSpec;risk:'read_only'|'mutating';execute(args:Record<string,unknown>,ctx:ToolContext,signal:AbortSignal):Promise<ToolResult>}`；`ToolRegistry.register(tool:RegisteredTool):void` / `definitions():ToolSpec[]` / `get(name:string):RegisteredTool|undefined`；`ToolExecutor.execute(call:ToolCall,ctx:ToolContext,signal:AbortSignal):Promise<ToolResult>`；`AgentRunner({model:ModelAdapter,executor:ToolExecutor,onEvent:(e:AgentEvent)=>Promise<void>}).run(input:RunInput,apiKey:string,signal:AbortSignal):Promise<void>`。`AgentService.start(ns:Namespace,sessionId:string,text:string):Promise<RunRecord>`、`cancel(ns:Namespace,runId:string):Promise<void>`、`cancelNamespace(ns:Namespace):Promise<void>`；`WorkerSupervisor.start(input:RunInput,apiKey:string,onEvent:(event:AgentEvent)=>Promise<void>,onToolRequest:(call:ToolCall)=>Promise<ToolResult>):void` / `cancel(runId:string):void` / `shutdown():Promise<void>`，回调绑定创建该 worker 的 namespace/runId。

- [ ] **Step 1 — 写循环测试：** fake ModelAdapter 分别返回文本、完整工具调用、多个调用、缺失结束原因、无工具模型、无效 JSON、未知工具、错误结果、重复 callId。工具参数经 schema 校验前执行次数必须为零；预设历史只包含当前 namespace；tool 消息保留配对 ID。

```ts
expect(executeCount).toBe(1); // 请求重发同一已完成 callId
expect(nextModelMessages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-1' });
expect(events.at(-1)).toMatchObject({ type: 'status', status: 'cancelled' });
expect(executeCountAfterAbort).toBe(0);
```

- [ ] **Step 2 — 验证失败：** `npm test -- packages/agent-core/tests apps/desktop/tests/agent-service.test.ts`，预期核心与 supervisor 缺失导致失败。
- [ ] **Step 3 — 实现核心：** 按 index 组装 tool deltas，只有 finish=tool_calls、ID/name/arguments 完整时发出调用。依次执行工具；最大 12 轮模型请求、24 次工具调用，达到上限给出明确错误。单工具结果最多 1 MiB，超限回传受控错误；A 阶段没有文件附件工具。工具调用不支持时省略 tools 并允许文本对话。
- [ ] **Step 4 — 实现主进程策略与 worker：** 主进程原子创建 Run，读取有序历史，在 utility process 启动核心；发送模型的历史排除 partial/interrupted 消息和未完成的工具调用/结果组，完整原记录仍保留供 UI 查看。主进程完成工具授权与 ledger 预留/完成。只读 get_current_time 的参数为可选 IANA timezone，调用 Intl.DateTimeFormat 前验证 timezone；mutating 默认拒绝。worker 不接收 shell 路径或任意模块地址，只运行打包的入口。
- [ ] **Step 5 — 实现取消/持久化：** Run 事件提交成功才通知 UI；assistant_message 持久化完整消息，失败/取消保留已收到的 partial 文本。停止后先 abort，再等待 2 秒终态，超时 kill 该 Run 的 worker；退出标记 WORKER_EXITED/interrupted，不自动重试。取消 namespace 阻止旧身份新调用并撤销旧事件订阅；旧 worker 事件最多更新其原命名空间记录，不能发布给新身份。
- [ ] **Step 6 — 验证与提交：** 另测同会话并发 RUN_ACTIVE、跨会话正常并行、未知 callId、不完整 EOF 不执行、同 ID 不同参数拒绝、崩溃后 ledger unresolved 不自动执行、mutating 未授权拒绝，以及取消后再发消息不会把缺少 tool 结果的 assistant 调用组发送给模型；消息 `feat: run durable agent loops with controlled tools and cancellation`。

## Task 6: 桌面启动、安全 IPC 与业务入口

**Files:** Create `apps/desktop/electron.vite.config.ts`、`apps/desktop/src/main/{index,window,ipc,principal,protocol}.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/env.d.ts`、`apps/desktop/tests/{ipc,window-security}.test.ts`；修改 `packages/shared/src/{desktop-api,schemas,index}.ts`。

**Interfaces:** `PrincipalService.current():Namespace` / `switchTo(namespace:Namespace):Promise<void>` 仅可信主进程可调用，A 阶段不向 UI 提供切换为任意远端用户的接口。`DesktopApi.providers={list,save,test,remove}`、`sessions={list,create,update,remove,messages}`、`runs={list,start,cancel,events}`、`onRunEvent(listener:(event:RunEvent)=>void):()=>void`，方法参数为前述 DTO 与 ID，任何业务 API 均不接收 namespace/apiKeyRef/数据库路径。只有 providers.save 接受用户输入的 apiKey，响应绝不含原始 Key。runs.list(sessionId) 返回已授权会话的 RunRecord[]，用于重启后的运行详情与 interrupted 展示。

- [ ] **Step 1 — 写 IPC 安全测试：** 测试打包 origin `app://desktop`、开发 localhost 的明确 origin、未知 origin、同 origin 子 frame、senderFrame=null、schema 注入、猜测别人的 sessionId/runId、晚到旧身份事件；只允许预期窗口的主 frame。

```ts
await expect(invokeFrom(childFrame, 'runs:start', { sessionId: 's1', text: 'test' })).rejects.toThrow(/FORBIDDEN/);
expect(windowOptions.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
expect(Object.keys(exposedApi)).not.toContain('ipcRenderer');
```

- [ ] **Step 2 — 验证失败：** `npm test -- apps/desktop/tests/ipc.test.ts apps/desktop/tests/window-security.test.ts`，预期入口和 guard 未实现导致失败。
- [ ] **Step 3 — 实现 app 启动与 origin：** 启动恢复旧 Run、初始化 local principal/store/keyring/service；app 自定义 protocol 只映射已打包资源，规范化路径并阻止目录逃逸。生产 CSP 为 script-src 'self'、connect-src 'none'；开发期仅明确 Vite origin/HMR 例外。默认拒绝新窗口和任意导航，外部链接验证 http/https 后交给系统浏览器。electron-vite 主进程和 worker 分别输出 `out/main/index.js`、`out/main/agent-worker.js`，preload 为 `out/preload/index.js`，renderer 为 `out/renderer/index.html`；主进程/worker 打包 workspace 源码，node 内置模块保持 external，sandbox preload 仅依赖 electron 和打包后的业务桥接。
- [ ] **Step 4 — 实现业务 IPC：** 每次请求验证来源、严格 schema 和 PrincipalService.current，再调用仓储与服务；禁止信任 renderer 用户身份。preload 使用独立方法包装，不传 Electron event 对象，不暴露 send/invoke；onRunEvent 返回卸载函数。活动会话删除先取消并确认终态再执行本地删除。
- [ ] **Step 5 — 验证真实启动与提交：** `npm run build` 后启动 Electron，确认 node:sqlite 和 worker 可加载；生产 build 不开放开发 origin/test 设置。安全测试和 typecheck 通过；消息 `feat: connect desktop services through validated IPC`。

## Task 7: 中文会话界面与模型设置

**Files:** Create `apps/desktop/src/renderer/{index.html,main.tsx,App.tsx,styles.css}`、`apps/desktop/src/renderer/components/{SessionSidebar,ChatView,Composer,ProviderSettings,RunDetails}.tsx`、`apps/desktop/src/renderer/hooks/{useSessions,useRunEvents}.ts`。

**Interfaces:** 只消费 DesktopApi 和共享 DTO，不导入 main/storage/model-adapter。`useRunEvents(runId:string|null)` 以 runId+seq 去重，先订阅再读取已持久化 events 防止丢失窗口。

- [ ] **Step 1 — 实现可用界面：** 左侧会话搜索/新建/置顶/归档/删除，主区有模型选择、消息列表、输入与停止按钮；设置页可添加/修改模型名称、Base URL、模型 ID、密钥、上下文窗口、输出上限、timeout、工具能力、temperature 支持、输出 token 参数及 HTTP opt-in。空状态引导配置模型；本地身份显示“本地空间”。
- [ ] **Step 2 — 实现执行反馈：** 文本流式追加、工具名/状态/结果可展开、取消/失败/恢复状态清晰；不支持工具调用仍允许对话。密钥输入不回显原值，不写浏览器持久化。session_only 显示“密钥仅本次运行可用”；重启缺失时要求重新填写。
- [ ] **Step 3 — 实现安全渲染与交互：** 首版消息按纯文本渲染并保留换行，不插入模型生成 HTML。Enter 发送、Shift+Enter 换行，IME composing 时不发送。确认删除显示具体会话名；活动会话先完成取消。网络/IPC 错误给出可操作的中文说明，不展示原始堆栈。
- [ ] **Step 4 — 验证与提交：** UI 验证合并到 Task 8 的真实 Electron E2E，不为低风险样式写快照测试；检查 typecheck/build 通过，消息 `feat: add Chinese agent chat and model configuration UI`。

## Task 8: 真实 Electron 闭环验证与开发交付

**Files:** Create `playwright.config.ts`、`tests/e2e/{agent-chat,session-recovery,security}.spec.ts`、`README.md`、`apps/desktop/electron-builder.yml`、`.github/workflows/verify.yml`；修改 scripts；开发 fixture 使用 Task 3 的受控模型服务。

**Interfaces:** Playwright `_electron.launch` 启动已构建应用；独立测试 userData 路径仅通过测试入口设置，生产打包禁止该入口和 mock 模型。测试 profile 明确标记 loopback HTTP opt-in，不关闭 webSecurity 或 sandbox。

- [ ] **Step 1 — 写真实闭环测试：** 配置 fixture 模型 → 连接测试 → 新建会话 → 流式文本 → get_current_time 调用 → 工具结果后的最终回复；断言调用次数一次、正确终态、可查运行记录。
- [ ] **Step 2 — 写恢复与安全测试：** 同 userData 关闭/重启后恢复标题/消息/工具结果；流式过程中停止不再调度工具；运行中 worker 退出后标 interrupted；renderer 无 require/process/任意 IPC；磁盘数据库与 UI 接收事件中无明文 Key；会话内存 Key 重启后状态 missing。
- [ ] **Step 3 — 跑集成并修复：** `npm run build && npm run test:e2e`，检查真实 Electron + node:sqlite + worker，而非浏览器页面模拟；先确认测试失败触发具体未满足路径，再只修该路径。
- [ ] **Step 4 — 完成开发交付：** README 写明安装/启动/测试/模型配置、本阶段已实现能力、真实模型和后续 B–F 的未验收范围。CI macOS/Windows/Linux 执行 npm ci、typecheck、unit/build；Electron E2E 首先覆盖 macOS，其他平台需在对应 runner 实际通过后再标记支持。package:dir 生成本机未签名开发包，不上传、不自动发布、不宣称发行签名完成。
- [ ] **Step 5 — 最终验证与提交：** `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`、`npm run package:dir`、`git diff --check`；记录退出码和未满足的外部联调条件。只在这些结果确认后声明阶段 A 开发闭环完成，消息 `test: verify desktop agent flow and restart recovery`。

## 覆盖核对与执行交接

| 已确认设计中的范围 | 本计划覆盖 |
| --- | --- |
| 安全桌面壳与受限业务 IPC | Task 1、4、6 |
| 模型配置、协议兼容、流式与受控工具循环 | Task 3、4、5、7、8 |
| Session、Run、历史、取消、崩溃与重启恢复 | Task 2、5、6、7、8 |
| 身份命名空间、凭据和调用授权边界 | Task 1、2、4、5、6 |
| 上下文压缩、短期/长期记忆 | 后续阶段 B；A 不包含自动压缩实现 |
| Docker 沙箱与 Skill 导入导出/执行 | 后续阶段 C；A 不包含宿主机脚本执行 |
| FastGPT 社区版/商业版工作流和 Agent | 后续阶段 D；需要真实实例协议与凭据 |
| 两版 SSO、身份映射和资源授权联调 | 后续阶段 E；需要服务端授权接入条件 |
| 联合验收、跨平台发行 | 后续阶段 F；A 仅提供本机开发包和明确验证记录 |

计划自审须确认 schema/字段/方法名一致、Review Focus 的五项都有上述具体测试、没有将后续阶段冒充已完成，也没有通过模拟验证冒充真实服务验收。

用户已审阅计划并选择在当前会话直接执行（Native）。逐项实现与验证，结束时进行一次独立全量审查。
