# Chat Workspace and Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 FastGPT 桌面聊天中交付真实执行轨迹、实时耗时、同会话模型切换、文件附件、隔离 Docker 工作区和可配置远程语音输入。

**Architecture:** 沿用窄业务 IPC、可信主进程、独立 Agent Worker 和 SQLite；模型仅提议工具，主进程授权后交由本地 Docker。附件和工作区采用快照，不挂载原目录；语音独立配置并在主进程转写，Renderer 只负责录音、草稿和展示。

**Tech Stack:** Electron 44.4.5、React 19.3、TypeScript 5.9、Node.js ≥ 22.12、Zod 4、SQLite、Vitest 5、Playwright 1.63、本地 Linux Docker；不增加通用文档解析、向量库或离线 ASR 依赖。

**Spec:** [已批准设计](../specs/2026-09-28-chat-workspace-voice-design.md)。实施者必须同时阅读本文与设计，具体值以 Global Constraints 和设计为准。

## Global Constraints

- 保留用户消息靠右、Agent 回复靠左，不增加“用户 / FastGPT Agent”身份标签。
- 思考输出累计最多 1 MiB；首版显式支持 `reasoning_content`，默认不读取，未返回不虚构。
- 总耗时包含排队和授权等待，命令耗时仅实际执行；每秒刷新，在阶段转换及每 5 秒保存耗时检查点，终态冻结。
- 草稿最多 16 个附件、单文件最多 20 MiB、单次合计最多 100 MiB；目录不作附件拖拽，不自动解压 ZIP。
- 工作区最多 10,000 个条目（包括普通文件和目录）、总内容最多 1 GiB、单文件最多 100 MiB。
- 文件读取限制为单次 64 KiB；单次文本写入最多 64 KiB，命令字符串最多 16 KiB。
- 每个容器 2 CPU、1 GiB 内存、128 个进程、单命令 120 秒、stdout/stderr 合计最多 1 MiB，工作区最多 1 GiB。
- 临时区另外限制为 64 MiB，工作区 inode 上限为 16,384；禁止额外 swap 和可无限增长的容器日志；总并发沙箱最多 2 个。
- 每阶段文件传输 120 秒超时；基线、当前版本和提交临时空间约 3 GiB；每个工作区备份累计最多 1 GiB，不自动删除备份。
- 非 root、只读根、去 capabilities、no-new-privileges、默认 seccomp、独立 namespace、默认断网，无宿主机目录/socket/设备挂载，无网络启用开关。
- 读取文件发往模型、写入副本及执行命令均审批；授权绑定当前身份、Session、Run、工具调用 ID 和参数 hash，不提供永久允许。
- 最长 120 秒、音频最大 20 MiB；转写文字最多 64 KiB，WebM/Opus 或 MP4 实际编码；独立 ASR 配置，不自动发送、不覆盖草稿、不默认保存录音。
- 首版文本/代码直接组装上下文；图片/PDF/Office 仅作为沙箱文件，无视觉/OCR/通用文档解析；无工具能力只普通聊天和文本附件。
- 默认 HTTPS；HTTP 显式允许；不关闭 TLS 验证、不跟随重定向；转写不自动重试，密钥不进入 DTO、历史或日志。
- 主进程身份范围验证、单会话单活动 Run、事件提交后发布、未知副作用不重放；取消后不能批准、提交检查点或改为成功。
- 本轮不交付上下文压缩、长期记忆、FastGPT/SSO 联调或 Skill 管理；模型/ASR/麦克风/平台真实联调与模拟测试分别报告。
- 普通测试仅受控服务和临时目录；Docker 测试只清理所属资源；现有单实例、防测试入口泄露、Renderer 沙箱和 CSP 不放宽。

## Review Focus

1. UTF-8 多字节、Unicode 规范化/大小写/Windows 保留名碰撞：按字节限制，不拆坏中文，不把两个条目映射为同一目标（Tasks 1、4、5、7）。
2. 选择/导入期间源文件或父目录被替换、写回前被外部编辑：拒绝越界和冲突，原文件及上次检查点不受影响（Tasks 4、6、10）。
3. 秘钥解密、传输、排队/审批和停止同时发生：旧版本不得启动、迟到结果不得生效、后台子进程不得残留（Tasks 2、8、9、13）。
4. 命令含 ANSI/伪 HTML、无限输出、非零退出和后台子进程：纯文本有界显示、真实退出码、有效产物可保留、取消不残留（Tasks 7、8、9、14）。
5. 录音授权后设备消失、转写期间继续输入/切换会话：音轨释放、草稿不覆盖、迟到文字丢弃、普通聊天仍可用（Tasks 11、12、13、14）。

## 文件边界与执行准备

执行方式沿用用户此前明确选择的 **Native：当前会话逐项实现，末尾独立全量审查**；本文仍需用户审阅通过才开始执行。

基线为 `dc8dcf6` 及此前已验证但未提交的聊天布局文件：`ChatView.tsx`、`styles.css`、`desktop.spec.ts`、`chat-view.test.ts`。执行前重新检查差异，只把确认为上轮产物的这些文件保存为独立基线提交；`.idea/` 和新出现的无关编辑不纳入、不覆盖。通过 using-git-worktrees 的原生流程复用/建立隔离实现目录，所有命令使用其明确路径；不停止现有开发应用，不在用户真实数据库运行迁移测试。

模块文件安排：共享新契约放 `packages/shared/src/feature-{types,schemas}.ts`；数据库实体按 repository 分开；桌面新服务各一个目录；Docker 自有包；Renderer 用独立 hooks/components。已有 `types.ts`、`schemas.ts`、`index.ts` 和 `DesktopApi` 只承担组合与导出。所有新单元测试放已有 `*/tests/*.test.ts` 模式内；Docker 集成测试用单独 Vitest 配置显式开启，默认 `npm test` 不偷偷启动容器。

以下测试片段只给决定性断言；每个片段应放入有描述名称的 `it`，使用同一任务 test 文件的有类型 fixture。fixture 仅构造数据/注入时钟/文件/进程，不代替被测实现。每项最后只提交该项 Files 内的修改，执行提交前先检查暂存清单，不使用全目录暂存。

---

### Task 1: 共享契约与兼容存储迁移

**Files:** Create `packages/shared/src/feature-types.ts`、`feature-schemas.ts`；Create `packages/storage/src/{attachment,workspace,approval,transcription}-repository.ts`；Modify `packages/shared/src/{types,schemas,desktop-api,index}.ts`、`packages/storage/src/{migrations,provider-repository,session-repository,run-repository,index}.ts`、`tests/fixtures/data.ts`、`apps/desktop/tests/chat-view.test.ts`、`apps/desktop/src/renderer/components/ProviderSettings.tsx`；Test `packages/shared/tests/feature-schemas.test.ts`、`packages/storage/tests/feature-migration.test.ts`。

**Interfaces:** 消费现有 `Namespace`、`Store`、`ProviderDraft`。定义 `RunStartOptions={attachmentIds:string[];expectedSessionRevision?:number;expectedWorkspaceRevision?:number}`，保留 `DesktopApi.runs.start(sessionId,text,options?)`，内部 `RunStartRequest` 是三者展开。`SessionRecord` 增加 `revision:number;workspaceId:string|null`；`ModelProfile/ProviderView` 增加不含秘密的 `revision:string`（每次保存新 UUID）；`SessionPatch.providerId?:string`。`ModelSnapshot` 保存 providerId、revision、name、baseUrl、modelId、capabilities、contextWindow、maxOutputTokens、timeoutMs，禁止 credentialRef；`RunRecord` 增加 `modelSnapshot:ModelSnapshot|null;elapsedMs:number;timingUpdatedAt:number|null`；`MessageRecord` 增加 `runId:string|null;attachmentIds:string[]`。

