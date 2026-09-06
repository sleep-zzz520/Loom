# Loom 发布与升级

## 运行时与依赖基线

- Electron 固定为 `44.2.0`；macOS 最低版本为 `13.0.0`，构建配置同步声明这一限制。开发和测试需要 Node.js `>=22.12.0`，建议使用 Node.js 24。
- 保留 `NeteaseCloudMusicApi@4.32.0`，在其依赖树中将 `music-metadata` 固定到 `11.15.0`、`qs` 固定到 `6.16.0`。前者同时引入已修复的 `file-type@21.3.4`。不要运行 `npm audit fix --force` 将网易云 API 降到旧主版本。
- `music-metadata` 新版使用 ESM；当前 Node.js / Electron 可通过 CommonJS `require()` 加载。`dependency-self-test` 会验证模块加载、正常 WAV 解析、两个 ASF 零长度对象，以及两个 `qs` 回归场景。解析测试放在有超时限制的子进程中，避免旧版本死循环卡住整个测试。
- 内置音乐服务仍仅加载现有允许列表，未启用 `/cloud` 上传路由。升级依赖不应扩大路由范围。
- 使用 `npm --prefix desktop audit --omit=dev --registry=https://registry.npmjs.org` 检查生产依赖；当前镜像源不提供 npm 安全审计接口。审计结果只能说明已知依赖公告，不能代替应用安全审查或 Electron 支持周期检查。

