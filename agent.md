# Orca HarmonyOS Agent 开发指南

本文面向在此仓库中修改代码的编码 Agent。先阅读[项目 README](README.md)和 [AGENTS.md](AGENTS.md)，再按改动范围查阅本指南与相应目录的说明。

## 项目目标与边界

本分支的重点是 HarmonyOS 远程 Agent 客户端：复用原版 Orca 界面，在设备上用原生 SSH 访问远程 Orca Runtime。界面使用 React / ArkWeb，原生层使用 ArkTS 和 C++；不要把它描述为全部使用 ArkUI 重写的客户端。

- 直接扩展原版 App、Sidebar、TabBar、工作区和终端组件，先查找已有实现。
- 保持主页简洁，默认聚焦项目、标签页和终端。界面改动遵守 [STYLEGUIDE](docs/STYLEGUIDE.md)，复用原版样式变量及组件。
- 保留系统状态栏，控件遵守安全区，仅背景延伸到系统区域。设备布局独立保存，主机 UI 同步和活动记录不能覆盖它。
- 保持包名 `com.xxay16.orcaremote` 的独立性。变更包名会影响签名、HDC 导入路径和已有安全存储，必须同时检查这些关联。
- 支持远程 Git 工作树与普通文件夹工作区。客户端、Runtime 可能独立更新，保持协议兼容。
- 原版桌面、移动端、云端代码仍在仓库内；保留其跨平台行为，不把未验证的桌面能力列为鸿蒙端已完成的功能。

## 代码入口

| 区域                   | 主要入口                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 鸿蒙界面初始化         | [src/renderer/src/harmony/main.tsx](src/renderer/src/harmony/main.tsx)                                                                       |
| 资源加载与随机数适配   | [harmony/bootstrap.ts](src/renderer/src/harmony/bootstrap.ts)                                                                                |
| 配对信息与原生端点适配 | [harmony/native-bridge.ts](src/renderer/src/harmony/native-bridge.ts)                                                                        |
| 原版 Web API           | [web/web-preload-api.ts](src/renderer/src/web/web-preload-api.ts) 与 [preload-api](src/renderer/src/web/preload-api)                         |
| SSH 端点生命周期       | [web-runtime-endpoint-provider.ts](src/renderer/src/web/web-runtime-endpoint-provider.ts)                                                    |
| ArkWeb 与安全区        | [pages/Index.ets](native/harmonyos/entry/src/main/ets/pages/Index.ets)                                                                       |
| 原生桥与生命周期       | [ssh/RemoteBridge.ets](native/harmonyos/entry/src/main/ets/ssh/RemoteBridge.ets)                                                             |
| 安全存储               | [security/HostVault.ets](native/harmonyos/entry/src/main/ets/security/HostVault.ets)                                                         |
| 调试设备配置导入       | [ssh/DeviceDefaults.ets](native/harmonyos/entry/src/main/ets/ssh/DeviceDefaults.ets)                                                         |
| 原生 SSH               | [ssh_tunnel.cpp](native/harmonyos/entry/src/main/cpp/ssh_tunnel.cpp) 与 [CMakeLists.txt](native/harmonyos/entry/src/main/cpp/CMakeLists.txt) |
| 构建与依赖下载         | [native/harmonyos/scripts](native/harmonyos/scripts)                                                                                         |

涉及平台、进程、Shell、快捷键或原生模块前，阅读[跨平台约束](docs/reference/cross-platform-support.md)。涉及 Git 或代码评审行为前，阅读 [Git 工作流](docs/reference/git-workflow.md)。

## 连接与凭据约束

1. SSH 在设备原生层运行，转发到远程回环地址上的 Runtime。电脑上的临时转发只能用于诊断，不能代替最终的原生直连验证。
2. SSH 主机指纹必须在用户认证之前校验。指纹变化、缺少指纹或认证失败不能通过放宽校验或无限重试解决。
3. SSH 私钥、密码和口令留在原生层；配对配置使用 Asset Store 持久化，页面仅使用会话内存。不要把凭据写入源码、前端存储、日志、截图或 HAP 资源。
4. Asset Store 单条 SECRET 有 1024 字节限制。修改凭据分块时保留版本清单、失败回滚及旧分块清理，不能简单把完整私钥塞进单条记录。
5. 隧道替换实际拨号地址时，保留原版配对公钥校验和 E2EE 身份。不要把本机临时端口持久化成远端地址。
6. 页面关闭、连接取消或重连时回收隧道；晚完成的异步连接也要回收。断开客户端不能顺带终止远程任务。
7. libssh2 的网络操作放在异步工作线程，每个会话的转发由其 I/O 线程串行执行，避免阻塞 ArkUI。
8. ArkWeb 代理保持来源限制和最小接口范围。当前 Promise 返回值使用普通 `methodList`；变更代理方式时必须真机检查返回值和失败信息，不能仅凭类型检查判断可用。

私有配置与构建说明见[鸿蒙模块 README](native/harmonyos/README.md)。`signing.local.json`、`.local/`、证书、生成资源及第三方下载源码应继续保持 Git 忽略；提交前检查暂存区。

## 键盘与输入法

HarmonyOS 的外接键盘会经过系统输入法。已观察到的提交序列包括 `keydown(229)` → `beforeinput / input(insertText)` → `keyup(229)`，也可能只有字符键的 `keyup`，没有对应的普通 `keydown`。