新增 `AttachmentRecord={id,sessionId,name,size,sha256,kind:'text'|'binary',state:'ready'|'sent',snapshotKey}`，UI `AttachmentView` 去除 snapshotKey；`WorkspaceRecord=WorkspaceView&{sourceRoot:string|null,baselineKey:string,checkpointKey:string}`，UI `WorkspaceView={id,sessionId,sourceLabel:string|null,revision,entryCount,totalBytes}`。`FileEntry={relativePath,kind:'file'|'directory',size,sha256:string|null}`，`FileListPage={entries:FileEntry[],nextCursor:string|null}`；`FileRead={text,offset,nextOffset,remainingBytes,truncated}`；`WorkspaceDiff={relativePath,kind:'added'|'modified'|'deleted',binary,beforeHash:string|null,afterHash:string|null}`。`ApprovalView={id,runId,callId,kind:'file_read'|'file_write'|'command',relativePath:string|null,command:string|null,arguments,destinationLabel,state:'pending'|'approved'|'rejected'|'revoked'}`；`ApprovalRecord={view:ApprovalView,namespaceKey,sessionId,argumentsHash,createdAt}`；`ApprovalRequestView=Omit<ApprovalView,'id'|'runId'|'callId'|'state'>`，`ApprovalDecision='approved'|'rejected'`。`SpeechDraft={enabled,name,baseUrl,modelId,timeoutMs,allowInsecureHttp}`，`SpeechConfig=SpeechDraft&{credentialRef:string|null,revision:string}`；`SpeechView=SpeechDraft&{credentialState:CredentialState}`；`AudioSubmission={sessionId,operationId,mimeType,bytes:Uint8Array}`。上述未展开类型的 ID/hash/key/name/path/text/arguments 为 string，size/count/revision（非明确 string 的字段）/offset/time/elapsed 为 number，enabled/binary/truncated/allowInsecureHttp 为 boolean。

`RunTimingSnapshot={runId:string,elapsedMs:number,active:boolean}`，`DesktopApi.runs.timing(runId):Promise<RunTimingSnapshot>`。新增窄 API：`attachments.pick(sessionId)`、`importDropped(sessionId,files:File[])`、`list(sessionId)`、`removeDraft(id)`；`workspaces.ensure/previewSelection/importSelection/list/read/diff` 与 Task 6 同参数去掉 n，preview 仅返回前 100 条目及总数/总字节/排除摘要；`approvals.decide(id,decision:ApprovalDecision)`；`exports.preview/apply/exportToChosenDirectory/listBackups/restoreBackup/removeBackups` 与 Task 10 同参数去掉 n；`speech.get/save/beginCapture/submit/cancel` 对应 Tasks 11–12 去掉 n/wc（身份和 wc 来自 IPC sender）；`sandbox.detect/prepareImage` 不接受模型提供的参数。DTO 与返回值类型使用对应服务定义，UI 无任意路径/命令 API。Task 1 只在 feature-types 定义这些分组接口；各组在对应服务任务完成时才加入 DesktopApi、preload 和 IPC，不放空方法或假成功占位。timing 在 Task 2、attachments 在 Task 5、workspaces 在 Task 6、approvals/sandbox 在 Task 9、exports 在 Task 10、speech 在 Tasks 11–12 接通。

共享文件桥 `SandboxFileBridge={manifest(key:string):Promise<FileEntry[]>;read(key:string,path:string):AsyncIterable<Uint8Array>;createSnapshot():Promise<string>;write(key:string,path:string,data:AsyncIterable<Uint8Array>):Promise<void>;discard(key:string):Promise<void>}`，避免 sandbox 包反向依赖 desktop。模型和 Worker 只用已有共享契约，不导入主进程文件服务。

事件沿用已有名称，新增 `reasoning_delta{text}`、`reasoning_truncated{limitBytes}`、`approval_requested{approval:ApprovalView}`、`approval_decided{approvalId,decision:ApprovalDecision|'revoked'}`、`command_started{id,command,cwd}`、`command_output{id,channel:'stdout'|'stderr',text}`、`command_finished{id,exitCode:number|null,elapsedMs,reason:'exited'|'timeout'|'cancelled'|'output_limit'|'oom'|'failed',truncated}`、`workspace_checkpoint{id,workspaceId,revision}`；时间和归属只由可信层附加。RunEvent 对已持久化 assistant_message 可附加 `messageId?:string`，由 `RunRepository.appendEvent(n,runId,event,metadata?:{messageId:string})` 接收主进程元数据；Worker 的 AgentEvent schema 不允许自报 messageId。

- [ ] **Step 1 — 写失败测试：** 验证迁移 v1 数据、严格 schema 和边界，包含旧消息不猜 runId、原密钥密文不变、重复迁移一致、全新增 repository 跨身份拒绝。
  ```ts
  expect(readOldMessage().runId).toBeNull(); expect(readOldMessage().attachmentIds).toEqual([]);
  expect(readCredentialBytes()).toEqual(originalCiphertext);
  expect(runStartSchema.safeParse({sessionId:'s',text:'',attachmentIds:['a']}).success).toBe(true);
  expect(runStartSchema.safeParse({sessionId:'s',text:'',attachmentIds:[]}).success).toBe(false);
  expect(audioSubmissionSchema.safeParse(oversizeAudio(20*1024*1024+1)).success).toBe(false);
  expect(Buffer.byteLength('中'.repeat(21846))).toBeGreaterThan(64*1024);
  ```
- [ ] **Step 2 — 验证红灯：** `npm test -- packages/shared/tests/feature-schemas.test.ts packages/storage/tests/feature-migration.test.ts`；预期 FAIL，缺少契约/迁移，而不是 fixture 语法失败。
- [ ] **Step 3 — 实现：** `migrate(db:Database):void` 按版本事务化；所有旧 INSERT 改显式列。`AttachmentRepository.list(n:Namespace,sid:string):AttachmentRecord[];get(n,id):AttachmentRecord;insert(n,record:AttachmentRecord):void;markSent(n,ids:string[],messageId:string):void;removeDraft(n,id):void`；`WorkspaceRepository.getForSession(n,sid):WorkspaceRecord|null;save(n,record:WorkspaceRecord):void`；`ApprovalRepository.get(n,id):ApprovalRecord;insert(n,record:ApprovalRecord):void;decide(n,id,decision:ApprovalDecision):ApprovalRecord;revokeRun(n,runId):void`；`TranscriptionRepository.get(n):SpeechConfig|null;save(n,config:SpeechConfig):void`。省略标注的 n 都为 Namespace、id/sid/runId 都为 string。每个返回值严格解析，复合身份外键；旧配置默认 reasoningField='none'、旧 revision 初始化、不创建容器。`SessionRepository.update` 在事务内校验模型切换无活动 Run；新增消息显式存归属，附件关联与创建 Run 原子提交；更新已有 typed fixtures，不放宽 TypeScript 或 schema。
- [ ] **Step 4 — 验证绿灯：** 同一测试命令及 `npm run typecheck`；预期 PASS，既有 schema/storage 测试继续通过。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: add workspace speech trace contracts and safe migrations"`。

### Task 2: 原子模型切换、Run 快照与真实计时

**Files:** Create `apps/desktop/src/main/{run-clock,run-start-service}.ts`；Modify `apps/desktop/src/main/{provider-service,agent-service,ipc}.ts`、`apps/desktop/src/preload/index.ts`、`packages/shared/src/desktop-api.ts`、`packages/storage/src/{session-repository,run-repository}.ts`；Test `apps/desktop/tests/{run-clock,run-start-service}.test.ts`、`packages/storage/tests/runs.test.ts`。