变更依据：[Electron 44 兼容性变化](https://www.electronjs.org/docs/latest/breaking-changes#breaking-api-changes-440)、[music-metadata ASF 公告](https://github.com/advisories/GHSA-v6c2-xwv6-8xf7)、[file-type ASF 公告](https://github.com/advisories/GHSA-5v7r-6r5c-r473)、[qs 数组限制公告](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)、[qs isBuffer 公告](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)。

真实运行检查：先关闭占用 3000 端口的 Loom 实例，再运行 `npm --prefix desktop run runtime-smoke-test`。测试加载构建后的 React 页面、实际 preload 和主进程，验证 IPC 数据写入与重载、系统加密和解密、内置 HTTP 服务以及禁用上传路由。`-- --keep-open` 可保留窗口供人工检查。它使用临时目录和虚构凭据，不连接个人邮箱或模型服务；测试结束后的目录路径会打印到终端。测试通过不代表正式签名升级或 Windows 安装验证通过。

未签名开发构建更换 Electron 二进制后，macOS 可能再次请求访问原有钥匙串项目。等待系统授权时，同步凭据读取可能阻塞启动，表现为 Vite 已运行但主窗口或 3000 端口尚未就绪。应由用户在系统弹窗中处理授权，再验证原有账号；不要删除钥匙串、清空应用数据或改成明文存储。当前未签名的 macOS 分发也需要验证覆盖安装后的钥匙串读取；签名身份一致性对凭据访问的影响参见 [Electron 的系统凭据与签名说明](https://www.electronjs.org/docs/latest/tutorial/code-signing#macos-apis-that-require-code-signing)。

## 平台发布策略

macOS 提供未签名、未公证的 DMG，用户从 GitHub Releases 下载并手动安装；暂不提供应用内更新。Windows 提供 x64 NSIS 安装包，并支持应用内检查、确认下载和重启安装更新。

产品名保持 `Loom`，包标识保持 `com.mumu.loom`，内部 npm 应用名保持 `personal-workbench-desktop`，以延续现有数据目录和凭据。

## macOS 下载与手动更新

在 Mac 上运行：

```bash
npm --prefix desktop run release:mac
```

当前机器默认输出 `desktop/release/Loom-<version>-arm64.dmg`，供 Apple Silicon Mac 使用。Intel Mac 需要另行构建 x64 DMG 并实机验证；不能将 arm64 包标为兼容所有 Mac。

该命令不需要 Apple Developer 账号、签名、公证凭据或更新地址，不生成 macOS 更新 ZIP 或 `latest-mac.yml`。`pack:mac` 仍用于生成本地测试的 `.app` 目录，`dist:mac:unsigned` 与 `release:mac` 使用相同的 DMG 构建流程。

发布时上传本轮生成的 DMG，不要混入 `release/` 中遗留的旧 ZIP 或更新元数据。首次安装将 Loom 拖入“应用程序”；手动升级时先退出 Loom，再用新版替换旧应用。本地用户数据不随应用替换而删除。

由于应用没有 Developer ID 签名和 Apple 公证，首次打开可能受到 macOS 安全提示或拦截。用户需确认下载来源，并自行按照 [Apple 的打开 App 说明](https://support.apple.com/zh-cn/102445)处理；不要要求用户全局关闭系统安全保护。不能将此包描述为“已公证”或保证在所有 Mac 上直接打开。

## Windows 应用内更新

在 Windows 构建机上设置固定 HTTPS 更新目录后运行（PowerShell）：

```powershell
$env:LOOM_UPDATE_URL = "https://github.com/sleep-zzz520/Loom/releases/latest/download"
npm --prefix desktop run release:win
```

本项目仓库为 `sleep-zzz520/Loom`。GitHub 仓库需对下载用户公开可访问；此地址用于稳定版发布。更新地址固定写入 Windows 包，不允许从用户设置改写。构建命令只生成本地产物，不自动发布。

每次在同一个 GitHub Release 上传以下文件，并将其设为最新稳定版：

```text
Loom-Setup-<version>-x64.exe
Loom-Setup-<version>-x64.exe.blockmap
latest.yml
```

也可使用其他可信的固定 HTTPS 目录，但三个文件必须来自同一构建，`latest.yml` 不能手工修改或与旧版本混用。发布命令会检查构建平台、更新地址和输出文件。

Windows 包在启动后检查更新，发现新版后提醒用户；下载和重启安装都需用户点击确认。开发模式、缺少更新配置的包，以及 macOS 均不会发起更新请求。

当前不强制购买 Windows 代码签名证书。未签名安装程序可能显示 SmartScreen 或未知发布者提示；是否采购证书与是否提供应用内更新分别决定。保留 electron-updater 的默认签名验证配置，后续接入签名时需验证发布者身份的连续性。

## 每次发布

1. 更新 `desktop/package.json` 及锁文件中的版本号。
2. 运行 `npm --prefix desktop test`，完成对应功能回归。
3. 在目标系统构建对应安装包；macOS 使用 `release:mac`，Windows 使用 `release:win`。
4. 验证全新安装和覆盖安装后的数据、凭据、音乐及邮箱功能。Windows 还需用两个递增版本测试真实检查、下载、重启安装，并确认数据保留。
5. 上传本轮产物到 GitHub Release，注明支持的系统、架构及签名情况。Windows 稳定版需同时上传安装包、blockmap 和 `latest.yml`。

Windows 实机安装和真实更新链路尚未验证；本机 macOS 的构建与更新状态测试不能替代该验收。macOS 图标使用仓库中的 `desktop/build/icon.icns`。任何签名凭据只通过环境变量或 CI secrets 提供，不写入仓库。

## 本地数据规则

应用更新替换的是安装包，不是系统用户数据目录。数据目录中包含 `workbench-data.json`、`backups/`、`library-files/` 和 `music-session.json`。因此：

- 不要改动 `desktop/package.json` 的 `name: personal-workbench-desktop`，也不要在主进程调用 `app.setName('Loom')`；否则新版本可能看起来像一份空的新应用，macOS 还可能无法读取既有的安全存储凭据。
- `productName: Loom` 和 `appId: com.mumu.loom` 是对外发布身份；它们与内部数据目录名称分开管理，首个正式版确定后也应保持稳定。
- 数据结构修改必须保持向后兼容，或在写入前增加可测试的迁移步骤。
- 大版本发布前先创建备份；导出的备份不会携带密码、Token 或其他密钥。

## GitHub Actions 发布

推送与 `desktop/package.json` 版本一致的 `v<version>` 标签会触发 `.github/workflows/release.yml`。流水线在 Windows x64 和 macOS arm64 上运行完整测试并构建安装包；两端都成功后，生成包含校验文件的 GitHub Release 草稿。检查产物和说明后再发布草稿，并设为最新稳定版。
