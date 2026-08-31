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

## 每次发布

1. 在 `desktop/package.json` 提升版本号：修复用补丁版本，新增兼容功能用次版本，破坏兼容性才提升主版本。
2. 运行 `npm --prefix desktop test`，并完成需要的真实功能验证。
3. 运行 `npm --prefix desktop run release:mac`；这个命令会在构建前检查签名、公证和图标是否齐全，缺少任意条件即失败。
4. 对生成的 `.dmg` 进行全新安装验证，并确认已有待办、笔记、资料库文件和设置仍在。
5. 上传已签名且已公证的 DMG 与 ZIP 到固定的 Release 位置，并发布版本说明。

正式发布不允许把证书、密码、Apple ID 或 API Key 写进仓库；它们只应作为本机环境变量或 CI secrets 注入。

## 本地数据规则

应用更新替换的是安装包，不是系统用户数据目录。数据目录中包含 `workbench-data.json`、`backups/`、`library-files/` 和 `music-session.json`。因此：

- 不要改动 `desktop/package.json` 的 `name: personal-workbench-desktop`，也不要在主进程调用 `app.setName('Loom')`；否则新版本可能看起来像一份空的新应用，macOS 还可能无法读取既有的安全存储凭据。
- `productName: Loom` 和 `appId: com.mumu.loom` 是对外发布身份；它们与内部数据目录名称分开管理，首个正式版确定后也应保持稳定。
- 数据结构修改必须保持向后兼容，或在写入前增加可测试的迁移步骤。
- 大版本发布前先创建备份；导出的备份不会携带密码、Token 或其他密钥。

## 自动更新（下一阶段）

当前阶段只实现“构建并手动下载安装新版”，还没有后台自动下载/覆盖。后续接入自动更新时，保留每次构建的 ZIP，并增加“检查更新 → 用户确认下载 → 重启安装”的交互；更新元数据和安装包必须由同一受信任发布源提供，且只接受签名、公证后的版本。

## 正式 macOS 分发前的前置条件

- 在 `desktop/build/icon.icns` 放入正式 Loom 图标。
- 准备 Apple Developer Program 的 `Developer ID Application` 证书。
- 为签名提供 `CSC_LINK` 或 `CSC_NAME`。
- 为 Apple 公证提供以下任一组合：Apple ID + App 专用密码 + Team ID，App Store Connect API Key + Team ID，或 Keychain Profile + Team ID。
- 运行完成后使用 `spctl --assess --verbose --type exec <Loom.app 路径>`、`codesign --verify --deep --strict --verbose=2 <Loom.app 路径>` 和 `xcrun stapler validate <Loom.app 路径>` 验证签名与公证。