**Interfaces:** `RunClock.start(runId:string):void;elapsed(runId:string):number;finish(runId:string):number;dispose():void` 使用注入单调时钟和持久化回调；`RunStartService.prepare(n:Namespace,request:RunStartRequest):Promise<{profile:ModelProfile;apiKey:string;snapshot:ModelSnapshot;messages:ChatMessage[];tools:ToolSpec[];commit():RunRecord}>`。构造函数依赖 Store、ProviderService、当前身份函数和可替换 `prepareContext` 回调（Task 5 接入）；commit 再核验 session/provider/workspace revisions 后事务创建。AgentService.start 增加 options，可继续旧调用；`AgentService.timing(n,runId):RunTimingSnapshot` 提供经过身份检查的实时计时，终态用已保存值。

- [ ] **Step 1 — 写失败测试：** 模型更换/编辑发生在密钥异步读取期间，commit 必须拒绝；运行快照不含密钥；无工具模型工具列表为空。计时用虚拟时钟模拟排队、授权和时钟回拨。
  ```ts
  await selectProvider('B'); await expect(pendingStart).rejects.toMatchObject({code:'CONFIG_CHANGED'});
  expect(started.modelSnapshot?.modelId).toBe('model-B'); expect(JSON.stringify(started)).not.toContain(secret);
  wallClock.set(-100000); monotonic.advance(5000); expect(clock.elapsed('r')).toBe(5000);
  expect(clock.finish('r')).toBe(5000); monotonic.advance(9000); expect(clock.elapsed('r')).toBe(5000);
  expect(restored.elapsedMs).toBe(lastSavedElapsedMs);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/run-clock.test.ts apps/desktop/tests/run-start-service.test.ts packages/storage/tests/runs.test.ts`；预期新用例 FAIL。
- [ ] **Step 3 — 实现：** 创建上述服务，所有异步阶段后复核身份和版本；active 检查与用户消息/Run 写入放同一事务。每 5 秒和状态变化持久化单调耗时；终态清理 timer。保存模型快照但不保存 apiKey/credentialRef；旧 Run 保留 null。保留完整历史配对与现有取消保护，错误使用 `CONFIG_CHANGED`、`CONTEXT_TOO_LARGE`、`RUN_ACTIVE`。
- [ ] **Step 4 — 绿灯：** 同一测试命令、原 `agent-service.test.ts` 和 typecheck；预期 PASS，取消后终态和计时不能被迟到成功覆盖。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: snapshot models and measure guarded run lifetimes"`。

### Task 3: 模型公开思考与按 Run 展示执行轨迹

**Files:** Create `apps/desktop/src/renderer/hooks/useSessionRuns.ts`、`useRunTimer.ts`；Create `apps/desktop/src/renderer/components/{RunTrace,ModelPicker}.tsx`；Modify `packages/model-adapter/src/chat-completions.ts`、`packages/agent-core/src/runner.ts`、`apps/desktop/src/renderer/{App,components/ChatView,components/ProviderSettings}.tsx`、`styles.css`；Test `packages/model-adapter/tests/reasoning.test.ts`、`packages/agent-core/tests/runner.test.ts`、`apps/desktop/tests/run-trace.test.ts`、`tests/e2e/run-trace.spec.ts`；Modify `tests/fixtures/openai-server.ts`。

**Interfaces:** `ModelCapabilities.reasoningField:'none'|'reasoning_content'`；ModelEvent 增加 reasoning_delta。`useSessionRuns(sessionId:string|null)` 返回 `{runs:RunRecord[];eventsByRun:Map<string,RunEvent[]>;refresh():Promise<void>}`，按 runId+seq 去重；`RunTrace({run,events,onDecide?})`，决定审批的 callback 在 Task 9 接入；`useRunTimer(run:RunRecord):number` 仅活跃时每秒刷新。

- [ ] **Step 1 — 写失败测试：** 同时有思考和答案的 SSE/JSON、中文跨块、思考超限、无思考和 finish 后增量；服务端日志确认思考不回传。真实 E2E 验证两次切换模型和中间回复不消失。
  ```ts
  expect(events.filter(e=>e.type==='reasoning_delta').map(e=>e.text).join('')).toBe('服务公开内容');
  expect(nextRequest.messages).not.toContainEqual(expect.objectContaining({content:'服务公开内容'}));
  expect(reasoningBytes).toBeLessThanOrEqual(1024*1024); expect(finalAnswer).toBe('完成');
  await expect(page.locator('.message-avatar')).toHaveCount(0);
  await expect(page.getByText('工具前解释',{exact:true})).toBeVisible();
  ```
- [ ] **Step 2 — 红灯：** `npm test -- packages/model-adapter/tests/reasoning.test.ts apps/desktop/tests/run-trace.test.ts packages/agent-core/tests/runner.test.ts`；预期新断言 FAIL。
- [ ] **Step 3 — 实现：** 显式能力开关控制解析，累计限额在整个 Run 中处理并仅发一次截断标记；结束后增量仍拒绝。历史与已提交事件合并按 messageId/runId 去重，不能用时间猜归属；为 live message 事件持久化后附加可信 messageId（Worker 不提供归属）。旧 Run 无关联时保留旧展示。轨迹纯文本展开、unknown 工具不算成功，单调计时、终态冻结，ModelPicker 空闲才更新 Session；耗时快照通过窄 `runs:timing` 每秒查询并以 Renderer performance 锚点显示，迟到样本不能更新终态。`run-status` testId 只给当前 latest Run，历史卡各用 runId 分隔，不破坏旧 E2E 的唯一定位。每个 trace 分页读取历史事件，避免启动时全量加载所有 Run；不生成虚构步骤。
- [ ] **Step 4 — 绿灯：** 上述单元命令及 `npm run build:test`、`npx playwright test tests/e2e/run-trace.spec.ts tests/e2e/desktop.spec.ts`；预期 PASS，原气泡、IME、长文本保持。测试完恢复 `npm run build`。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: show persisted reasoning tools elapsed time and model selection"`。

### Task 4: 受控宿主文件与原子文件操作基础

**Files:** Create `apps/desktop/src/main/files/{safe-file-ops,path-policy,artifact-store}.ts`、`apps/desktop/native/safe-files-posix.c`、`scripts/build-safe-files.mjs`；Modify `package.json`、`.gitignore`、`apps/desktop/electron-builder.yml`；Test `apps/desktop/tests/safe-file-ops.test.ts`。

**Interfaces:** `SafeFileOps.scan(root:string,limits:FileLimits):Promise<FileEntry[]>;copyInto(root:string,relativePath:string,destination:string,limitBytes:number):Promise<FileFingerprint>;read(root:string,relativePath:string,offset:number,maxBytes:number):Promise<Uint8Array>;replace(root:string,relativePath:string,source:string,expected:FileFingerprint|null,backupRoot:string):Promise<{backupKey:string|null;version:FileFingerprint}>;delete(root:string,relativePath:string,expected:FileFingerprint,backupRoot:string):Promise<{backupKey:string}>`。`FileFingerprint={sha256:string,size:number,device:string,inode:string,mtimeNs:string}`；`FileLimits={maxEntries:number,maxFileBytes:number,maxTotalBytes:number}`。`ArtifactStore implements SandboxFileBridge`，额外 `promote(key:string):Promise<void>` 将所属临时快照标记为可引用。用业务 UUID 存储快照，只接受拥有的 snapshotKey；相对路径 UTF-8 最多 1,024 字节、单文件名最多 255 字节。

