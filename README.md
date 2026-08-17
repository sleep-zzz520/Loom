# 个人工作台

一个本地优先、跨平台（Windows / macOS）的统一桌面工作台。当前处于第一迭代：应用骨架已经可运行，侧边栏包含 8 个模块，待办模块已接通本地数据链路，其余模块先以占位页呈现，后续按迭代逐个实现。

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
```

技术栈：Electron + React + TypeScript + Vite。数据默认保存在系统用户数据目录下的 `workbench-data.json`，写入采用原子替换。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
