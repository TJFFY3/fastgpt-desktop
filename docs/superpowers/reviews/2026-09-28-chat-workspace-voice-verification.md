# 对话轨迹、隔离工作区与语音扩展验收记录

实施依据：已批准的 [设计](../specs/2026-09-28-chat-workspace-voice-design.md) 和 [14 项计划](../plans/2026-09-28-chat-workspace-voice.md)。原始基线 `205f705`，在独立 managed worktree 实施，未覆盖原工作目录、原运行应用、真实数据库或用户密钥；未推送、合并、创建 PR、签名或发布。

## 实测范围

本机 macOS ARM64、Node 22.23.2、Electron 44.4.5；本地 Docker Desktop Linux arm64 引擎 29.7.2 / cgroup v2。模型与 ASR 使用随机 loopback 端口的测试服务，仅测试密钥；所有应用、输入和源文件均使用本次创建的临时目录。真实 Electron / SQLite / utility process / POSIX helper / Docker 执行并非 UI 桩。

任务 13 最终检查：类型检查通过，42 文件 / 219 单元测试通过，19 Electron 测试通过，生产构建与差异空白检查通过。任务 14 最终顺序实测：类型检查通过，42 文件 / 219 单元测试，3/3 真实 Docker 集成，20/20 Electron，生产构建、macOS ARM64 目录包、1/1 生产包原生启动及安全文件操作、差异空白检查均通过。现有用例未移除或跳过。

联合案例串联实际模型切换、根 URL 请求、附件摘录、目录副本、服务公开思考、审批卡、真实 shell 输出/耗时、文件差异、外部写入冲突拒绝、显式写回备份、重启检查点、独立 ASR 及保留草稿的文字插入。HTML 形状的思考/命令输出/回答/转写始终为文本，没有 DOM 图片/事件执行，没有密钥进入事件或 SQLite 明文。临时 native picker/confirmation 是受控外部边界。

既有负向测试全部保留：配置变更和解密延迟不得以旧模型启动；错误来源/命名空间不得越权；会话切换丢弃迟到启动及 ASR；未知工具、Worker 伪造主进程事件、权限过期/重复批准被拒；审批撤销无副作用；Docker 缺失/镜像不足拒绝命令但普通聊天可用；无法确认停止保留消息与 checkpoint；第二实例不恢复/写入。源文件/父目录替换、链接/硬链接、UTF-8 边界及规范化碰撞、限额/无限输出、OOM/进程/tmpfs 限制、后台清理、取消和非零退出有对应行为测试。

重启采用真实主进程 SIGKILL，再启动只恢复最后 checkpoint 与 elapsedMs，撤销 pending/approved 审批且不重放命令；仅删除 UUID+device/inode 所属 orphan，故意伪造归属的外部 sentinel 保持不变。删除会话等待 Worker/Docker/传输停止；原目录、独立备份保留，备份仍可发现并经原生确认恢复。消息已接受后读取失败会清空已消费草稿附件并明确提醒不要重复发送。

## 语音明确限制

真实麦克风和用户 ASR 尚未验收。本机 getUserMedia 在 Chromium 虚拟设备模式及独立 localhost 页面中挂起，即使临时放宽检查仍挂起；这些诊断放宽均已撤销，生产仍采用当前窗口/主 frame/来源/身份/会话绑定的单次 audio-only 权限，缺少元数据默认拒绝，摄像头/屏幕等不授权。

自动测试明确使用 WebAudio 合成输入边界，实际 MediaStream/track/MediaRecorder/WebM 编码/Blob/multipart/ASR 服务/草稿 UI 保持真实；停止/取消后检查真实 track.readyState=ended。它不能证明操作系统权限与真实输入设备集成可用。60 秒设备获取取消、120 秒录音与 20 MiB 上限、60 秒原生权限等候、配置超时和退出取消均有限界。

发布前人工验收：真实设备首次允许/拒绝、权限撤销、拔除设备、取消时系统权限弹窗、完成转写、录音中切换会话、转写期间继续输入及真实 ASR 错误。不得基于合成音频结果宣称录音已交付可用。

## 写回与平台边界

私有源 root 身份、验证目录句柄、完整 fingerprint、单文件原子替换和独立备份共同防护越界和已发生冲突，但不是跨进程 CAS 或多文件事务。外部写入者可能在最后检查与 rename/unlink 之间修改同名文件；用户必须暂停外部写入，系统确认提示此限制。任务 10 的该裁定交给最后独立审查评估，不隐瞒残余风险。

Windows POSIX helper 尚不可用，文件导入/写回拒绝执行，不回退普通 filesystem 写入；相关缺组件拒绝测试在三平台 CI 运行。Windows/Linux 真机桌面、签名、公证、正式发行和真实语音没有在本次验收，不因 CI 配置存在而称已验证。FastGPT 工作流/Agent、社区/商业 SSO、压缩记忆和 Skill 管理依然是后续范围。

## 生产包隔离检查

目录包不签名、不发布。打包包含可信 native helper 与 sandbox-image 的 Dockerfile/runner.py/transfer.py/.dockerignore，macOS Info.plist 仅说明麦克风用途，不增加摄像头用途。使用 Electron 原生 `--user-data-dir=<本次临时目录>`，不依赖生产已移除的 TEST_DATA_DIR；实际断言 app.isPackaged、app.asar、userData、app:// 来源、测试 fake-device 标志不启用、忽略测试路径/延迟/开发地址。只保存无密钥模型用于文件验证，未写入系统钥匙串。

