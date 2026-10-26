# HarmonyOS 模块

项目总览见[根目录 README](../../README.md)，开发约束见 [agent.md](../../agent.md)。本模块使用 ArkTS / ArkWeb 承载原版 Orca 界面，通过 libssh2 / Mbed TLS 建立设备原生 SSH 隧道。

| 项目       | 配置                      |
| ---------- | ------------------------- |
| 包名       | `com.xxay16.orcaremote`   |
| 应用名     | Orca Remote               |
| SDK        | HarmonyOS API 26 / 26.0.0 |
| 原生 ABI   | `arm64-v8a`               |
| 已验证设备 | MatePad Pro               |

## 构建与安装

以下命令均从仓库根目录执行。需要 Node.js 24、pnpm、Python 3.12+、DevEco Studio 和已安装的 DevEco CLI。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:harmonyos:web

$devecoHome = 'D:\sw\DevEco Studio'
./native/harmonyos/scripts/build.ps1 -SkipWeb -DevEcoHome $devecoHome
```

省略 `-SkipWeb` 时，脚本会同时重建原版渲染器。原生依赖缺失时由 `scripts/fetch-native.py` 下载并校验，版本和摘要保存在 [third_party/manifest.json](third_party/manifest.json)。

构建完成后连接已授权的真机：

```powershell
$hdcPath = Join-Path $devecoHome 'sdk/default/openharmony/toolchains/hdc.exe'
& $hdcPath list targets
./native/harmonyos/scripts/build.ps1 -SkipWeb -Install -Device '<设备序列号>' -DevEcoHome $devecoHome
```

签名 HAP 位于 `native/harmonyos/entry/build/default/outputs/default/entry-default-signed.hap`，当前调试包约 100 MB。渲染器生成资源、第三方源码、依赖缓存和构建产物均已加入 Git 忽略规则。

## 调试签名

1. 在本机 DevEco Studio / CLI 完成开发者账号登录，并为已连接设备生成该包名的调试签名配置。
2. 如果工具把签名写入本模块 `build-profile.json5`，在仓库根目录运行：

   ```powershell
   ./native/harmonyos/scripts/save-signing.ps1
   ```

3. 脚本将签名配置移入 Git 忽略的 `native/harmonyos/signing.local.json`，并清空公开配置中的 `signingConfigs`。构建脚本会临时注入本地签名，结束后恢复公开配置。

`save-signing.ps1` 只迁移已有签名配置，不负责账号登录或申请证书。证书、签名密码及 `signing.local.json` 仅保留在本机。

## 远程主机准备

远程主机需要运行可经其 `127.0.0.1:<端口>` 访问的 Orca Runtime，并安装、登录需要使用的 CLI Agent。SSH 账号应允许 `direct-tcpip` 转发到该端口。

已有 Orca CLI 的主机可参考以下前台启动方式；Linux 安装包的命令名通常为 `orca-ide`：

```bash
orca-ide serve --port 6768 --pairing-address 127.0.0.1 --json
```

`--pairing-address` 只改变配对信息中公布的地址，不改变监听地址。这里使用回环地址是因为设备会通过 SSH 隧道访问 Runtime。实际端口及启动方式以远端版本为准；不要为同一个配置重复启动 Runtime。

需要的是 runtime scope 配对信息，而非 mobile scope 配对码。取得配对 offer 中的 `endpoint`、`deviceToken` 和 `publicKeyB64`，用于下面的设备配置。更多服务端说明见仓库保留的[原版远程服务文档](../../docs/site/content/docs/remote-servers.mdx)。

## 导入连接配置

当前首连采用调试设备私有配置导入。先将下列模板保存为 `native/harmonyos/.local/orca-default-ssh.json`，并替换所有占位内容。该文件已被 Git 忽略。

```json
{
  "profile": {
    "id": "0123456789abcdef0123456789abcdef",
    "name": "我的远程主机",
    "endpoint": "ws://127.0.0.1:6768",
    "deviceToken": "<Runtime 配对令牌>",
    "publicKeyB64": "<Runtime 配对公钥的 Base64>",
    "ssh": {
      "host": "ssh.example.com",
      "port": 22,
      "username": "user",
      "auth": "key",
      "fingerprint": "SHA256:<经可信渠道核对的主机公钥指纹>",
      "remotePort": 6768
    }
  },
  "credentials": {
    "privateKey": "<PEM RSA/ECDSA 私钥完整内容>",
    "password": "",
    "passphrase": ""
  }
}
```

字段约束：

- `profile.id`：32 位小写十六进制主机标识，为每个主机生成唯一值。
- `endpoint`：Runtime offer 的主机本地 `ws://` 地址；`ssh.remotePort` 应指向该 Runtime 的实际端口。
- `deviceToken` / `publicKeyB64`：使用同一 Runtime 的配对信息；不要拿 SSH 指纹代替配对公钥。
- `ssh.fingerprint`：`SHA256:` 加 43 位不带填充的 Base64 摘要，须对应实际协商的 RSA / ECDSA 主机公钥，先通过可信渠道核对。
- `credentials.privateKey`：PEM RSA / ECDSA 私钥，保留完整头尾，JSON 中的换行写成 `\n`；加密私钥的口令填入 `passphrase`。当前不支持 OpenSSH 私钥格式或 Ed25519 密钥。
- 使用密码认证时，将 `auth` 改为 `password`，填写 `password`，其余不用的凭据字段保留为空字符串。
- `environmentId` / `pairedDeviceId` 是可选的配对关联字段；首次配置可以省略，应用在保存连接时维护。