- [ ] **Step 1 — 写失败测试：** 临时目录中构造链接、硬链接、设备/特殊文件、穿越、大小写/NFC 碰撞、Windows 盘符/保留名、源读取中变化及目标父目录替换；拒绝后外部哨兵文件不变。
  ```ts
  await expect(files.copyInto(root,'../outside',dest,20*1024*1024)).rejects.toMatchObject({code:'UNSAFE_PATH'});
  await expect(files.replace(root,'link/target',source,version,backups)).rejects.toMatchObject({code:'UNSAFE_PATH'});
  expect(await readOutsideSentinel()).toBe('untouched'); expect(await scanNames(['A','a'])).toEqual({rejected:true});
  await expect(copyChangedSource()).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/safe-file-ops.test.ts`；预期 FAIL 缺少受控操作。
- [ ] **Step 3 — 实现：** 应用管理区域私有权限，扫描实时计数、按实际字节复制、UTF-8 相对路径和类型检查。macOS/Linux 可信 POSIX helper 用目录句柄、逐段 openat/O_NOFOLLOW、fstatat 和 renameat/unlinkat；主进程调用固定二进制+参数、无 shell，核验 hash/身份后原子替换并备份。helper 不执行模型代码，编译只在开发/构建阶段；打包为 extraResources。Windows 或 helper 缺失时安全写回失败关闭，另选位置导出使用已验证的新目标；不要用 realpath+前缀替代安全句柄。平台不支持的导入/导出操作明确失败，不能声称跨平台通过。
- [ ] **Step 4 — 绿灯：** `npm run build:safe-files`、上述单元命令、`npm run typecheck`；预期 PASS，注入目录竞态测试外部哨兵始终不变，临时失败文件只在所属区域清理。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: constrain file access and guarded atomic exports"`。

### Task 5: 附件导入、发送与上下文预算闭环

**Files:** Create `apps/desktop/src/main/files/{attachment-service,input-grants,context-assembler}.ts`、`apps/desktop/src/main/ipc/{attachment-handlers,feature-inputs}.ts`、`apps/desktop/src/main/feature-services.ts`、`packages/agent-core/src/context-budget.ts`；Create `apps/desktop/src/renderer/hooks/useDrafts.ts`、`apps/desktop/src/renderer/components/AttachmentList.tsx`；Modify `apps/desktop/src/{main/index,main/ipc,main/run-start-service,preload/index}.ts`、`apps/desktop/src/renderer/components/Composer.tsx`、`apps/desktop/src/renderer/App.tsx`、`packages/shared/src/desktop-api.ts`、`packages/agent-core/src/{runner,index}.ts`；Test `apps/desktop/tests/{attachment-service,context-assembler,input-grants}.test.ts`、`packages/agent-core/tests/context-budget.test.ts`、`tests/e2e/attachments.spec.ts`。

**Interfaces:** `AttachmentService.importPicked(n:Namespace,sessionId:string,grantId:string,signal:AbortSignal):Promise<AttachmentView[]>;list(n:Namespace,sid:string):AttachmentView[];removeDraft(n:Namespace,id:string):Promise<void>`。InputGrant 绑定预期 WebContents、身份和会话，TTL 60 秒且一次性；系统选择器创建授权，preload 的 `webUtils.getPathForFile` 只处理真实 File 对象，拖拽路径在主进程独立确认后才创建授权，不接受任意路径作为选择证明。`assembleContext(n:Namespace,sessionId:string,text:string,attachmentIds:string[],profile:ModelProfile,tools:ToolSpec[]):Promise<ChatMessage[]>` 消费纯 `assertContextBudget(profile:ModelProfile,messages:ChatMessage[],tools:ToolSpec[]):void`，后者位于 agent-core，Worker 同样调用。以 JSON UTF-8 字节数和固定协议开销作保守估算，不承诺是所有第三方 tokenizer 的数学上界；输入安全余量 `max(1024,ceil(C*0.05))`，超额抛 CONTEXT_TOO_LARGE，服务端 context 超限仍明确反馈，不做自动摘要。

- [ ] **Step 1 — 写失败测试：** 16/17 个附件、20 MiB+1 字节、100 MiB+1 字节、伪路径、导入取消、重复/外国 ID、仅附件发送、文本中文边界及二进制说明，原文件改动不影响快照。
  ```ts
  await expect(importFiles(17)).rejects.toMatchObject({code:'ATTACHMENT_LIMIT'});
  expect((await sendOnlyAttachments()).status).toBe('queued'); expect(await readSnapshot()).toBe('原文本');
  expect(await binaryContext()).not.toContain('伪造的 PDF 正文');
  await expect(assembleOversizeHistory()).rejects.toMatchObject({code:'CONTEXT_TOO_LARGE'});
  expect(await useGrantTwice()).toEqual(['accepted','rejected']);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/attachment-service.test.ts apps/desktop/tests/context-assembler.test.ts apps/desktop/tests/input-grants.test.ts`；预期 FAIL 新流程不存在。
- [ ] **Step 3 — 实现：** 新窄 `attachments:pick/import/list/remove` handlers 复用 authorizeSender；File grants 不进模型。在 feature-services.ts 接入 SafeFileOps/ArtifactStore/AttachmentService，index 实例化后接入真实 IPC，不以 fixture 替代运行服务。实际副本在 workspace/.attachments 独立 ID 子目录防重名；Task 6 接 WorkspaceService 前使用同一 WorkspaceRepository+ArtifactStore 的空工作区。文本单次摘录 64 KiB，TextDecoder fatal 检测 UTF-8/二进制；所有模型请求前调用纯预算检查，包括 Worker 后续工具轮次，不从 Worker 导入主进程 assembler。附件原子关联消息，文件-only 的用户 message 用“已添加文件”占位并在 UI 以附件卡表达；二进制只传相对文件信息和未提取说明。发送前提示目标服务和文本摘录范围；草稿 keyed sessionId、异步 token 防跨会话、导入中/失败阻止发送。
- [ ] **Step 4 — 绿灯：** 上述单元命令及 `npm run build:test`、`npx playwright test tests/e2e/attachments.spec.ts`；预期选择、真实拖拽确认、移除、仅附件和重启可回看 PASS；恢复生产构建。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: import bounded attachments and assemble honest file context"`。

### Task 6: 目录授权、隔离工作区与检查点

**Files:** Create `apps/desktop/src/main/workspaces/{workspace-service,workspace-diff}.ts`、`apps/desktop/src/main/ipc/workspace-handlers.ts`；Modify `apps/desktop/src/main/{feature-services,ipc}.ts`、`apps/desktop/src/main/files/attachment-service.ts`、`apps/desktop/src/preload/index.ts`、`packages/shared/src/desktop-api.ts`、`packages/storage/src/workspace-repository.ts`；Test `apps/desktop/tests/{workspace-service,workspace-diff}.test.ts`。

**Interfaces:** 以下 n 为 Namespace、sid/grantId/path/snapshotKey/cursor 为 string、offset/maxBytes/expectedRevision 为 number、signal 为 AbortSignal：`WorkspaceService.ensure(n,sid):Promise<WorkspaceView>;previewSelection(n,sid):Promise<{grantId:string,entries:FileEntry[],excluded:string[],entryCount:number,totalBytes:number,truncated:boolean}>;importSelection(n,sid,grantId,signal):Promise<WorkspaceView>;list(n,sid,cursor?):Promise<FileListPage>;read(n,sid,path,offset,maxBytes):Promise<FileRead>;checkout(n,sid):Promise<{workspace:WorkspaceView;snapshotKey:string}>;commit(n,sid,expectedRevision,snapshotKey,signal):Promise<WorkspaceView>;diff(n,sid):Promise<WorkspaceDiff[]>`。分页最多 100 条目；preview 显示摘要但授权的是已核验完整清单。消费 SafeFileOps/ArtifactStore、Store、当前身份；Task 5 附件改为调用 ensure/commit，共享同一快照，不保留第二套 workspace 实现。