- 使用 [harmony-web-platform.ts](src/renderer/src/lib/harmony-web-platform.ts) 识别 OpenHarmony / HarmonyOS；不要依赖 UA 一定含有 `Linux`，也不要因此回退到 macOS 快捷键。
- 在 [terminal-pane-pane-input.ts](src/renderer/src/components/terminal-pane/terminal-pane-pane-input.ts) 接入已有输入法处理；平台判断与 [xterm-bypass-policy.ts](src/renderer/src/components/terminal-pane/xterm-bypass-policy.ts) 保持一致。
- 允许空闲状态下的鸿蒙 229 keydown 进入 xterm 的提交处理；保留活跃组合输入、候选键和孤立 keyup 的保护。
- 复用 [terminal-ime-native-text-forwarder.ts](src/renderer/src/components/terminal-pane/terminal-ime-native-text-forwarder.ts) 等现有路径，避免同时从 keydown 与 input 重复发送文字。
- Windows 的输入法保护、Linux 候选键处理和 iOS 组合输入行为分别保留，不能为修复鸿蒙而全局取消拦截。
- 验证真实外接键盘的输入、删除和回车；中文、标点、组合提交及重复事件要有回归检查。CDP 的模拟按键不能覆盖真实输入法事件。

## 构建命令

以下 PowerShell 命令从仓库根目录运行。详细的 SDK、签名和设备准备步骤见[鸿蒙模块 README](native/harmonyos/README.md)。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:harmonyos:web
./native/harmonyos/scripts/build.ps1 -SkipWeb -DevEcoHome 'D:\sw\DevEco Studio'
./native/harmonyos/scripts/build.ps1 -SkipWeb -Install -Device '<设备序列号>' -DevEcoHome 'D:\sw\DevEco Studio'
```

修改前端后先重建 Web 资源，再打包 HAP。`-SkipWeb` 只适用于资源已更新或本次仅修改原生代码的情况。不要手工修改生成的 `rawfile/console/`，应修改源代码并重新生成。

## 验证要求

按修改范围执行检查；仅修改文档时检查格式、链接和命令对应的文件即可，无需重新编译应用。

### 类型与代码质量

```powershell
$env:ORCA_BACKGROUND_LAUNCH = '1'
node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.tc.web.json --compiler=native
pnpm run check:code-quality:changed -- origin/main
git diff --check
```

这里使用 `--compiler=native` 运行仓库已有的类型检查脚本，避免在未准备 Bun 的环境里走默认编译器。原生 ArkTS / C++ 改动还必须通过 HAP 构建。

### 连接与工作区回归

```powershell
$runtimeTests = @(
  'src/renderer/src/harmony/native-bridge.test.ts'
  'src/renderer/src/web/web-runtime-endpoint-client.test.ts'
  'src/renderer/src/web/web-runtime-environment-token.test.ts'
  'src/renderer/src/web/web-preload-api-folder-workspaces.test.ts'
  'src/renderer/src/web/web-preload-api-ui-pairing-local-fields.test.ts'
  'src/renderer/src/store/adopt-from-endpoint.test.ts'
)
pnpm exec vitest run --config config/vitest.config.ts @runtimeTests
```

### 输入法回归

```powershell
$keyboardTests = @(
  'src/renderer/src/web/web-browser-platform.test.ts'
  'src/renderer/src/components/terminal-pane/terminal-ime-user-input-provenance.test.ts'
  'src/renderer/src/components/terminal-pane/xterm-bypass-policy.test.ts'
  'src/renderer/src/components/terminal-pane/xterm-bypass-policy-non-mac.test.ts'
  'src/renderer/src/components/terminal-pane/terminal-ime-xterm-consumed-key-commit.test.ts'
  'src/renderer/src/components/terminal-pane/terminal-ime-xterm-linux-native-trace-replay.test.ts'
  'src/renderer/src/components/terminal-pane/terminal-ios-hangul-preedit-coexistence.test.ts'
)
pnpm exec vitest run --config config/vitest.config.ts @keyboardTests
```

### 真机检查

- 使用 DevEco CLI / HDC 检查设备、安装包与启动结果，通过 ArkWeb CDP / Playwright 检查渲染界面。
- 确认状态栏可见、控件处于安全区、背景连续；隐藏入口和本机布局在主机同步后不被覆盖。
- 使用已有授权主机和独立测试工作区验证 Agent 启动、输入、回复，以及应用重启后的默认连接恢复和远程会话重新打开。
- 输入修改必须有真实外接键盘验证；出现“键盘不工作”时区分焦点、keydown、输入法提交、xterm 消费和 PTY 转发，不能只测试模拟按键。
- 安全与生命周期改动还需覆盖指纹拒绝、临时失败恢复、连接取消和页面销毁；确认真实凭据没有进入打包资源。
- 只清理本次测试创建的会话和目录，不修改用户 Agent 登录配置，不向用户工作项目发送测试消息，不结束已有任务。

桌面 Electron 验证遵守 [AGENTS.md](AGENTS.md) 的后台启动约束，不抢占用户显示器焦点。真机调试端口不属于产品连接链路；发布构建应关闭 Web 调试。

## 提交与交付

- 保持改动聚焦，使用具体文件名和检查过的类型；新增测试应复现真实行为或故障。
- 只暂存当前任务的文件，保留无关的用户改动和未跟踪文件。
- 新建工作分支默认使用 `codex/` 前缀；用户指定分支时遵从用户要求。推送、创建 PR 或合并按当前会话中的用户授权执行，不默认强制推送。
- 更新 README 时区分真机已验证、测试覆盖和尚未验证的功能，保留上游版权与第三方许可说明。
- 交付说明包含实际改动、检查结果与剩余限制；不能把显示了终端或收到模拟事件当成真实键盘和 Agent 收发已验证。
