# Orca HarmonyOS

基于 [Orca](https://github.com/stablyai/orca) 的 HarmonyOS 远程 Agent 客户端，在鸿蒙设备上通过原生 SSH 连接远程主机，操作主机上的工作区、终端和 CLI Agent。

界面直接复用原版 Orca 的 React 组件，由 ArkWeb 承载；SSH、主机指纹校验和凭据存储由鸿蒙原生层实现。当前重点是远程使用，主页保留项目侧栏、标签页和终端，默认隐藏任务、自动化等入口及右侧面板。

## 当前能力

- **设备直连 SSH**：libssh2 / Mbed TLS 在设备上建立隧道，访问远程 Orca Runtime，电脑仅用于编译、安装和调试。
- **原版工作区与终端**：复用侧栏、标签页、xterm 和配对协议，显示远程 Git 工作树及文件夹工作区。
- **远程 Agent**：使用主机已有的 CLI 安装和登录状态。OMP 已完成真机启动、消息发送和回复验证。
- **外接键盘**：已适配 OpenHarmony 输入法提交事件，真机验证英数输入和回车发送；中文及标点提交有回归测试覆盖。
- **安全存储**：SSH 私钥、密码和配对配置保存到 HarmonyOS Asset Store，SSH 认证前校验已保存的主机指纹。
- **设备布局**：保留系统状态栏，内容遵守安全区，背景延伸到系统区域；平板布局单独保存。

## 验证范围

| 项目                                     | 当前状态                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| 设备                                     | MatePad Pro 真机验证                                   |
| SDK / ABI                                | HarmonyOS API 26，`arm64-v8a`                          |
| 包名 / 应用名                            | `com.xxay16.orcaremote` / Orca Remote                  |
| 原生 SSH                                 | 已验证 PEM RSA 私钥连接、指纹拒绝和默认主机恢复        |
| OMP                                      | 已验证启动、交互和重启后重新打开远程会话               |
| 其他 Agent                               | 保留原版入口，依赖主机安装和认证，尚未逐个完成真机验证 |
| 密码 / ECDSA 私钥                        | 已实现，尚未完成真机验证                               |
| 手机、2in1、其他 ABI                     | 尚未验证；当前构建仅包含 `arm64-v8a`                   |
| 后台长期联网、全部桌面编辑器与浏览器功能 | 尚未完成验证                                           |

当前通过源码构建并签名安装。远端需要已有兼容的 Orca Runtime；SSH 自动部署和完整的端内主机配置流程尚未接入。SSH 后端当前支持 PEM RSA / ECDSA 私钥及 password 认证，暂不支持 OpenSSH 格式私钥和 Ed25519 密钥。

## 连接方式

```mermaid
flowchart LR
  UI["鸿蒙设备：原版 Orca 界面 / ArkWeb"] -->|"本机回环 WebSocket"| SSH["设备原生 SSH 隧道"]
  SSH -->|"SSH direct-tcpip"| Runtime["远程主机：Orca Runtime"]
  Runtime --> Agent["远程终端 / CLI Agent"]
```

隧道转发到远程主机的 `127.0.0.1:<Runtime 端口>`，原版配对公钥校验和 E2EE 协议继续生效。SSH 地址、Runtime 配对信息和私钥属于每台设备的私有配置，首次调试安装后通过 HDC 导入。

## 从源码构建

以下是已验证的 Windows / PowerShell 工作流，命令在仓库根目录执行。

### 1. 准备环境

- Node.js 24；pnpm 版本以 [package.json](package.json) 的 `packageManager` 为准。
- Python 3.12 或更新版本，用于下载并校验固定版本的原生依赖。
- DevEco Studio、HarmonyOS API 26 SDK，以及已安装的 DevEco CLI（`devecocli`）。
- 真机开启开发者模式和 USB 调试，并完成设备授权。
- 为包名 `com.xxay16.orcaremote` 准备调试签名，步骤见[鸿蒙模块说明](native/harmonyos/README.md#调试签名)。

### 2. 构建界面与 HAP

```powershell
git clone https://github.com/xxay-16/orca-harmonyos.git
cd orca-harmonyos

pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:harmonyos:web

$devecoHome = 'D:\sw\DevEco Studio'
./native/harmonyos/scripts/build.ps1 -SkipWeb -DevEcoHome $devecoHome
```

把 `$devecoHome` 改为本机安装目录。首次原生构建会下载 libssh2 和 Mbed TLS，并检查固定摘要；签名配置放在 Git 忽略的 `native/harmonyos/signing.local.json` 中。

HAP 输出目录：`native/harmonyos/entry/build/default/outputs/default/`。完整原版渲染器打包后的调试 HAP 约 100 MB，体积优化仍待后续处理。

### 3. 安装与连接

```powershell
$hdcPath = Join-Path $devecoHome 'sdk/default/openharmony/toolchains/hdc.exe'
& $hdcPath list targets

./native/harmonyos/scripts/build.ps1 -SkipWeb -Install -Device '<设备序列号>' -DevEcoHome $devecoHome
```

首次安装后，按[连接配置说明](native/harmonyos/README.md#导入连接配置)准备私有 JSON，再导入设备：

```powershell
./native/harmonyos/scripts/configure-device.ps1 -Configuration '<私有配置文件的绝对路径>' -Device '<设备序列号>' -DevEcoHome $devecoHome
```

该流程仅适用于调试构建。配置经应用私有目录导入 Asset Store 后删除；更新同包名应用可继续读取已保存的默认主机。卸载应用或清除其数据后，需要重新配置。

## 开发入口

| 路径                                                                                 | 用途                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------- |
| [native/harmonyos](native/harmonyos/README.md)                                       | ArkTS 工程、原生 SSH、安全存储和构建脚本 |
| [src/renderer/src/harmony](src/renderer/src/harmony/main.tsx)                        | 鸿蒙渲染器入口、资源适配和原生桥接       |
| [src/renderer/src/web](src/renderer/src/web/web-preload-api.ts)                      | 原版 Web preload、RPC 和端点连接适配     |
| [src/renderer/src/App.tsx](src/renderer/src/App.tsx)                                 | 原版界面框架及工作区、终端组件入口       |
| [config/vite.harmonyos.config.ts](config/vite.harmonyos.config.ts)                   | 复用原版 Web 构建配置                    |
| [config/scripts/package-harmonyos-web.mjs](config/scripts/package-harmonyos-web.mjs) | 将构建产物封装成 ArkWeb 本地资源         |

原版桌面、移动端和云端源码仍保留在仓库中；它们的功能与文档不能直接视为鸿蒙端已实现的能力。

## 开发与验证

Agent 开发指南见 [agent.md](agent.md)，仓库通用约束见 [AGENTS.md](AGENTS.md)，界面规范见 [STYLEGUIDE](docs/STYLEGUIDE.md)。

```powershell
$env:ORCA_BACKGROUND_LAUNCH = '1'
node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.tc.web.json --compiler=native
pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/web/web-runtime-endpoint-client.test.ts src/renderer/src/harmony/native-bridge.test.ts
pnpm run check:code-quality:changed -- origin/main
```

涉及键盘的修改还需运行输入法回归测试，并使用实际外接键盘验证；仅通过 CDP 模拟按键不足以证明鸿蒙输入法链路正常。完整的测试文件和真机检查项见 [agent.md](agent.md#验证要求)。

## 反馈与许可证

鸿蒙适配问题请提交到[本仓库 Issues](https://github.com/xxay-16/orca-harmonyos/issues)，附设备型号、系统版本、复现步骤和脱敏日志。

本仓库基于 Orca 的 [MIT License](LICENSE)，保留上游版权声明。鸿蒙模块的原生 SSH 复用及第三方依赖说明见 [NOTICE](native/harmonyos/NOTICE)。
