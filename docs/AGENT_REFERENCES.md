# Agent 参考项目与架构决策

## 结论

OpenClaw 和 Hermes 对本项目都有参考价值，但不直接作为项目依赖引入，也不照搬它们的完整产品形态。

- OpenClaw 主要参考“主动 Agent 的运行时”：Gateway / 控制平面、heartbeat、定时自动化、事件唤醒、独立运行、结果送达和权限控制。
- Hermes 主要参考“Agent 的记忆与成长”：持久记忆、用户画像、技能系统、按需加载、跨会话搜索、经验沉淀和无人值守任务。
- 我们最终要做的是服务于个人工作台的主动智能层，而不是通用型万能 Agent。

这里的 Hermes 指 Nous Research 的 Hermes Agent。

## 与我们的目标的关系

我们的 Agent 不是等待用户提问的聊天工具，而是持续运行在工作台之上的主动智能中枢。聊天只是交互入口之一。

```text
OpenClaw 的主动运行时
          +
Hermes 的记忆与技能
          +
个人工作台的数据、权限和交互
          ↓
服务于个人工作流的主动 Agent
```

## 重点参考 OpenClaw 的部分

### 1. 主动运行时

Agent 需要在后台持续运行，并能被不同类型的信号唤醒：

- heartbeat：周期性检查工作台状态。
- automation / cron：在明确的时间执行任务。
- event：待办、日历、资料或用户行为发生变化时触发。
- webhook / external event：未来接入邮箱或其他外部服务时触发。

这些触发方式要分开设计，不能全部实现成一个无条件调用大模型的定时器。

### 2. 规则判断与 Agent 判断分层

确定性规则先筛选候选事件，只有确实需要理解上下文时才唤醒 LLM：

```text
规则层：免打扰、频率、去重、时间窗口、重要性
                         ↓
                 是否值得唤醒 Agent
                         ↓
            Agent 汇总上下文并判断下一步
```

例如，判断待办是否超期不需要 LLM；判断一个长期未完成的待办是否应该拆解或改期，才需要 Agent。

### 3. 独立的主动运行

主动检查不能污染用户当前的聊天会话。每次主动运行都应该有自己的记录：

- trigger：什么触发了本次运行。
- context：读取了哪些工作台信息。
- decision：Agent 做出了什么判断。
- delivery：是否向用户送达以及通过什么渠道送达。
- approval：是否需要用户确认。
- follow-up：下一次跟进的条件或时间。

### 4. 权限和送达策略

主动能力必须受权限、免打扰时间、提醒频率和数据范围控制。读取和分析是默认能力；新增、修改、删除等有副作用的动作默认需要确认，后续再通过明确设置开放安全的自动执行范围。

## 重点参考 Hermes 的部分

### 1. 区分 Memory 和 Skill

- Memory：用户是谁、用户的偏好、项目背景、长期事实和已经确认的规则。
- Skill：某类任务应该如何完成的可复用流程。

不能把所有信息都塞进一个越来越长的系统提示词里。

### 2. 记忆要有边界和审批

Agent 不应该默认永久保存所有聊天内容。应区分：

- 用户明确要求记住的内容。
- 用户长期重复表达并已被确认的偏好。
- 仅对当前任务有效的临时上下文。
- Agent 推测出的、尚未确认的候选记忆。

推测出的内容先进入候选状态；记忆写入、替换和删除都应该可审查，不能让 Agent 无限制地修改自己的长期规则。

### 3. 技能按需加载并允许沉淀

复杂任务完成后，可以把经过验证的流程提议为 Skill；Skill 只在相关任务中加载，避免每次对话都增加上下文成本。Agent 可以提议修改 Skill，但核心行为规则不能默认无审批自我修改。

### 4. 不需要 LLM 的任务直接执行

简单的 watchdog、阈值检查和心跳可以由脚本或确定性服务完成；只有需要理解、归纳和规划的部分才进入 Agent 回合。这可以降低成本、延迟和误报。

## 不直接照搬的部分

- 暂时不引入 OpenClaw 的多渠道、插件市场和通用设备控制复杂度。
- 暂时不把 Agent 做成可以任意操作电脑的通用执行器。
- 不让 LLM 每分钟无条件自我思考。
- 不允许 Agent 无审批地修改自己的记忆、权限、规则和技能。
- 不自动读取所有私人数据；每个工具需要明确数据范围和用途。
- 不把“有定时提醒”误认为“已经实现主动 Agent”。

## 对本项目的落地映射

- `electron/notifier.cjs`：保留确定性提醒规则，逐步扩展为事件和调度基础设施。
- `electron/agent.cjs`：保留模型调用、工具注册和确认卡片，抽出可以被聊天和主动运行共同使用的 Agent Runtime。
- `src/modules/Agent.tsx`：承载聊天、主动发现、待处理建议、当前目标、确认卡片、行动结果、候选记忆和候选 Skill 审核。
- `electron/agent-state.cjs`：统一校验和持久化目标、目标行动、候选记忆和候选 Skill，并把待办/建议状态同步回目标进度。
- `electron/store.cjs`：保存主动运行记录、建议队列、用户目标、候选记忆、Skill 和跟进状态。
- `src/types.ts`：将聊天消息、主动建议、行动提案、运行记录、目标、记忆和 Skill 建模为不同数据类型。

目标架构：

```text
Electron 主进程 / Agent Runtime
├─ Event Bus：时间、数据变化、用户行为、外部事件
├─ Deterministic Rules：去重、频率、免打扰、重要性
├─ Agent Runs：上下文、记忆、Skill、推理、结构化结果
├─ Policy / Approval：建议、通知、确认、自动执行
├─ Suggestion Queue：主动建议、待确认操作、后续跟进
└─ Delivery：Agent 页面、桌面通知、手机推送
```

## 最小验证闭环

第一阶段优先验证一个完整的主动场景，不先做通用平台：

```text
每天早上检查工作台
  → 找出今天最值得关注的 1～3 件事
  → 生成主动建议
  → 在 Agent 页面和桌面通知中出现
  → 用户确认后创建计划或待办
  → Agent 记录结果并在之后跟进
```

当前已落地的第二阶段事件闭环：

```text
待办 / 备忘录 / 资料库发生变化
  → 主进程合并短时间内的连续变化
  → Agent 只读检查变化是否值得跟进
  → 生成“主动跟进”建议或返回 no_action
  → 每日最多三次事件跟进，和每日简报独立计数
```

## 官方参考资料

- [OpenClaw README](https://github.com/openclaw/openclaw/blob/main/README.md)
- [OpenClaw Personal Assistant Setup](https://github.com/openclaw/openclaw/blob/main/docs/start/openclaw.md)
- [OpenClaw Automation / Cron](https://github.com/openclaw/openclaw/blob/main/docs/automation/cron-jobs.md)
- [OpenClaw Security](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md)
- [Hermes Agent README](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent Loop Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop/)
- [Hermes Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)
- [Hermes Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
- [Hermes Scheduled Tasks](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/)
