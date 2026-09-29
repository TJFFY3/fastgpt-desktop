# FastGPT Desktop Agent

Electron + React + TypeScript 桌面 Agent。当前包括阶段 A 基础，以及对话轨迹、文件工作区、受控 Docker 执行和远程语音输入扩展；不是全部七项需求的最终版本。

## 本阶段能力

- 配置 OpenAI Chat Completions 兼容模型：API 根地址或完整端点、模型 ID、密钥、上下文窗口、输出上限、超时及可选参数能力；连接与工具能力探测。
- 流式文本与工具参数解析、受控工具循环；只读时间工具，以及经单次审批的 `workspace_read`、`workspace_write`、`workspace_exec`。
- 用户消息靠右、回复靠左，不显示角色标签；每次运行保留当时模型、工具、命令、实时输出、退出码和耗时。公开思考仅展示服务实际返回的 `reasoning_content`，需在模型设置开启，不生成或推测隐藏思考。
- SQLite 会话持久化，搜索、重命名、置顶、归档、删除；消息、运行事件与工具结果保留。
- 同一会话仅一个活动运行；不同会话可并行；取消、中断与重启恢复，不自动重放结果未知的工具调用。
- 本地身份命名空间隔离、受限桌面接口、纯文本消息渲染、无 Node 权限的沙箱页面。
- macOS/Windows 安全密钥库可用时存储密文；失败时仅进程内存保存。Linux 当前保守采用会话内存，重启需重填密钥；不启用明文磁盘降级。

## 启动

需要 Node.js ≥ 22.12（本机验证 22.23.2）和 npm；文件操作还需 POSIX C 编译器。普通聊天无需 Docker；命令执行需要本地 Linux Docker 引擎、cgroup v2 和明确准备可信镜像。

```bash
npm ci
npm run build:safe-files
npm run dev
```

首次打开“模型设置”，填写模型名称、API 地址、模型 ID 和 API Key，保存后测试连接，再新建会话。编辑时密钥不回显，留空会保留原密钥；提示缺失时需重新填写。

Base URL 为 `https://example.com/v1` 时请求地址为 `/v1/chat/completions`；不会自动添加 `/v1`。只允许无 URL 凭据、query 和 fragment 的 HTTP/HTTPS 地址。HTTP 必须显式允许，仅适用于可信服务；不关闭 TLS 验证。未确认工具或 temperature 能力时保持关闭；按服务要求选择 `max_tokens` 或 `max_completion_tokens`。

上下文窗口目前是模型配置元数据；阶段 A 不自动压缩或截断历史，超长上下文可能被模型拒绝。建议为长任务新建会话，压缩与记忆由阶段 B 实现。

Enter 发送、Shift+Enter 换行，中文输入法组合输入不触发发送。删除会话会先停止活动任务，并删除该会话的消息与运行记录，需要确认。

## 对话、文件与语音

空闲会话可在顶部选择模型；运行或录音期间锁定。修改模型配置会使旧版本的准备请求失效。每个会话保留自己的草稿和附件，切换会话不合并草稿。

“添加文件”或原生文件拖入只复制到本地私有快照；发送时才向当前模型传递文本摘录和文件信息。单文件最多 20 MiB；文本摘录最多 64 KiB，二进制文件正文不直接上传、不承诺图片/PDF/Office 自动理解。发送目的地显示在输入区；按上下文预算拒绝超限，不静默截断历史。

“工作区”→选择文件夹→查看排除项及大小→创建隔离副本。默认排除 `.git`、`.env` 等敏感项；拒绝链接、硬链接、特殊文件、不规范或碰撞路径。目录最多 10,000 项、单文件 100 MiB、总量 1 GiB。源目录不挂载到容器，副本内改动不会自动覆盖原文件。

点击沙箱状态并“准备沙箱”是唯一镜像构建入口；可能下载可信基础镜像。执行时固定镜像 ID、禁止网络、只读根文件系统、无提权和 Docker socket，默认 CPU 2、内存 1 GiB、进程 128、120 秒、输出 1 MiB，私有工作区 tmpfs 1 GiB。全局两路 FIFO；每次命令先显示完整参数与目的地，批准仅对当前调用有效。停止会撤销审批并清理所属容器；无法确认停止时保留记录并报告错误，不删除其他容器、不自动重放未知结果。

工作区差异面板支持逐文件预览、确认写回或导出。源文件外部修改、目录替换或版本变化会阻止写回；覆盖/删除前保留独立备份，删除会话不会删除源目录或备份。备份管理可查看和恢复已删除会话的备份；永久删除备份需单独系统确认。备份默认上限 1 GiB / 10,000 项，不静默淘汰。

写回不是多文件事务，也不提供跨进程 compare-and-swap；请暂停其他程序写入该目录。存在最终检查与原子替换间的窄竞态，不能承诺并发编辑零覆盖；已落盘但同步失败会明确提示并保留备份。