- [ ] **Step 1 — 写失败测试：** 10,000/10,001 条目、100 MiB 单文件和 1 GiB 总量、空目录、过滤、身份隔离、已有源目录禁止换绑定、提交崩溃和 revision 竞争。
  ```ts
  expect(preview.excluded).toContain('.git'); expect(preview.excluded).toContain('.env');
  await expect(importEntries(10001)).rejects.toMatchObject({code:'WORKSPACE_LIMIT'});
  await expect(foreignWorkspaceRead()).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(commitStaleRevision()).rejects.toMatchObject({code:'CONFIG_CHANGED'});
  expect(await checkpointAfterInjectedCrash()).toEqual(previousCheckpoint);
  expect(await readChineseWithFourByteBudget()).toMatchObject({text:'中',nextOffset:3,remainingBytes:3});
  await expect(readFromMiddleOfCodepoint()).rejects.toMatchObject({code:'INVALID_RANGE'});
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/workspace-service.test.ts apps/desktop/tests/workspace-diff.test.ts`；预期 FAIL。
- [ ] **Step 3 — 实现：** 拒绝根/主目录/系统/凭据目录，默认排除 `.git`、`node_modules`、`dist`、`build`、认证目录及 `.env*`、私钥类材料；不把识别规则宣称成完整敏感内容检测。用户确认预览清单才复制，重验选中指纹。基线和当前版本分开，写入全新 temporaryKey 后事务交换 checkpoint，再清理旧版本；崩溃恢复只依据拥有的 key。额外临时占用检查可用磁盘，不能无限快照。diff 基于 hash/类型，新/改/删/二进制都准确；导入/写回活动 Run 锁由主进程验证。文本 read 的 maxBytes 为 4–65,536，offset 按字节且必须落在字符边界；nextOffset 只跨过完整字符，尾部不拆坏中文；二进制不能被该工具误解码。
- [ ] **Step 4 — 绿灯：** 上述命令及附件回归；预期 PASS，未确认 preview 不复制，源目录没有改变，取消/崩溃保持旧检查点。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: manage authorized workspace snapshots and diffs"`。

### Task 7: Docker 安全策略、镜像准备与文件传输

**Files:** Create `packages/sandbox/{package.json,src/types.ts,src/policy.ts,src/docker-client.ts,src/image-service.ts,src/transfer.ts,src/index.ts}`、`packages/sandbox/image/{Dockerfile,runner.py,transfer.py}`；Modify `package-lock.json`、`apps/desktop/electron-builder.yml`；Test `packages/sandbox/tests/{policy,transfer,image-service}.test.ts`。

**Interfaces:** `SandboxProvider.detect():Promise<SandboxAvailability>;prepareImage(signal,onProgress):Promise<{imageId:string}>;execute(input:SandboxExecution):Promise<SandboxResult>;cancel(runId):Promise<void>;cleanupOwned():Promise<void>;shutdown():Promise<void>`，execute 在 Task 8 实现。`SandboxExecution={owner:{namespaceKey,sessionId,runId,callId},snapshotKey,command,cwd,signal,onEvent:(event:AgentEvent)=>Promise<void>}`；`SandboxResult={exitCode:number|null,reason,elapsedMs,truncated,snapshotKey:string|null}`，reason 与 command_finished 一致。`SandboxAvailability={available,reason:string|null,imageReady:boolean}`；DockerClient 固定 executable/context、参数数组和无秘密的最小环境。

- [ ] **Step 1 — 写失败测试：** 固定政策 flags、远程上下文、可变 tag、恶意输入参数、无支持限额、不可信文件流和无界 progress。
  ```ts
  expect(args).toEqual(expect.arrayContaining(['--network','none','--read-only','--cap-drop','ALL','--user','1000:1000']));
  expect(args).not.toContain('--privileged'); expect(args).not.toContain('-v'); expect(spawnOptions.shell).toBe(false);
  await expect(validateTransfer({relativePath:'../../secret'})).rejects.toMatchObject({code:'UNSAFE_PATH'});
  expect((await detectRemoteDocker()).available).toBe(false);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- packages/sandbox/tests/policy.test.ts packages/sandbox/tests/transfer.test.ts packages/sandbox/tests/image-service.test.ts`；预期 FAIL。
- [ ] **Step 3 — 实现：** sandbox 包仅 Node 内置 API/共享契约，不添加 SDK。Dockerfile 使用 Debian slim Node 22 基础、Python 3 与应用固定 helper，首次显式准备构建镜像并记录本地不可变 sha256 image ID/构建输入 hash；执行只用 image ID 和 pull=never。不从模型接受镜像名。文件传输采用 length-prefixed 元数据+原始字节，主进程重验实际大小/sha256/路径，不解压容器 tar；单条头 4 KiB、块 64 KiB、总量/条目/时间受 Global Constraints 限制。helper 只读可信 image 路径。镜像资产作为 extraResources 打包；prepare 的网络仅用于用户明确启动的可信镜像构建，不授予 Agent 网络。
- [ ] **Step 4 — 绿灯：** 上述单元命令及 typecheck；预期 PASS，创建参数包含 memory=1g、memory-swap=1g、pids=128、cpus=2、log-driver=none、/workspace tmpfs 1 GiB/16,384 inode、/tmp tmpfs 64 MiB、独立 namespace，无 socket/端口/宿主挂载；参数及实际 capability 检测缺失则不可用。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: define constrained Docker image and verified file transport"`。

### Task 8: 真实命令执行、限额、并发与取消

**Files:** Create `packages/sandbox/src/{docker-provider,execution-queue,owned-resources}.ts`、`vitest.sandbox.config.ts`；Modify `packages/sandbox/src/index.ts`、`image/runner.py`、`package.json`；Test `packages/sandbox/tests/{docker-provider,execution-queue}.test.ts`、`packages/sandbox/tests-integration/docker.integration.ts`。

**Interfaces:** `DockerSandboxProvider implements SandboxProvider` 消费 DockerClient、ImageService、共享 SandboxFileBridge，不导入 desktop 模块；执行先 checkout 导入，运行命令，再导出有界 snapshot；Workspace commit 由 Task 9 在二次授权/取消检查后执行。队列按 FIFO、最多 2 个运行，signal 取消移除等候项；进程内单调时钟从 command_started 起算。

- [ ] **Step 1 — 写失败测试：** fake process 验证并发、120 秒超时、1 MiB+1 字节输出、队列取消和清理范围；真实容器测网络、只读、UID、内存/进程/文件限额、后台子进程。
  ```ts
  expect(maxConcurrent).toBe(2); expect(cancelledQueuedCommandStarts).toBe(0);
  expect(result.reason).toBe('output_limit'); expect(outputBytes).toBeLessThanOrEqual(1024*1024);
  expect(await containerUid()).toBe(1000); expect(await rootWriteFails()).toBe(true);
  expect(await externalSocketConnectFails()).toBe(true); expect(await remainingOwnedContainers()).toEqual([]);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- packages/sandbox/tests/docker-provider.test.ts packages/sandbox/tests/execution-queue.test.ts`；预期 FAIL。集成入口先只检查 Docker/image，不偷偷安装；缺失以明确 unavailable 报告，不伪 PASS。
