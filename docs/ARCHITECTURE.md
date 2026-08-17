# 个人工作台架构

## 目标

一个 App 包含所有模块：待办、日历、备忘录、邮箱、Agent、音乐、个人资料、设置。本轮先搭建统一桌面框架，后续模块按迭代逐个接入。

## 分层

```text
React 页面组件（src/modules/*）
        │ window.workbench.*
        ▼
Electron 预加载桥（electron/preload.cjs）
        │ IPC
        ▼
主进程服务（electron/main.cjs 注册 IPC）
        │
        ▼
本地数据层（electron/store.cjs）
        │
        ▼
JSON 文件（系统用户数据目录 / workbench-data.json）
```

渲染进程不直接访问 Node，所有数据读写通过 `window.workbench.data.*` 调用 IPC。

## 模块约定

每个模块 = 页面组件 + 数据 key + IPC 接口：

1. 页面组件放在 `src/modules/<Module>.tsx`。
2. 在 `src/App.tsx` 的侧边栏数组注册菜单项。
3. 数据写入 `store.cjs` 的 `modules.<key>`；新增模块只需在默认数据里预留一个 key，页面通过通用接口 `getModule(name)` / `setModule(name, items)` 读写。

当前预留数据 key：

| key | 用途 |
| --- | --- |
| `modules.todos` | 待办 |
| `modules.events` | 日历事件 |
| `modules.notes` | 备忘录 |
| `modules.profileItems` | 个人资料条目 |
| `modules.categories` | 资料自定义分类 |

`settings` 已预留 `profile / email / netease / notify / agent / sync` 分组，供后续模块配置使用。

## 如何新增一个模块

1. 在默认数据里增加 `modules.<key>` 初始值。
2. 新建 `src/modules/<Module>.tsx`，通过 `window.workbench.data.getModule('<key>')` 读取、`setModule('<key>', items)` 写入。
3. 在 `src/App.tsx` 添加菜单项，并把占位页替换为真实组件。
4. 为需要主进程能力的模块（邮箱、网易云、Agent、通知、同步）在 `main.cjs` 注册专用 IPC，并在 `preload.cjs` 暴露类型化接口。

## 后续迭代顺序

1. 待办（已完成样板）
2. 日历（整合日程与待办）
3. 备忘录
4. 个人资料（分类 + 隐私分级）
5. 邮箱（IMAP / SMTP）
6. 网易云音乐
7. Agent（绑定个人资料、时间、待办）
8. 多端同步服务

## 已知边界

- 当前本地数据为 JSON 文件，单用户、单进程场景足够；后续可平滑迁移到 SQLite，IPC 接口保持不变。
- 模块写入采用整数组替换，未做并发合并；主窗口单实例场景下没有冲突。