隔离依据为 [Electron v44.4.5 原生启动源码](https://github.com/electron/electron/blob/v44.4.5/shell/app/electron_main_delegate.cc#L237) 将 switch 绑定 chrome::DIR_USER_DATA，及 [app.getPath 映射](https://github.com/electron/electron/blob/v44.4.5/shell/browser/api/electron_api_app.cc#L399)。测试对 macOS /var→/private/var 的同一临时目录先 canonicalize，不改变生产权限。

## 可复现检查及环境提示

顺序执行：`npm run typecheck` → `npm test` → `npm run test:sandbox` → `npm run test:e2e` → `npm run build` → `npm run package:dir` → `npx playwright test --config playwright.package.config.ts` → `git diff --check`。首次测试前需 `npm run build:safe-files` 和明确 `npm run prepare:sandbox`。共享 out 时严格顺序，不同时重建开发/测试/生产资源。

已知环境提示：Node SQLite experimental；Rollup 对第三方 Zod 注释位置的提示；Playwright NO_COLOR/FORCE_COLOR；electron-builder 未提供 author/description、默认 Electron 图标与明确跳过签名。均不是应用测试失败，不宣称 warning-free。

CI 普通作业覆盖三平台 helper 编译/类型/单元/构建；完整 Docker/Electron 测试在手动启用 run_docker 的 Linux 作业执行，准备可信镜像并使用 Xvfb，不假设托管 macOS 有 Docker。配置尚未在远端实际运行。

## 最终验证与独立审查

上述顺序检查于 2026-09-29 本机完成；初次 Docker beforeAll 因已记录的测试镜像 ID 不存在而失败，三个用例没有执行，不算成功。明确重新准备当前可信镜像 `sha256:2809fc030d1be4e3c92d15fa2204f0d3d56cd39cac23c86b21876074a981bfa2` 后从类型检查开始完整复跑通过，没有弱化不可用错误或自动跳过。

一次新上下文、只读全分支审查已完成（`205f705..b415e84`）。按实际用户影响重新评级，7 项重要问题进入同一轮修复，1 项次要问题延期；未进行第二次审查。用户在审查期间新增的 README 提交 `28b8b13` 保留；原目录随后新增的 `.idea` 提交 `543dae2` 及其分支选择同样未改动。

| 修复 | 先失败后通过的行为证据 |
| --- | --- |
| 附件预检后源文件/父目录被替换 | 两种替换均拒绝导入未选择字节，附件和原 checkpoint 不变；绑定原目录身份与完整文件 fingerprint 到 native copy |
| Docker 运行后清理失败仍可启动 | 新建、队列和仍在准备的调用均拒绝；保留归属记录，确认 owned cleanup 成功后恢复 |
| 写回/删除恢复丢失普通权限 | 0755/0644 保留并能恢复；附加测试保证 setuid/setgid/sticky 不被复制，私有备份仍为 0600 |
| 连续写回与新建后编辑/删除产生假冲突 | 独立 catalog 保存最后确认的源 fingerprint，重启后继续写回，原始 baseline 不变，外部修改仍拒绝 |
| 确认窗口缺少可读文本 | 服务及实际 Electron 同时验证原/新内容在确认前可见；重复写回展示当前源文本，不显示过时的导入基线 |
| 等待系统麦克风许可时取消未释放主进程操作 | 实际 Electron RED 重现不能立即重试；窄 session/window/namespace 取消接口释放等候，迟到许可不能重新授权；单位测试验证越权拒绝 |
| Windows 参数校验测试意外依赖 POSIX 导入 | 纯参数校验不再先导入；POSIX 正向测试限于支持平台，模拟 Windows 分支继续明确拒绝 native 文件操作且不产生审批 |

最终修复后顺序实测：类型检查通过，42 文件 / **234/234 单元测试**、**3/3 真实 Docker**、**21/21 实际 Electron**、生产构建、未签名 mac-arm64 目录包、**1/1 实际生产包启动/安全文件验证**、`git diff --check` 全通过。所有原有用例保留；新增系统许可等候 UI 测试只在 macOS 运行，不代表 Windows/Linux 或真实麦克风已经验收。另一次针对写回布局的实际 Electron 用例通过后重新生成生产包并复测，不遗留 test-mode 的 out。

文本预览仅当前用户选择的文件，纯文本每侧最多 64 KiB、总计最多 1 MiB，超限明确提示减少选择，二进制内容不展开。绑定同一 checkpoint revision 和单次、限时写回 token；展示后源文件再变化仍按完整 fingerprint 拒绝。源文件 ordinary mode 存在私有 fingerprint/备份中；旧的无 mode 备份使用安全 fallback，删除后恢复可能为 0600。最后确认的源版本与原始导入 baseline 分开保存，不把外部变化自动接纳为新基线。

延期次要问题：应用打开后才启动 Docker 时，SandboxStatus 没有重新检测按钮，当前需要重启应用。这个 UI 改善没有混入重要问题修复。

生产包工作区和最新写回确认截图已视觉检查：原/新文本并排可读，操作与风险提示无遮挡。最后交付前再次运行全量单元测试，234/234 通过。真实麦克风、用户 ASR、其他桌面平台、签名/公证、远端 CI 及 FastGPT 原始完整对接范围继续遵守上面的未验收声明；本地安全保护也不覆盖已被攻破的宿主机/容器引擎。
