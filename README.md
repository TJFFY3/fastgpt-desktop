# FastGPT Desktop Agent

Electron + React + TypeScript 桌面 Agent。当前交付为已确认计划的**阶段 A：模型、会话和受控 Agent 运行基础**，不是全部七项需求的最终版本。

## 本阶段能力

- 配置 OpenAI Chat Completions 兼容模型：API 根地址或完整端点、模型 ID、密钥、上下文窗口、输出上限、超时及可选参数能力；连接与工具能力探测。
- 流式文本与工具参数解析；受控工具循环；当前唯一内置工具是只读 `get_current_time`。
- SQLite 会话持久化，搜索、重命名、置顶、归档、删除；消息、运行事件与工具结果保留。
- 同一会话仅一个活动运行；不同会话可并行；取消、中断与重启恢复，不自动重放结果未知的工具调用。
- 本地身份命名空间隔离、受限桌面接口、纯文本消息渲染、无 Node 权限的沙箱页面。
- macOS/Windows 安全密钥库可用时存储密文；失败时仅进程内存保存。Linux 当前保守采用会话内存，重启需重填密钥；不启用明文磁盘降级。

## 启动

需要 Node.js ≥ 22.12（本机验证 22.23.2）和 npm。阶段 A 无需 Docker。

```bash
npm ci
npm run dev
```

首次打开“模型设置”，填写模型名称、API 地址、模型 ID 和 API Key，保存后测试连接，再新建会话。编辑时密钥不回显，留空会保留原密钥；提示缺失时需重新填写。

Base URL 为 `https://example.com/v1` 时请求地址为 `/v1/chat/completions`；不会自动添加 `/v1`。只允许无 URL 凭据、query 和 fragment 的 HTTP/HTTPS 地址。HTTP 必须显式允许，仅适用于可信服务；不关闭 TLS 验证。未确认工具或 temperature 能力时保持关闭；按服务要求选择 `max_tokens` 或 `max_completion_tokens`。

上下文窗口目前是模型配置元数据；阶段 A 不自动压缩或截断历史，超长上下文可能被模型拒绝。建议为长任务新建会话，压缩与记忆由阶段 B 实现。

Enter 发送、Shift+Enter 换行，中文输入法组合输入不触发发送。删除会话会先停止活动任务，并删除该会话的消息与运行记录，需要确认。

## 验证与开发包

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run package:dir
```

E2E 自动构建独立测试模式，启动真实 Electron + SQLite + utility process，使用随机本地端口的模型测试服务和临时数据目录。仅测试构建允许 `FASTGPT_DESKTOP_TEST_DATA_DIR` 和最多两秒的启动延迟设置（复现密钥库异步响应时快速切换会话的竞态），并强制会话内存密钥以免触碰系统钥匙串。生产构建会移除测试覆盖和开发地址读取；不包含内置 mock 模型或通用执行接口。

`package:dir` 会先重建生产模式，再在 `release/` 生成本机未签名目录包；不上传、不发布。macOS 产物为 `release/mac-arm64/FastGPT Desktop.app`（对应本机架构）。不建议分发测试构建。

当前已在 macOS ARM64 做真实桌面验证。CI 配置覆盖 macOS/Windows/Linux 的类型检查、单元测试和构建，E2E 先在 macOS 执行；Windows/Linux 尚未在对应实际运行环境验收，不据此宣称跨平台发行完成。Node 22 的 SQLite ExperimentalWarning 是已知环境提示。

## 架构和安全边界

界面只消费 `DesktopApi`；preload 不暴露通用 IPC、文件或命令能力。主进程持有身份、数据库、密钥与工具授权；utility process 运行已打包可信 Agent 代码，事件提交后才通知界面。业务数据按实例/账号/团队隔离。原始 API Key 不属于模型配置 DTO 或运行输入记录。

生产页面使用 `app://desktop` 和限制网络的 CSP；仅预期窗口的主 frame 可调用严格校验的业务接口。工具在执行前验证参数和权限，未知工具与有副作用工具默认拒绝。单次运行最多 12 轮模型请求、24 次工具调用，单个工具结果最多 1 MiB。429/503 仅在收到输出前最多重试两次；认证失败、协议错误或取消不重试。

