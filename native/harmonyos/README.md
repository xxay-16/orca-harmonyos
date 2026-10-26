# Orca HarmonyOS

本模块直接使用此仓库的原版渲染器，包括 App、Sidebar、TabBar、终端和工作区组件。ArkTS / ArkWeb 承载界面；libssh2 / Mbed TLS 在设备上建立 SSH 连接。

- 独立包名：`com.xxay16.orcaremote`。
- 工具链：HarmonyOS API 26、DevEco CLI、本机 Node.js / pnpm、Python 3.12。
- 原生 ABI：`arm64-v8a`，当前验证设备为 MatePad Pro。
- 连接路径：设备原生 SSH → 远程回环地址的 Orca Runtime。电脑仅用于编译、安装和调试。
- 原版设计变量和组件保持不变。鸿蒙端默认使用浅色、中文，关闭引导、自动化等导航入口、右侧面板和多余状态栏项目；布局由设备保存，不覆盖主机布局。

## 构建与安装

先在仓库根目录安装依赖。无需启动 Electron。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:harmonyos:web

cd native/harmonyos
./scripts/build.ps1 -SkipWeb -Install -Device '<hdc serial>'
```

默认 DevEco Studio 路径为 `D:\sw\DevEco Studio`，可以通过 `-DevEcoHome` 覆盖。签名配置放在本模块 Git 忽略的 `signing.local.json`，构建脚本临时注入后恢复公开配置。HAP 位于 `entry/build/default/outputs/default/`。

原版渲染器包含完整的延迟模块，打包后转换为 ArkWeb 可加载的经典脚本；当前调试 HAP 约 100 MB。生成资源和第三方源码不提交到 Git，依赖版本及校验摘要固定在 `third_party/manifest.json`。

## 默认连接与凭据

本机 MatePad 的 K12 SSH 配置保存于 HarmonyOS Asset Store，更新同包名应用会恢复默认主机。SSH 私钥和密码由原生层读取；配对令牌保存在安全存储，页面只持有当前会话所需的内存副本。

新的调试设备可准备私有 JSON 配置，再执行：

```powershell
./scripts/configure-device.ps1 -Configuration '<private configuration path>' -Device '<hdc serial>'
```

配置结构为 `{ profile, credentials }`。`profile` 包含 `id`（32 位小写十六进制）、`name`、Runtime 的 `endpoint`、`deviceToken`、`publicKeyB64` 和可选 `ssh`；`ssh` 包含 `host`、`port`、`username`、`auth`、`fingerprint`、`remotePort`。`credentials` 包含 `privateKey`、`password`、`passphrase` 三个字符串。

配置仅经 HDC 写入调试应用的私有目录，导入 Asset Store 后删除；不编入 HAP。私钥支持 PEM RSA / ECDSA，密码使用 SSH password 认证。主机指纹必须事先通过可信渠道核对；指纹变化或认证失败停止自动重试。远程主机需已有 Orca Runtime，SSH 自动部署尚未接入。

## 验证

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.tc.web.json --compiler=native
pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/web/web-runtime-endpoint-client.test.ts src/renderer/src/web/web-preload-api-folder-workspaces.test.ts src/renderer/src/web/web-runtime-environment-token.test.ts src/renderer/src/web/web-preload-api-ui-pairing-local-fields.test.ts
```

真机检查使用 DevEco CLI，以及调试构建的 ArkWeb CDP / Playwright；不启动桌面 Electron 窗口。调试端口不属于 Agent 网络路径，发布构建关闭 Web 调试。

MatePad Pro 已验证原版界面启动 OMP、外接键盘输入与回车发送、接收回复，以及应用重启后恢复默认 SSH 连接、重新打开远程会话。鸿蒙布局在主机 UI 同步和活动记录后继续由本机保存。其他 Agent 使用主机已有的安装和登录状态。

当前边界：未验证其他 ABI、后台长期联网、全部桌面编辑器和浏览器功能。退出客户端仅释放连接，远程任务继续由主机持有。
