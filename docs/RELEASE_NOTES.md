Loom 首个 GitHub 发行版，包含待办、日历、备忘录、邮箱、音乐、资料和 Agent 工作台。

## 下载与安装

- Windows x64：下载 `Loom-Setup-0.1.0-x64.exe` 并按安装向导操作。支持应用内检查更新，下载与重启安装均由用户确认。
- macOS Apple Silicon：下载 `Loom-0.1.0-arm64.dmg`，将 Loom 拖入“应用程序”。要求 macOS 13 或更新版本；Intel Mac 暂无对应安装包。
- macOS 暂不提供应用内更新。后续下载新版 DMG，退出 Loom 后替换旧应用即可。

安装包未使用付费开发者证书签名，macOS 未公证。系统可能显示身份不明的开发者或 SmartScreen 提示，请确认下载来源后自行处理系统提示。

## 验证范围

发布流水线在 Windows 和 macOS 上运行前端构建与项目自动测试，并分别生成安装包。本机已验证 macOS 页面、IPC、数据持久化、系统凭据加密及音乐搜索播放。

Windows 全新安装、真实邮箱与模型服务、跨版本下载与重启安装仍待实机验收。本版本是首次发布，没有可供升级的更高版本；检查更新显示最新版本属于正常结果。

`latest.yml` 和 `.exe.blockmap` 供 Windows 更新程序使用，用户无需手动打开。`SHA256SUMS.txt` 提供下载文件的 SHA-256 校验值。
