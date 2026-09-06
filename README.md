# Loom

Loom 是一个本地优先、跨平台（Windows / macOS）的统一桌面工作台。当前已接入待办、日历、备忘录、邮箱、音乐、资料和 Agent 等模块；邮箱支持通用 IMAP 收信与 SMTP 发信，账户授权码通过系统安全存储保护。

## 快速开始

开发环境使用 Node.js 22.12 或更新版本（建议 Node.js 24）。当前 Electron 44 运行时要求 macOS 13 或更新版本；Windows 面向 64 位系统，安装包仍需完成独立构建与实机验证。

首次安装依赖（Electron 体积较大，可能需要一两分钟）：

```bash
cd desktop
npm install
cd ..
```

如果 `npm install` 长时间卡住，通常是系统代理挡了 Electron 下载；可以取消代理后重试，或先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 再安装。

启动开发模式：

```bash
npm run dev
```

常用命令：

```bash
npm run typecheck
npm run build
npm run start
npm --prefix desktop run pack:mac
npm --prefix desktop run dist:mac:unsigned
```

依赖安全回归包含在 `npm --prefix desktop test` 中。验证真实 Electron 前端、IPC、主进程和内置服务可运行 `npm --prefix desktop run runtime-smoke-test`；它使用独立的临时数据目录，不读取个人账号或数据，运行前需关闭占用 3000 端口的 Loom 实例。

macOS 使用 `npm --prefix desktop run release:mac` 生成未签名 DMG，供用户下载并手动安装或覆盖更新；不需要 Apple Developer 账号，暂不提供应用内更新。首次打开可能出现系统安全提示。Windows 在 Windows 构建机上设置固定 HTTPS 地址 `LOOM_UPDATE_URL` 后运行 `npm --prefix desktop run release:win`，生成 x64 NSIS 安装包及更新元数据，支持用户确认下载和重启更新。Windows 实机安装与跨版本更新仍需验收。完整步骤见 [docs/RELEASING.md](docs/RELEASING.md)。

技术栈：Electron + React + TypeScript + Vite。数据默认保存在系统用户数据目录下的 `workbench-data.json`，写入采用原子替换。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 下载安装

安装包见 [GitHub Releases](https://github.com/sleep-zzz520/Loom/releases/latest)：Windows 下载 x64 `.exe`，Apple Silicon Mac 下载 arm64 `.dmg`。Windows 保留应用内更新；macOS 下载新版安装包手动更新。系统要求和验证范围见对应版本说明。