- [ ] **Step 3 — 实现：** 固定 `/bin/sh -lc` 仅容器内解析 command，cwd 相对 /workspace 且复核；命令文本输出与文件传输独立。实时 UTF-8 decoder 保留跨块、去无意义 ANSI/控制字节并纯文本输出；背压到 persist callback。runner 清理后台后才能导出；timeout/output_limit/cancel/oom 杀整个对应容器，不发布可提交 snapshot。非零 exit 可返回已校验 snapshot。owner 文件和 Docker 标签同时一致才清理；不存在全局 prune。inspect+cgroup/挂载主动验证限制，包括无额外 swap；无法验证则禁用。真实 quota 测试只用所属小配额 fixture 与真实默认配置检查，不用写满用户磁盘。
- [ ] **Step 4 — 绿灯：** 上述单元命令；明确准备测试镜像后 `npm run test:sandbox`（`vitest run --config vitest.sandbox.config.ts`）；预期真实集成 PASS，退出后测试容器数归零，外部哨兵与其他 Docker 资源不变。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: execute isolated commands with enforced limits and cancellation"`。

### Task 9: 审批工具网关与沙箱 Agent 闭环

**Files:** Create `apps/desktop/src/main/tools/{approval-service,workspace-tools}.ts`、`apps/desktop/src/main/ipc/approval-handlers.ts`、`apps/desktop/src/renderer/components/ApprovalCard.tsx`；Modify `apps/desktop/src/main/{tool-gateway,agent-service,worker-supervisor,index,feature-services,ipc}.ts`、`apps/desktop/src/preload/index.ts`、`packages/shared/src/desktop-api.ts`、`packages/agent-core/src/{tool-policy,tool-registry}.ts`、`apps/desktop/src/renderer/components/RunTrace.tsx`；Test `apps/desktop/tests/{approval-service,workspace-tools,tool-gateway}.test.ts`、`apps/desktop/tests/worker-supervisor.test.ts`、`tests/e2e/sandbox-agent.spec.ts`。

**Interfaces:** `ApprovalService.request(context:ToolContext,call:ToolCall,view:ApprovalRequestView,signal:AbortSignal):Promise<ApprovalDecision>;decide(n:Namespace,id:string,decision:ApprovalDecision):Promise<void>;revokeRun(n:Namespace,runId:string):void`。`AgentService.emit(context:ToolContext,event:AgentEvent):Promise<void>` 复用真实运行的 persist→publish 路径，拒绝 foreign/terminal；`registerWorkspaceTools(registry,{workspace,sandbox,approvals,store,persistEvent}):void` 注册 `workspace_list{cursor?}`、`workspace_read{path,offset,maxBytes}`、`workspace_write{path,text}`、`workspace_exec{command,cwd}`，persistEvent 为 AgentService.emit，store 用于读取 Run 当时目标模型。Gateway 的 execute 保留既有签名，得到已校验单次 grant 才绕过默认 mutating deny；时间工具仍无审批，文件 list 仅限已授权工作区且每页最多 100 条目。

- [ ] **Step 1 — 写失败测试：** 完整参数后才审批、批准后变参、外国/迟到批准、拒绝恢复模型、未知调用不重放、审批等待中 Worker 退出；fake clock 不计等待为命令耗时。
  ```ts
  expect(execStartsBeforeApprove).toBe(0); expect(run.status).toBe('waiting_approval');
  await expect(approveChangedArguments()).rejects.toMatchObject({code:'PERMISSION_DENIED'});
  expect(afterRejectTool.isError).toBe(true); expect(nextModelRequests).toBe(1);
  expect(await replayUnknownCall()).toEqual({code:'TOOL_UNRESOLVED'});
  await expect(exitWhileAwaitingApproval()).resolves.toMatchObject({status:'interrupted'});
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/approval-service.test.ts apps/desktop/tests/workspace-tools.test.ts apps/desktop/tests/tool-gateway.test.ts apps/desktop/tests/worker-supervisor.test.ts`；预期新流程 FAIL。
- [ ] **Step 3 — 实现：** reserve→persist approval→waiting_approval→批准/拒绝→复核→running；授权 hash 由主进程规范化参数生成，UI 无伪造覆盖入口。command_started/finished 控制命令计时，不以早于审批的 tool_started 算执行。输出和检查点先提交后发布。Worker 工具等待与 event ACK 不形成同一 queue 死锁；Worker exit 必须先 abort 挂起工具/审批再 drain，cancel 不等无限 Promise。批准后 snapshot 提交还需确认 Run 活跃和 revision 匹配；command reason 决定是否能提交。读取审批卡明确模型服务，写回不注册成工具。
- [ ] **Step 4 — 绿灯：** 上述命令、AgentRunner 回归、build:test 和 sandbox-agent E2E；预期实际批准后创建文件/读取/最终回复，拒绝无副作用，停止后无新命令且真实终态一致。恢复生产构建。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: require scoped approvals for workspace Agent tools"`。

### Task 10: 工作区面板、差异、冲突写回与恢复备份

**Files:** Create `apps/desktop/src/main/workspaces/export-service.ts`、`apps/desktop/src/renderer/components/{WorkspacePanel,WorkspaceDiff,ExportDialog}.tsx`、`apps/desktop/src/renderer/hooks/useWorkspace.ts`；Modify `apps/desktop/src/main/ipc/workspace-handlers.ts`、`apps/desktop/src/main/feature-services.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/{App,components/Composer}.tsx`、`apps/desktop/src/renderer/styles.css`、`packages/shared/src/desktop-api.ts`；Test `apps/desktop/tests/export-service.test.ts`、`tests/e2e/workspace.spec.ts`。

**Interfaces:** `ExportService.preview(n,sid,paths:string[]):Promise<{token:string;changes:WorkspaceDiff[];conflicts:string[]}>;apply(n,token,selections:{path:string;action:'write'|'delete'|'skip'}[]):Promise<ExportResult[]>;exportToChosenDirectory(n,sid,paths):Promise<ExportResult[]>;listBackups(n,workspaceId):Promise<BackupView[]>;restoreBackup(n,backupId):Promise<ExportResult>;removeBackups(n,ids):Promise<void>`。tokens 绑定归属/revision/指纹，TTL 60 秒一次性；`ExportResult={path,status:'written'|'deleted'|'skipped'|'conflict'|'failed',backupId:string|null,errorCode:string|null}`；BackupView 仅 ID、展示名、大小和时间，不公开备份宿主路径。

- [ ] **Step 1 — 写失败测试：** 外部修改、目标链接/父目录替换、二进制 diff、删除再确认、覆盖备份、1 GiB 备份超限、部分失败和恢复时再冲突；真实文件 UI 验证原目录执行期间未变。
  ```ts
  expect((await applyChangedOriginal())[0].status).toBe('conflict'); expect(await readOriginal()).toBe('外部编辑');
  expect(binaryDiff.binary).toBe(true); expect(await deleteWithoutConfirmation()).toEqual({denied:true});
  expect(await backupBytes()).toBeLessThanOrEqual(1024**3); expect(await restoreToFreshTarget()).toBe('原内容');
  expect(partialResults.map(r=>r.status)).toEqual(['written','failed']);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/export-service.test.ts`；预期 FAIL。
- [ ] **Step 3 — 实现：** UI 目录预览确认、文件树/改动和沙箱状态；活动 Run 锁所有写回入口。可信 ExportService 重验 hash、目录身份、snapshot revision、审批选择；按文件 backup→安全 replace/delete，不宣称全目录原子。备份独立存储不随会话删除；恢复同样需预览/目标确认且不覆盖新编辑。显示每文件真实结果、来源和可恢复 ID；支持显式备份管理，不静默清旧备份。主进程确认覆盖/删除，Renderer token 不能省略系统确认。另存缺失安全原子能力时只允许可验证的新目标，否则明确拒绝。
- [ ] **Step 4 — 绿灯：** 上述单元命令；build:test、`npx playwright test tests/e2e/workspace.spec.ts`；预期源目录只有确认写回后改变，冲突/越界路径保持原文件，重启后备份可恢复。恢复生产构建。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: preview workspace changes and confirm recoverable writeback"`。

