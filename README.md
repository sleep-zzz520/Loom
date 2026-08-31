# Loom

Loom 是一个本地优先、跨平台（Windows / macOS）的统一桌面工作台。当前已接入待办、日历、备忘录、邮箱、音乐、资料和 Agent 等模块；邮箱支持通用 IMAP 收信与 SMTP 发信，账户授权码通过系统安全存储保护。

## 快速开始

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

`pack:mac` 生成仅供本机验证的 `.app` 目录；`dist:mac:unsigned` 额外生成 `.dmg` 与 `.zip` 安装包到 `desktop/release/`，不可直接向其他用户发布。正式分发必须先准备 Loom 图标、Apple Developer 的 Developer ID 签名和公证凭据，再运行 `npm --prefix desktop run release:mac`。完整发布和升级规则见 [docs/RELEASING.md](docs/RELEASING.md)。

技术栈：Electron + React + TypeScript + Vite。数据默认保存在系统用户数据目录下的 `workbench-data.json`，写入采用原子替换。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
