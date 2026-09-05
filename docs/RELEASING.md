# Loom 发布与升级

## 当前可用流程

Loom 已配置 macOS 安装包构建。面向用户显示的产品名是 `Loom`，包标识是 `com.mumu.loom`；但内部 npm 应用名继续保持为 `personal-workbench-desktop`。这是有意为之：Electron 的 `userData` 目录和 macOS `safeStorage` Keychain 项都依赖内部应用名，保留它才能让开发版、首个安装包和后续版本持续使用同一份本地数据与加密凭据。

本地验证安装包：

```bash
npm --prefix desktop run pack:mac
```

它会输出 `desktop/release/mac-arm64/Loom.app`（当前 Apple Silicon Mac）。验证用 DMG 与 ZIP：

```bash
npm --prefix desktop run dist:mac:unsigned
```

输出文件是：

```text
desktop/release/Loom-<version>-arm64.dmg
desktop/release/Loom-<version>-arm64.zip
```

无签名构建只用于开发者本机验证；不要把它作为正式下载包发送给其他人。

## 应用内更新

Loom 的正式 macOS 包使用应用内更新：启动后在后台检查；发现新版时显示应用内提示；用户确认下载；下载完成后，再由用户点击「重启并更新」。它不会静默下载或静默重启，也不会把更新地址放进用户设置。

更新地址在构建正式包时通过 `LOOM_UPDATE_URL` 写入应用资源，必须是一个公开的 HTTPS 目录。例如：

```bash
LOOM_UPDATE_URL="https://downloads.example.com/loom/mac" npm --prefix desktop run release:mac
```

此地址可由任何可信的静态文件托管提供；当前仓库没有绑定 GitHub、对象存储或其他发布平台。使用通用 HTTPS 源时，每次发布后需上传下列构建产物到**同一个目录**：

```text
Loom-<version>-<arch>.zip
Loom-<version>-<arch>.zip.blockmap
latest-mac.yml
```

`.dmg` 仍用于用户首次下载安装；应用内更新使用 `.zip` 和 `latest-mac.yml`。`latest-mac.yml` 中包含版本、下载文件名和校验信息，不能手工改写或与其他版本混用。

首次把 Loom 交给用户时，仍需要手动安装一次正式签名且已公证的 DMG。之后的版本才能由 Loom 在应用内发现、下载并安装。无签名构建只用于本机验证，macOS 不支持它自动更新。

## 每次发布

1. 在 `desktop/package.json` 提升版本号：修复用补丁版本，新增兼容功能用次版本，破坏兼容性才提升主版本。
2. 运行 `npm --prefix desktop test`，并完成需要的真实功能验证。
3. 运行 `LOOM_UPDATE_URL="https://你的更新文件目录" npm --prefix desktop run release:mac`；这个命令会在构建前检查签名、公证、图标和 HTTPS 更新地址，并在构建后验证更新 ZIP 与 `latest-mac.yml` 是否匹配。
4. 对生成的 `.dmg` 进行全新安装验证，并确认已有待办、笔记、资料库文件和设置仍在。
5. 上传已签名且已公证的 DMG、更新 ZIP、ZIP blockmap 与 `latest-mac.yml` 到 `LOOM_UPDATE_URL` 指向的固定目录，并发布版本说明。

正式发布不允许把证书、密码、Apple ID 或 API Key 写进仓库；它们只应作为本机环境变量或 CI secrets 注入。

## 本地数据规则

应用更新替换的是安装包，不是系统用户数据目录。数据目录中包含 `workbench-data.json`、`backups/`、`library-files/` 和 `music-session.json`。因此：

- 不要改动 `desktop/package.json` 的 `name: personal-workbench-desktop`，也不要在主进程调用 `app.setName('Loom')`；否则新版本可能看起来像一份空的新应用，macOS 还可能无法读取既有的安全存储凭据。
- `productName: Loom` 和 `appId: com.mumu.loom` 是对外发布身份；它们与内部数据目录名称分开管理，首个正式版确定后也应保持稳定。
- 数据结构修改必须保持向后兼容，或在写入前增加可测试的迁移步骤。
- 大版本发布前先创建备份；导出的备份不会携带密码、Token 或其他密钥。

## 正式 macOS 分发前的前置条件

- 在 `desktop/build/icon.icns` 放入正式 Loom 图标。
- 准备 Apple Developer Program 的 `Developer ID Application` 证书。
- 为签名提供 `CSC_LINK` 或 `CSC_NAME`。
- 为 Apple 公证提供以下任一组合：Apple ID + App 专用密码 + Team ID，App Store Connect API Key + Team ID，或 Keychain Profile + Team ID。
- 准备 `LOOM_UPDATE_URL`：一个公开、固定、只允许 HTTPS 的更新文件目录；地址不应包含用户名、密码、查询参数或片段。
- 运行完成后使用 `spctl --assess --verbose --type exec <Loom.app 路径>`、`codesign --verify --deep --strict --verbose=2 <Loom.app 路径>` 和 `xcrun stapler validate <Loom.app 路径>` 验证签名与公证。