### Task 11: 独立远程转写适配器与安全服务

**Files:** Create `packages/model-adapter/src/transcription.ts`、`apps/desktop/src/main/speech/transcription-service.ts`、`apps/desktop/src/main/ipc/speech-handlers.ts`、`apps/desktop/src/renderer/components/SpeechSettings.tsx`；Modify `packages/model-adapter/src/{endpoint,index}.ts`、`apps/desktop/src/main/{index,ipc,feature-services}.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/App.tsx`、`packages/shared/src/desktop-api.ts`；Test `packages/model-adapter/tests/transcription.test.ts`、`apps/desktop/tests/transcription-service.test.ts`；Create `tests/fixtures/transcription-server.ts`。

**Interfaces:** `normalizeTranscriptionEndpoint(baseUrl:string):URL`；`transcribeAudio({config:SpeechDraft,apiKey:string,audio:AudioSubmission,signal:AbortSignal}):Promise<string>`；以下 n 为 Namespace，sessionId/sid/operationId/apiKey 为 string、ownerWebContentsId 为 number、draft 为 SpeechDraft、audio 为 AudioSubmission：`TranscriptionService.get(n):Promise<SpeechView>;save(n,draft,apiKey?):Promise<SpeechView>;begin(n,sessionId,ownerWebContentsId):Promise<{operationId:string}>;submit(n,audio):Promise<{operationId:string;text:string}>;cancel(n,operationId):void;cancelSession(n,sid):void;shutdown():void`。操作 registry 绑定身份/session/WebContents/配置 revision；capture 获取权限 grant 的 60 秒与完整录音/转写生命周期分开，操作最长存活为 120 秒录音 + 已配置请求超时 + 30 秒收尾。begin 来自真实点击，由 Task 12 permission service 激活；密钥独立 SecretStore ref。

- [ ] **Step 1 — 写失败测试：** `/v1` 根/完整转写端点、JSON `.text`、multipart 实际 MIME+扩展名、HTML/超限/空文本/401/重定向、取消无重试、独立密钥、配置/身份在解密中变化。
  ```ts
  expect(normalizeTranscriptionEndpoint('https://asr.example/v1').pathname).toBe('/v1/audio/transcriptions');
  expect(receivedFields).toEqual(['file','model']); expect(receivedAudioMime).toBe('audio/webm');
  expect(requestCountAfterAbort).toBe(1); expect(JSON.stringify(view)).not.toContain(speechSecret);
  await expect(missingTextResponse()).rejects.toMatchObject({code:'ASR_PROTOCOL_ERROR'});
  ```