可信 Agent 进程**不是不可信代码沙箱**。当前不支持 shell、宿主机文件执行或用户 Skill 脚本。聊天消息和工具结果本地保存，但不做内容加密；API Key 单独采用安全存储/内存策略。请通过操作系统账号与磁盘加密保护本机数据。

目录：`apps/desktop/src/{main,preload,worker,renderer}`；共享契约在 `packages/shared`，存储在 `packages/storage`，协议在 `packages/model-adapter`，Agent 循环在 `packages/agent-core`。

## 后续范围与外部联调

### FastGPT 云端资源列表

Agent 广场和知识库读取远端授权资源，不再用本地模型配置作为云端 Agent。
在任一页面点击「连接 FastGPT」，填写 HTTPS API 根地址（云端为 `https://cloud.fastgpt.cn/api`）和 API Key。
凭据由主进程通过系统安全存储加密保存；安全存储不可用时仅在当前进程内存保留，重启后需重新填写。
渲染层不能回读密钥，数据库只保存连接地址与凭据引用。

列表权限对应 API Key 所属账号及团队，不是独立用户登录或 SSO。

创建远程会话使用主进程从可读目录取得的应用元数据，不依赖要求网页登录态的应用编辑详情接口；实际执行权限由 FastGPT 对话接口校验。更换凭据后，必须刷新目录重新选择应用，旧连接的目录缓存不能用于新连接。
当前接入 `/core/app/listV2` 和 `/core/dataset/listV2`，支持目录、名称/简介搜索、分页、刷新与断开连接。
Agent 广场显示文件夹及 simple/chatAgent/advanced 应用，不将插件、工具集作为可对话 Agent。
应用卡片的「开始对话」创建远程文本会话，通过 `/v1/chat/completions` 明确传入应用 ID 和固定的远端 chatId；每轮只发送新增文本，云端负责历史、模型及工作流，不用本地模型替代。
支持流式回答、本机历史、刷新后续聊、收藏和停止请求；失败或停止时将已收到的回答保存为不完整内容，绝不自动重试可能有副作用的工作流。
「停止生成」取消桌面端请求，不保证撤销已经执行的云端工具操作。表单/选项交互、文件、变量配置、引用来源展示，以及知识库文档浏览和内容检索暂不支持。
远程应用会话不能切换为本地模型或其他应用。更换地址、API Key 或断开连接会取消活动远程请求并使旧目标凭据失效；旧历史仍可查看，请从 Agent 广场创建新的会话以使用新连接，避免跨账号复用远端历史。
接口依据云端 [System OpenAPI](https://cloud.fastgpt.cn/apidoc/systemopenapi) 与 [Dev API](https://cloud.fastgpt.cn/apidoc/devapi)，应用列表虽未列于 System OpenAPI，但已通过云端 API Key 实测。

- B：自动上下文压缩、短期/长期记忆，以及检索和用户管理。
- C：本地 Docker 工作区隔离、资源与网络限制；Skill 导入/导出、校验、授权、沙箱执行。
- D：FastGPT 社区版与商业版工作流/Agent 调用；需确认真实版本、服务地址与 API 授权。
- E：FastGPT SSO、身份映射与服务器端资源授权；商业版 SSO 与社区版接入桥接需分别验证，不假设社区版具有商业版原生 SSO 接口。
- F：联合验收、平台实测、签名与正式发行。

没有真实模型凭据、FastGPT 实例或 SSO 配置时，本地协议测试不能替代这些外部验收。

已知次要显示问题：模型在调用工具前完成的解释文字，可能在后续模型请求期间暂时不显示；运行结束后会从已保存历史完整恢复，不丢失数据。后续可改为逐条合并已提交的消息事件。

详见 [架构设计](docs/superpowers/specs/2026-09-28-fastgpt-desktop-agent-design.md) 与 [阶段 A 计划](docs/superpowers/plans/2026-09-28-phase-a-agent-foundation.md)。

本次实际检查结果、独立审查修复和执行决策见 [阶段 A 验收记录](docs/superpowers/reviews/2026-09-28-phase-a-verification.md)。