准备好配置后，在仓库根目录运行：

```powershell
./native/harmonyos/scripts/configure-device.ps1 -Device '<设备序列号>' -DevEcoHome $devecoHome
```

也可以用 `-Configuration '<私有配置文件的绝对路径>'` 指定其他本机文件。脚本把文件写入已安装调试应用的私有目录并重启应用；原生层导入 Asset Store 成功后删除设备上的导入文件，电脑上的源配置由开发者自行保管。

该导入逻辑只在 `BuildProfile.DEBUG` 为真时执行，不能作为发布版本的配置入口。更新同包名应用会继续读取安全存储中的默认主机；卸载应用或清除其数据后需要重新配置。

## 安全与生命周期

- SSH 私钥、密码、私钥口令由原生层读取，不向页面暴露读取接口。
- 配对配置持久保存在 Asset Store，页面仅在会话内存持有配对令牌，不写入 `localStorage`。
- 主机指纹在 SSH 用户认证前验证；指纹变化和认证失败终止自动重试，临时连接失败在请求超时预算内重试。
- 连接释放和页面销毁会回收本机隧道；关闭客户端不主动结束远程 Agent 任务。
- ArkWeb 原生桥只允许应用内置资源访问，页面导航限制在打包的界面资源内。
- Web 调试仅在调试构建开启；CDP / HDC 用于开发，不参与设备到 Agent 的网络连接。

## 验证与常见问题

完整检查命令与真机验证清单见 [agent.md](../../agent.md#验证要求)。目前已在 MatePad Pro 验证原版界面、原生 SSH、OMP 消息收发、应用重启后重新打开远程会话，以及外接键盘输入与回车发送。

| 现象                             | 检查位置                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------- |
| 提示设备尚未配置 SSH 主机        | 确认安装的是调试构建，导入脚本成功，配置通过原生层校验                       |
| SSH 主机指纹变化                 | 在可信渠道核实服务器身份及协商的主机公钥类型，再更新配置                     |
| SSH 认证失败                     | 检查账号、认证方式、私钥格式与口令；密码方式使用 SSH password 认证           |
| SSH 已连接，但 Runtime 不可用    | 确认远端 Runtime 在线、端口正确，SSH 允许到该端口的转发                      |
| 原版界面能显示，外接键盘无法输入 | 检查 OpenHarmony 平台识别、229 / insertText 处理与输入焦点；使用真实键盘复测 |
| 新界面构建后未生效               | 先重建 Web 资源，再打包并安装 HAP，确认安装的是本次构建产物                  |

其他 Agent、设备类型、ABI、后台长期联网及全部桌面功能仍需分别验证。第三方许可见 [NOTICE](NOTICE) 与 [licenses](entry/src/main/resources/rawfile/licenses)。