- [ ] **Step 2 — 红灯：** `npm test -- packages/model-adapter/tests/transcription.test.ts apps/desktop/tests/transcription-service.test.ts`；预期 FAIL。
- [ ] **Step 3 — 实现：** 独立 multipart fetch，不使用聊天 key/模型，不发可选 language/prompt/stream。默认 120,000 ms，配置范围 10–600,000 ms；检查 20 MiB 输入、WebM/MP4 magic 与 MIME/扩展名，响应 body 上限 1 MiB、`.text` UTF-8 上限 64 KiB。超时/取消与 HTTP 错误脱敏，redirect=error；配置 disabled 不开始。operation 防重放，配置 revision 和身份异步后再检查；同窗口最多 1 个录音/转写操作，音频临时内存不进历史。设置页展示最终 URL、服务目标、明文 HTTP 警告和 credentialState。
- [ ] **Step 4 — 绿灯：** 同一测试命令及凭据回归/typecheck；预期 PASS。本任务只 fixture 联调，不从用户已保存 key 发测试请求；协议依据 [OpenAI 文件转写](https://developers.openai.com/api/docs/guides/speech-to-text)，不声明第三方真实兼容。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: configure isolated remote audio transcription"`。

### Task 12: 最小麦克风权限、录音与语音草稿 UI

**Files:** Create `apps/desktop/src/main/speech/media-permissions.ts`、`apps/desktop/src/renderer/hooks/{useVoiceInput,voice-recorder}.ts`、`apps/desktop/src/renderer/components/VoiceInput.tsx`；Modify `apps/desktop/src/main/{index,feature-services}.ts`、`apps/desktop/src/main/ipc/speech-handlers.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/components/Composer.tsx`、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/electron-builder.yml`、`packages/shared/src/desktop-api.ts`；Test `apps/desktop/tests/{media-permissions,voice-recorder}.test.ts`、`tests/e2e/voice-input.spec.ts`。

**Interfaces:** `MediaPermissionService.beginCapture(n,sid,wc):Promise<{operationId:string}>;check(wc,permission,origin,details):boolean;request(wc,permission,callback,details):void;revoke(operationId):void`。消费 Task 11 begin/cancel；`VoiceRecorder.start(mime):Promise<void>;stop():Promise<{mimeType,bytes}>;cancel():void` 注入 getUserMedia/MediaRecorder；`useVoiceInput(sessionId)` 返回状态、duration、transcript 和 start/stopAndTranscribe/cancel/insert。无会话时先按所选聊天模型创建空会话，不把未绑定录音发往服务。

- [ ] **Step 1 — 写失败测试：** 没有按钮授权、外国/null WebContents、iframe、video/unknown、组合摄像头请求均拒绝；录音超时/超量/设备消失、取消/迟到数据，输入未覆盖。
  ```ts
  expect(permissions.check(wc,'media',origin,{isMainFrame:true,mediaType:'video'})).toBe(false);
  expect(permissions.check(null,'media',origin,{isMainFrame:true,mediaType:'audio'})).toBe(false);
  expect(cameraRequestGranted).toBe(false); expect(stoppedTrackCount).toBe(allTrackCount);
  expect(draftAfterLateTranscript).toBe('用户新输入'); expect(sentMessageCount).toBe(0);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/media-permissions.test.ts apps/desktop/tests/voice-recorder.test.ts`；预期 FAIL。
- [ ] **Step 3 — 实现：** 同时装 check/request handlers，只给预期 wc 主 frame/origin、显式 capture grant、audio-only；缺少详情 fail closed，其余权限继续拒绝。macOS 显式调用 microphone consent，`NSMicrophoneUsageDescription` 文案说明点击录音及发送到用户配置服务，不增加 camera 用途。真实格式按 isTypeSupported 选 WebM/Opus 或 MP4，chunks 实时计字节，120 秒/20 MiB 超限停且不自动上传；stop/cancel/error/unmount 统一 stop tracks。转写文字先单独展示，插入动作附加当前草稿不替换；session+operation token 守卫，切会话取消并清理数据。仅测试模式允许 fake audio input flags，不放松生产权限/CSP。
- [ ] **Step 4 — 绿灯：** 单元命令、build:test、`npx playwright test tests/e2e/voice-input.spec.ts`；预期 E2E multipart 请求、停止/取消/插入、音轨释放与迟到丢弃 PASS；恢复生产构建。真实麦克风和用户 ASR 另列手动验收，不用 fake device 声称实机通过。API 依据 [Electron 权限](https://www.electronjs.org/docs/latest/api/session)、[mediaTypes](https://www.electronjs.org/docs/latest/api/structures/media-access-permission-request)、[macOS 媒体授权](https://www.electronjs.org/docs/latest/api/system-preferences)。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: record bounded microphone input into editable speech drafts"`。

### Task 13: 中断恢复、删除和退出的资源生命周期

**Files:** Create `apps/desktop/src/main/session-lifecycle.ts`；Modify `apps/desktop/src/main/{index,ipc,agent-service,worker-supervisor,feature-services}.ts`、`packages/storage/src/run-repository.ts`；Test `apps/desktop/tests/session-lifecycle.test.ts`、`tests/e2e/workspace-recovery.spec.ts`。

**Interfaces:** `SessionLifecycle.remove(n,sid):Promise<void>;revokeNamespace(n):Promise<void>;recover():Promise<void>;shutdown():Promise<void>`。`createFeatureServices({store,secrets,principal,window,artifactRoot,safeFiles,sandbox,publish})` 返回前面命名的附件/工作区/审批/转写/导出服务；构造依赖不读取秘密到 DTO，不允许 Renderer 注入 Provider。所有新增 handler 通过既有 authorizeSender+严格 inputs 路由，未知 channel 默认拒绝。

- [ ] **Step 1 — 写失败测试：** pending approval+Worker exit、queued Docker+会话删除、ASR secret await+退出、第二实例和 FOREIGN owner，备份与源目录保留。
  ```ts
  await expect(lifecycle.shutdown()).resolves.toBeUndefined(); expect(pendingApprovals).toEqual([]);
  expect(await originalFiles()).toEqual(originalBaseline); expect(await retainedBackupIds()).toEqual(savedBackupIds);
  expect(await recoveryExecCount()).toBe(0); expect(await foreignContainersRemoved()).toBe(0);
  expect(recovered.status).toBe('interrupted'); expect(recovered.elapsedMs).toBe(lastTimingCheckpoint);
  ```
- [ ] **Step 2 — 红灯：** `npm test -- apps/desktop/tests/session-lifecycle.test.ts`；预期 FAIL，无完整资源协调。
- [ ] **Step 3 — 实现：** 获得 single-instance lock 后才恢复/清理；先撤销 input/audio/approval grants，abort ASR+排队/执行沙箱，释放 Worker 等待，再删关联 DB/拥有的快照。停止无法确认时禁止删资源/消息并反馈错误。崩溃只恢复最后 checkpoint，撤销审批并中断记录；备份独立于 Session FK，不随会话删除。退出等待有界清理（现有 Worker 2 秒 kill 路径保留），清理失败记 owned tombstone 下次重试，不使用无归属路径。测试 env/服务注入只在 __TEST_BUILD__，生产无通用测试资源清理入口。
- [ ] **Step 4 — 绿灯：** 单元命令、build:test、`npx playwright test tests/e2e/workspace-recovery.spec.ts tests/e2e/session-recovery.spec.ts tests/e2e/security.spec.ts`；预期 PASS，重启/第二实例无新命令且现有 namespace/来源安全测试不回退。恢复生产构建。
- [ ] **Step 5 — 提交：** 仅本任务文件；`git commit -m "feat: recover and clean owned workspace and speech resources safely"`。

### Task 14: 联合安全验收、打包和可复现实测记录

**Files:** Modify `tests/e2e/{desktop,security,workspace,voice-input,sandbox-agent}.spec.ts`、`playwright.config.ts`、`.github/workflows/verify.yml`、`README.md`、`apps/desktop/electron-builder.yml`；Create `docs/superpowers/reviews/2026-09-28-chat-workspace-voice-verification.md`。

**Interfaces:** 用既有 Electron `_electron.launch`，fixture 模型/ASR、临时 userData/文件目录、所属 Docker 标签，不读取或调用真实 key；测试构建与开发构建若共享 out，在隔离目录顺序执行，最后恢复 production。保持所有现有 E2E 用例，不以减少旧测试达成 PASS。

- [ ] **Step 1 — 写失败回归测试：** 串联选择模型→附件/目录→公开思考→批准命令→实时输出/耗时→差异→冲突/写回→重启→语音插入；核查能力降级、纯文本安全、凭据和 production 测试入口。
  ```ts
  await expect(page.getByTestId('command-output')).toContainText('真实命令输出');
  await expect(page.locator('.run-trace')).not.toContainText('API_KEY_SENTINEL');
  expect(await unsafeHtmlSideEffects()).toBe(false); expect(await rawCredentialOnDisk()).toBe(false);
  expect(await queuedCancellationLeavesProcesses()).toBe(false); expect(await secondInstanceExecs()).toBe(0);
  ```
- [ ] **Step 2 — 验证测试能发现问题：** build:test 后跑目标 E2E，并在 fixture 注入配置变化、缺 Docker、HTML ASR、外部写回冲突和迟到音频，预期每个负向用例断言明确阻止危险行为；失败必须先定位，不跳过或弱化。
- [ ] **Step 3 — 完成集成和交付文档：** 修复仅相关集成问题；将 UI 操作、镜像显式准备、二进制边界、断网/限额、写回恢复、语音服务配置和平台限制写入 README。production 打包包含可信 helper/镜像资产及麦克风用途信息，测试环境变量/fake device 注入不生效；CI 先 build:safe-files 再运行现有三平台 typecheck/test/build，Windows 测试明确验证 helper 不可用时拒绝安全写回而不是假装实现 POSIX 操作。Linux Docker 专用作业显式提供运行条件，未实际运行的矩阵不称已验证。
- [ ] **Step 4 — 全量验证与独立审查：** 依次 `npm run typecheck`、`npm test`、`npm run test:sandbox`、`npm run test:e2e`、`npm run build`、`npm run package:dir`、`git diff --check`；预期全部可运行检查 PASS，实际数量/输出/已知环境 warning 记录，不预填数量。打包 App 以临时 userData 启动验证；真实麦克风与用户提供 ASR 只有收到配置并完成时才记通过，否则明确未验收。按 Native/执行技能派一次独立全量审查，修复意见后重跑受影响检查；不推送、创建 PR 或发布。
- [ ] **Step 5 — 提交与交付：** 仅本任务文件；`git commit -m "test: verify workspace trace speech safety and desktop packaging"`。交付改动、实际验证、仍需真实服务/平台验收的部分；开发 App 重启/展示与分支整合遵循用户选择，不覆盖原工作目录编辑。

## 计划自审与覆盖索引

| 设计要求 | 负责任务 |
| --- | --- |
| §3 进程/接口/身份；§11 迁移与安全 | 1、4、5、9、11、13、14 |
| §4 布局、草稿、左右气泡和操作状态 | 3、5、10、12、14 |
| §5 思考、事件提交、历史归属、计时 | 1、2、3、8、9、13 |
| §6 附件、二进制边界、预算、发送目的地 | 4、5、6、9、14 |
| §7 导入/基线/检查点/差异/写回/备份 | 4、6、8、9、10、13 |
| §8 Docker、实际资源限制、网络、审批 | 7、8、9、13、14 |
| §9 远程 ASR、麦克风、隐私、迟到处理 | 1、11、12、13、14 |
| §10 模型切换、版本锁、历史兼容 | 1、2、3、5 |
| §12 验收 1–12 与平台声明 | 14 汇总上述测试与真实验收 |

自审要求：以上 DTO、方法和事件名贯穿 Tasks 保持一致；每个任务有先失败后通过的具体验证；Review Focus 五类都有任务测试；本文不包含产品实现函数体或无决定性的占位步骤。附件授权与源目录写回不能用客户端声明替代；Worker queue 退出等待不能让审批 Promise 永久阻塞；文件传输和命令输出两条通道限额不能混用；新 key 与真实服务调用没有隐藏在验收脚本中。

本文完成与本地提交只表示实施计划已编制；用户批准后才能开始 Task 1，沿用 Native 执行方式。