“语音设置”独立配置 OpenAI 兼容 `/audio/transcriptions` 服务、模型、密钥和超时，默认 HTTPS；聊天密钥不复用。点击录音才申请麦克风，最长 120 秒/20 MiB；取消不上传，停止后释放音轨并发送编码音频，转写文字可编辑、明确插入现有草稿，不自动发送。切换会话、撤销授权、退出或配置变更取消旧请求，迟到结果不插入；音频不写入聊天历史或磁盘。获取设备最多等候 60 秒。

真实麦克风设备链路及用户 ASR 服务尚未验收：本机 Chromium 虚拟 getUserMedia 也出现挂起，语音自动测试使用明确标注的合成音源，但保留真实 MediaRecorder、编码和传输。发布前必须完成实际设备、系统权限及真实服务联调，不能把自动测试通过等同于录音可用。

## 验证与开发包

```bash
npm run typecheck
npm test
npm run prepare:sandbox # 显式下载/构建可信测试镜像
npm run test:sandbox    # 真实本地 Docker，不可用则失败，不跳过
npm run build
npm run test:e2e
npm run package:dir
npx playwright test --config playwright.package.config.ts # 本机 macOS 目录包
```

E2E 自动构建独立测试模式，启动真实 Electron + SQLite + utility process，使用随机本地端口的模型测试服务和临时数据目录。仅测试构建允许 `FASTGPT_DESKTOP_TEST_DATA_DIR` 和最多两秒的启动延迟设置（复现密钥库异步响应时快速切换会话的竞态），并强制会话内存密钥以免触碰系统钥匙串。生产构建会移除测试覆盖和开发地址读取；不包含内置 mock 模型或通用执行接口。

`package:dir` 会先重建生产模式，再在 `release/` 生成本机未签名目录包；不上传、不发布。macOS 产物为 `release/mac-arm64/FastGPT Desktop.app`（对应本机架构）。不建议分发测试构建。

当前实测为 macOS ARM64 + 本地 Docker Linux 引擎。CI 配置覆盖三平台类型检查/单元测试/构建；真实 Docker 与完整 Electron 联合测试需手动触发专用 Linux 作业（run_docker），不以无 Docker 的普通 runner 假装通过。Windows 安全文件 helper 尚未实现，文件导入/写回拒绝执行；普通聊天仍可用。Windows/Linux 桌面、签名、公证和真实语音尚未验收。SQLite ExperimentalWarning、Rollup 注释和测试色彩设置提示均记录于验收文档。

## 架构和安全边界

界面只消费 `DesktopApi`；preload 不暴露通用 IPC、文件或命令能力。主进程持有身份、数据库、密钥与工具授权；utility process 运行已打包可信 Agent 代码，事件提交后才通知界面。业务数据按实例/账号/团队隔离。原始 API Key 不属于模型配置 DTO 或运行输入记录。

生产页面使用 `app://desktop` 和限制网络的 CSP；仅预期窗口的主 frame 可调用严格校验的业务接口。工具在执行前验证参数和权限，未知工具与有副作用工具默认拒绝。单次运行最多 12 轮模型请求、24 次工具调用，单个工具结果最多 1 MiB。429/503 仅在收到输出前最多重试两次；认证失败、协议错误或取消不重试。

可信 Agent 进程不是不可信代码沙箱；命令只在上述 Docker 副本执行，没有宿主机 shell 接口，用户 Skill 脚本尚未接入。聊天消息、文件快照和工具结果本地保存但不做内容加密；API Key 单独采用安全存储/内存策略，请使用操作系统账号与磁盘加密保护本机数据。

目录：`apps/desktop/src/{main,preload,worker,renderer}`；共享契约在 `packages/shared`，存储在 `packages/storage`，协议在 `packages/model-adapter`，Agent 循环在 `packages/agent-core`。

## 后续范围与外部联调

- B：自动上下文压缩、短期/长期记忆，以及检索和用户管理。
- C：Docker 工作区隔离已由本次扩展实现；Skill 导入/导出、校验、授权和执行仍待实现。
- D：FastGPT 社区版与商业版工作流/Agent 调用；需确认真实版本、服务地址与 API 授权。
- E：FastGPT SSO、身份映射与服务器端资源授权；商业版 SSO 与社区版接入桥接需分别验证，不假设社区版具有商业版原生 SSO 接口。
- F：联合验收、平台实测、签名与正式发行。

没有真实模型凭据、FastGPT 实例或 SSO 配置时，本地协议测试不能替代这些外部验收。

已知次要显示问题：模型在调用工具前完成的解释文字，可能在后续模型请求期间暂时不显示；运行结束后会从已保存历史完整恢复，不丢失数据。后续可改为逐条合并已提交的消息事件。

详见 [架构设计](docs/superpowers/specs/2026-09-28-fastgpt-desktop-agent-design.md) 与 [阶段 A 计划](docs/superpowers/plans/2026-09-28-phase-a-agent-foundation.md)。

本次实际检查结果、独立审查修复和执行决策见 [阶段 A 验收记录](docs/superpowers/reviews/2026-09-28-phase-a-verification.md)。

本次扩展的验证、设备/平台限制及独立审查见 [对话工作区语音验收记录](docs/superpowers/reviews/2026-09-28-chat-workspace-voice-verification.md)。
