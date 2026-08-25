const workspace = require('./workspace.cjs');
const store = require('./store.cjs');
const music = require('./music.cjs');
const agentState = require('./agent-state.cjs');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_todos',
      description: '读取待办事项，可按完成状态筛选。',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['all', 'open', 'done'] } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_schedule',
      description: '读取日历中的待办日程。返回指定日期范围内带截止时间的事项。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO 日期，例如 2026-08-18' },
          to: { type: 'string', description: 'ISO 日期，例如 2026-08-24' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_notes',
      description: '读取备忘录标题和内容摘要。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_library',
      description: '读取资料库中的资料名称、分类、来源与工作台文档摘要。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_now',
      description: '获取当前日期、时间和时区。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_goals',
      description: '读取当前 Agent 目标、进度和待跟进行动。创建目标或将待办关联到目标前必须先读取。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_memories',
      description: '检索已经审核并生效的长期记忆。不会返回尚未审核的候选记忆。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '当前任务相关的检索关键词' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_skills',
      description: '读取已经启用的可复用 Skill。只有与当前任务相关时才会返回完整步骤。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '当前任务相关的检索关键词' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_music_library',
      description: '读取已同步的音乐账号、歌单及每个歌单的本地曲目覆盖情况。用户询问音乐偏好、歌单或收藏时必须先调用；refresh 为 true 时会从已登录账号刷新歌单列表。',
      parameters: {
        type: 'object',
        properties: { refresh: { type: 'boolean', description: '是否刷新已登录账号的歌单列表；默认只读取本地已同步数据' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_music_playlist',
      description: '读取一个已同步歌单的曲目。没有本地缓存时会按需从已登录账号同步；用于基于真实歌单分析音乐偏好，不能编造曲风或喜好。',
      parameters: {
        type: 'object',
        properties: {
          playlistId: { type: 'number', description: 'get_music_library 返回的真实歌单 ID' },
          refresh: { type: 'boolean', description: '是否强制重新同步这个歌单' },
          limit: { type: 'number', description: '最多返回的曲目数，1 到 300，默认 200' },
        },
        required: ['playlistId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_music',
      description: '搜索音乐服务中的歌曲。搜索结果会同步展示到音乐页；需要播放时，先用此工具取得歌曲 ID。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '歌名、歌手或专辑关键词' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_music',
      description: '播放刚刚通过 search_music 找到的一首歌曲。可使用歌曲 ID，或在用户说“第一首”等跟进请求时使用从 1 开始的结果序号。仅当用户明确要求播放、来一首或试听时调用。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'search_music 返回的歌曲 ID' },
          index: { type: 'number', description: '上一轮搜索结果中从 1 开始的歌曲序号，例如第一首为 1' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_create_todo',
      description: '准备一条待办，必须由用户在界面确认后才会真正创建。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '待办标题' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          due: { type: 'string', description: '截止时间，ISO 8601 格式' },
          goalId: { type: 'string', description: '要关联的进行中 Agent 目标 ID；没有明确关联时省略' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_create_note',
      description: '准备一条备忘录，必须由用户在界面确认后才会真正创建。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '笔记标题' },
          content: { type: 'string', description: '笔记内容' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_save_important_date',
      description: '当用户明确提到自己的生日、纪念日或其他私人重要日期时，准备保存为每年提醒一次的个人日期；必须由用户在界面确认后才会真正保存。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '日期名称，例如 妈妈生日、结婚纪念日' },
          date: { type: 'string', description: '每年重复的月-日，格式 MM-DD，例如 05-20' },
        },
        required: ['title', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_save_preference',
      description: '当用户明确要求记住一条长期有效的工作习惯、沟通偏好或稳定规则时，准备保存到 Agent 的长期规则；必须由用户在界面确认后才会真正保存。不要把一次性任务或临时要求保存为长期偏好。',
      parameters: {
        type: 'object',
        properties: { preference: { type: 'string', description: '一条清晰、长期有效的工作方式或沟通偏好' } },
        required: ['preference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_create_goal',
      description: '准备一个需要持续推进的 Agent 目标，必须由用户在界面确认后才会创建。不要把一次性小任务创建成目标。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '目标标题' },
          description: { type: 'string', description: '目标范围、成功标准或背景' },
          targetDate: { type: 'string', description: '可选目标日期，ISO 8601 格式' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_memory_candidate',
      description: '准备一条候选长期记忆。仅在用户明确要求记住，或内容非常稳定且用户确认值得保存时使用。确认后仍会进入候选区，需用户再审核后才生效。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '清晰、长期有效的记忆内容' },
          kind: { type: 'string', enum: ['preference', 'fact', 'instruction'] },
          replacesId: { type: 'string', description: '可选：将来采纳后要替换的现有长期记忆 ID' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_skill_candidate',
      description: '准备一个候选 Skill，用于沉淀经过验证、可复用的工作流程。确认后仍需用户审核启用，Agent 不能自行启用或修改 Skill。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill 名称' },
          description: { type: 'string', description: '适用场景与产出' },
          instructions: { type: 'string', description: '可执行的步骤；使用换行或编号清楚表达' },
          replacesId: { type: 'string', description: '可选：将来启用后要替换的现有 Skill ID' },
        },
        required: ['name', 'description', 'instructions'],
      },
    },
  },
];

const READ_TOOL_DEFINITIONS = TOOL_DEFINITIONS.filter((tool) => tool.function.name.startsWith('get_'));
const PROACTIVE_CONTEXT_BY_TOOL = {
  get_todos: 'todos',
  get_schedule: 'schedule',
  get_notes: 'notes',
  get_library: 'library',
  get_now: 'current-time',
  get_goals: 'goals',
  get_memories: 'memories',
  get_skills: 'skills',
  get_music_library: 'music',
  get_music_playlist: 'music',
};

function safeText(value, limit = 800) {
  return String(value || '').slice(0, limit);
}

const PERSONALITY_INSTRUCTIONS = {
  calm: '表达沉稳、清晰、有分寸；优先梳理信息和给出可执行下一步，不渲染情绪。',
  warm: '表达温和、体贴、真诚；先理解用户处境再给建议，但不空泛安慰或制造依赖。',
  direct: '表达直接、务实、简洁；优先指出关键事实、风险和最短行动路径，不绕弯子。',
  coach: '表达像一位支持性的教练；通过恰当的问题、阶段目标和复盘帮助用户自己推进，不替用户作价值判断。',
  creative: '表达好奇、开放、富有联想；愿意提供多角度和新颖选项，但要清晰区分事实、假设和灵感。',
};

const PROACTIVE_STYLE_INSTRUCTIONS = {
  important: '主动沟通只说关键事项，措辞短而明确；不要寒暄、不要为了存在感提醒。',
  balanced: '主动沟通友好、简洁，说明为什么现在值得关注，并给出自然的回复入口。',
  companion: '主动沟通可以更有陪伴感，适度关心进展并邀请回复，但不能制造压力、内疚或增加提醒频率。',
};

function getPersona(settings) {
  const source = settings?.agent?.persona && typeof settings.agent.persona === 'object'
    ? settings.agent.persona
    : {};
  const personality = Object.hasOwn(PERSONALITY_INSTRUCTIONS, source.personality) ? source.personality : 'calm';
  const proactiveStyle = Object.hasOwn(PROACTIVE_STYLE_INSTRUCTIONS, source.proactiveStyle) ? source.proactiveStyle : 'balanced';
  return {
    name: safeText(source.name, 32).replace(/\s+/g, ' ').trim() || 'Agent',
    personality,
    proactiveStyle,
    customInstructions: safeText(source.customInstructions, 1200).trim(),
  };
}

function normaliseMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const references = attachments
        .filter((item) => item && item.name && item.content)
        .slice(0, 4)
        .map((item) => `【引用资料：${safeText(item.name, 120)}】\n${safeText(item.content, 4000)}`);
      return {
        role: message.role,
        content: [safeText(message.content, 8000), ...references].filter(Boolean).join('\n\n'),
      };
    })
    .filter((message) => message.content.trim())
    .slice(-30);
}

function buildSystemPrompt(settings, contextQuery = '') {
  const profile = settings.profile || {};
  const persona = getPersona(settings);
  const now = new Date();
  const agentContext = agentState.promptContext(contextQuery);
  const responseLengthInstruction = {
    concise: '回答优先简洁，先给结论，再补充必要细节。',
    balanced: '回答保持适中，先给结论，再说明关键原因和下一步。',
    detailed: '回答可以更完整，但仍然先给结论，并用清晰结构拆分信息。',
  }[profile.responseLength] || '回答保持适中，先给结论，再说明关键原因和下一步。';
  const confirmationInstruction = profile.confirmationMode === 'always-explain'
    ? '涉及多步骤任务时，先简要说明执行计划；涉及新增、修改或删除数据时，仍必须等待用户确认。'
    : '涉及新增、修改或删除数据时，必须先生成确认卡片，等待用户确认。';
  return [
    `你是个人工作台的中文助手。${responseLengthInstruction}`,
    `身份与表达：你的名字是「${persona.name}」。${PERSONALITY_INSTRUCTIONS[persona.personality]}`,
    `主动沟通方式：${PROACTIVE_STYLE_INSTRUCTIONS[persona.proactiveStyle]}`,
    persona.customInstructions ? `用户补充的长期合作约定：${persona.customInstructions}` : '',
    '上述身份设定只影响称呼、表达方式和沟通取舍，不改变事实标准、数据权限、确认流程或安全边界；不要机械重复介绍自己的人设。',
    '普通回答使用简洁的 Markdown 结构：先给结论；需要分组时使用短小的粗体小标题或列表；每个列表项只表达一个动作，避免连续堆叠长段落。',
    confirmationInstruction,
    '工作台中的真实数据必须通过工具读取；不要编造待办、日程、备忘录或资料内容。',
    '当用户询问今天安排、日程或待办时，先调用 get_now，再调用 get_schedule 或 get_todos。',
    '当用户要求新增待办或备忘录时，只能调用 prepare_create_todo 或 prepare_create_note。它们只会生成确认卡片，绝不能声称已经保存。若待办属于现有目标，先调用 get_goals 并在提案中填写真实的 goalId。',
    '当用户表达一个需要持续推进、有成功标准或多个后续行动的事项时，先调用 get_goals；需要新建时使用 prepare_create_goal。一次性小任务应创建待办，而不是目标。',
    '公共节假日与常见日期由系统自动识别。只有用户明确提到自己的生日、纪念日等私人日期时，才调用 prepare_save_important_date；它只会生成确认卡片，绝不能声称已经保存。',
    '只有用户明确说“记住”“以后都按这个”“把这条作为长期规则”等，或确认一条非常稳定的长期信息值得保存时，才调用 prepare_memory_candidate。它会先进入候选记忆区，用户审核采纳后才生效；绝不能声称已经记住。prepare_save_preference 是旧版别名，也必须走同一候选审核流程。',
    '只有当一个流程已经被验证、可复用且有清晰步骤时，才调用 prepare_skill_candidate。它只会创建候选 Skill，用户审核启用前不能声称 Skill 已可用，也不能自行修改已启用 Skill。',
    '当用户询问“我喜欢什么音乐”、歌单、收藏或音乐偏好时，先调用 get_music_library，再对有代表性的本人歌单调用 get_music_playlist。只能依据返回的真实歌曲、艺人、专辑和覆盖范围分析；曲目被截断时要说明样本范围，未登录或未同步时如实说明，不能要求用户重复已有歌单信息。',
    '当用户要求找歌、推荐歌曲、搜索音乐时，调用 search_music。只有用户明确要求播放、来一首或试听时，才在 search_music 后调用 play_music；可使用本轮搜索返回的歌曲 ID，或对上一轮结果使用从 1 开始的序号。音乐工具会同步更新音乐页；不要在工具返回成功前声称已经展示或播放。',
    '不要要求用户提供工作台中已有的信息；需要时调用相应工具。',
    `用户资料：${JSON.stringify({
      name: profile.name || '',
      nickname: profile.nickname || '',
      role: profile.role || '',
      about: profile.about || '',
      currentFocus: profile.currentFocus || '',
      personalDates: settings.notify?.importantDates || [],
    })}`,
    `当前目标：${JSON.stringify(agentContext.goals)}`,
    `已审核的相关长期记忆：${JSON.stringify(agentContext.memories)}`,
    `本轮按需加载的 Skill：${JSON.stringify(agentContext.skills)}`,
    `当前本地时间：${now.toLocaleString('zh-CN', { hour12: false })}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`,
  ].filter(Boolean).join('\n');
}

function readTool(name, args) {
  const snap = workspace.snapshot();
  switch (name) {
    case 'get_todos': {
      const status = args.status || 'all';
      return snap.todos
        .filter((todo) => status === 'all' || (status === 'done' ? todo.done : !todo.done))
        .map((todo) => ({ id: todo.id, title: todo.title, priority: todo.priority, due: todo.due, done: todo.done, repeat: todo.repeat }));
    }
    case 'get_schedule': {
      const from = args.from ? new Date(args.from) : null;
      const to = args.to ? new Date(`${args.to}T23:59:59`) : null;
      return snap.todos
        .filter((todo) => todo.due && !todo.done)
        .filter((todo) => {
          const due = new Date(todo.due);
          return !Number.isNaN(due.getTime()) && (!from || due >= from) && (!to || due <= to);
        })
        .map((todo) => ({ id: todo.id, title: todo.title, priority: todo.priority, due: todo.due }));
    }
    case 'get_notes':
      return snap.notes.map((note) => ({ id: note.id, title: note.title, content: safeText(note.content, 600), updatedAt: note.updatedAt }));
    case 'get_library': {
      const categoryNames = new Map(snap.categories.map((category) => [category.id, category.name]));
      return snap.profileItems.map((item) => ({
        id: item.id,
        name: item.name,
        category: categoryNames.get(item.categoryId) || '未分类',
        source: item.source === 'created' ? '工作台文档' : '已导入文件',
        content: item.source === 'created' ? safeText(item.content, 600) : '',
        updatedAt: item.updatedAt,
      }));
    }
    case 'get_now': {
      const now = new Date();
      return {
        now: now.toISOString(),
        local: now.toLocaleString('zh-CN', { hour12: false }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    case 'get_goals':
      return agentState.listGoals().map((goal) => ({
        id: goal.id,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        targetDate: goal.targetDate,
        progress: goal.summary.progress,
        pendingActions: goal.summary.pending,
        actions: goal.actions.filter((action) => action.status === 'pending').slice(0, 6).map((action) => ({ id: action.id, title: action.title, type: action.type, followUpAt: action.followUpAt })),
      }));
    case 'get_memories':
      return agentState.findRelevantMemories(safeText(args.query, 400), 8).map((memory) => ({ id: memory.id, kind: memory.kind, content: memory.content }));
    case 'get_skills':
      return agentState.selectRelevantSkills(safeText(args.query, 400), 4).map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions }));
    default:
      return { error: `未知读取工具：${name}` };
  }
}

function buildProposal(name, args) {
  if (name === 'prepare_create_todo') {
    const title = safeText(args.title, 200).trim();
    if (!title) return { error: '待办标题不能为空' };
    const due = args.due ? safeText(args.due, 80).trim() || null : null;
    if (due && Number.isNaN(new Date(due).getTime())) return { error: '截止时间无效' };
    const goalId = safeText(args.goalId, 120).trim() || null;
    if (goalId && agentState.getGoal(goalId)?.status !== 'active') return { error: '关联的目标不存在或不处于进行中状态' };
    return {
      proposal: {
        kind: 'create_todo',
        title,
        priority: ['high', 'medium', 'low'].includes(args.priority) ? args.priority : 'medium',
        due,
        goalId,
      },
      content: `已准备好“${title}”${goalId ? '并关联到当前目标' : ''}，确认后才会添加到待办。`,
    };
  }
  if (name === 'prepare_create_note') {
    const title = safeText(args.title, 200).trim();
    const content = safeText(args.content, 5000).trim();
    if (!title || !content) return { error: '笔记需要标题和内容' };
    return {
      proposal: { kind: 'create_note', title, content },
      content: `已整理为“${title}”，确认后才会保存到备忘录。`,
    };
  }
  if (name === 'prepare_save_important_date') {
    const title = safeText(args.title, 200).trim();
    const date = safeText(args.date, 20).trim();
    const match = /^(\d{2})-(\d{2})$/.exec(date);
    const month = match ? Number(match[1]) : 0;
    const day = match ? Number(match[2]) : 0;
    if (!title || !match || month < 1 || month > 12 || day < 1 || day > new Date(2024, month, 0).getDate()) {
      return { error: '重要日期需要名称和有效的 MM-DD 日期' };
    }
    return {
      proposal: { kind: 'save_important_date', title, date },
      content: `已准备好保存“${title}”（每年 ${date}），确认后才会加入你的个人日期。`,
    };
  }
  if (name === 'prepare_save_preference') {
    const preference = safeText(args.preference, 400).replace(/\s+/g, ' ').trim();
    if (!preference) return { error: '长期偏好不能为空' };
    return {
      proposal: { kind: 'save_preference', preference },
      content: `已准备好加入候选工作偏好：“${preference}”。确认后仍需要你在记忆面板审核采纳。`,
    };
  }
  if (name === 'prepare_create_goal') {
    const title = safeText(args.title, 160).trim();
    if (!title) return { error: '目标标题不能为空' };
    const description = safeText(args.description, 1200).trim();
    const targetDate = args.targetDate ? safeText(args.targetDate, 80).trim() || null : null;
    if (targetDate && Number.isNaN(new Date(targetDate).getTime())) return { error: '目标日期无效' };
    return {
      proposal: { kind: 'create_goal', title, description, targetDate },
      content: `已准备好创建目标“${title}”，确认后会开始跟踪它的进度和后续行动。`,
    };
  }
  if (name === 'prepare_memory_candidate') {
    const content = safeText(args.content, 600).replace(/\s+/g, ' ').trim();
    const kind = ['preference', 'fact', 'instruction'].includes(args.kind) ? args.kind : 'preference';
    const replacesId = safeText(args.replacesId, 120).trim() || null;
    if (!content) return { error: '候选记忆不能为空' };
    if (replacesId && !agentState.listMemories({ includeArchived: true }).some((memory) => memory.id === replacesId && memory.status === 'active')) {
      return { error: '要替换的长期记忆不存在或未生效' };
    }
    return {
      proposal: { kind: 'create_memory_candidate', content, memoryKind: kind, replacesId },
      content: '已准备好加入候选长期记忆。确认后仍需要你在“记忆与 Skill”面板审核采纳，才会影响后续对话。',
    };
  }
  if (name === 'prepare_skill_candidate') {
    const nameText = safeText(args.name, 100).trim();
    const description = safeText(args.description, 360).trim();
    const instructions = String(args.instructions || '').trim().slice(0, 5000);
    const replacesId = safeText(args.replacesId, 120).trim() || null;
    if (!nameText || !description || !instructions) return { error: 'Skill 需要名称、用途和可执行步骤' };
    if (replacesId && !agentState.listSkills({ includeArchived: true }).some((skill) => skill.id === replacesId && skill.status === 'active')) {
      return { error: '要替换的 Skill 不存在或未启用' };
    }
    return {
      proposal: { kind: 'create_skill_candidate', name: nameText, description, instructions, replacesId },
      content: '已准备好加入候选 Skill。确认后仍需要你在“记忆与 Skill”面板审核启用，Agent 不会自行加载它。',
    };
  }
  return null;
}

function normaliseProposal(value) {
  if (!value || typeof value !== 'object') return null;
  const nameByKind = {
    create_todo: 'prepare_create_todo',
    create_note: 'prepare_create_note',
    save_important_date: 'prepare_save_important_date',
    save_preference: 'prepare_save_preference',
    create_goal: 'prepare_create_goal',
    create_memory_candidate: 'prepare_memory_candidate',
    create_skill_candidate: 'prepare_skill_candidate',
  };
  const prepared = buildProposal(nameByKind[value.kind], value);
  return prepared?.proposal || null;
}

function normaliseToolCalls(calls) {
  return calls
    .filter((call) => call && call.function && call.function.name)
    .map((call) => ({
      id: call.id || `tool-${Math.random().toString(36).slice(2)}`,
      type: 'function',
      function: { name: call.function.name, arguments: call.function.arguments || '{}' },
    }));
}

async function streamModel(settings, messages, onDelta, tools = TOOL_DEFINITIONS) {
  const base = String(settings.agent.apiBase || '').replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.agent.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.agent.model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: true,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败 (${response.status})：${safeText(text, 300)}`);
  }
  if (!response.body) throw new Error('模型未返回可读取的数据流');

  let content = '';
  const calls = new Map();
  const decoder = new TextDecoder();
  let buffer = '';
  function consume(payload) {
    if (!payload || payload === '[DONE]') return;
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    const delta = data.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === 'string') {
      content += delta.content;
      onDelta(delta.content);
    }
    for (const part of delta.tool_calls || []) {
      const previous = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.id) previous.id = part.id;
      if (part.type) previous.type = part.type;
      if (part.function?.name) previous.function.name += part.function.name;
      if (part.function?.arguments) previous.function.arguments += part.function.arguments;
      calls.set(part.index, previous);
    }
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      consume(event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'));
    }
    if (done) break;
  }
  if (buffer.trim()) {
    consume(buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'));
  }
  return { content, toolCalls: normaliseToolCalls([...calls.values()]) };
}

function parseArguments(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function createMusicState() {
  return { query: '', tracks: [], byId: new Map() };
}

function musicLibrarySummary(library) {
  const playlists = Array.isArray(library?.playlists) ? library.playlists : [];
  const tracksByPlaylist = library?.tracksByPlaylist && typeof library.tracksByPlaylist === 'object'
    ? library.tracksByPlaylist
    : {};
  return {
    account: library?.account
      ? { nickname: library.account.nickname, userId: library.account.userId, signature: library.account.signature || '' }
      : null,
    syncedAt: library?.syncedAt || null,
    selectedPlaylistId: Number.isFinite(Number(library?.selectedPlaylistId)) ? Number(library.selectedPlaylistId) : null,
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.trackCount,
      isMine: Boolean(playlist.isMine),
      subscribed: Boolean(playlist.subscribed),
      cachedTrackCount: Array.isArray(tracksByPlaylist[String(playlist.id)]) ? tracksByPlaylist[String(playlist.id)].length : 0,
    })),
  };
}

function musicTrackLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit)) return 200;
  return Math.min(300, Math.max(1, limit));
}

function isMusicPreferenceQuestion(value) {
  const text = safeText(value, 1000).replace(/\s+/g, ' ');
  return /(喜欢|偏好|口味|品味|常听|爱听).{0,16}(音乐|歌|曲风|风格|类型)/.test(text)
    || /(歌单|收藏).{0,16}(分析|看看|看下|偏好|喜欢|口味)/.test(text)
    || /我.{0,8}(喜欢|常听|爱听).{0,12}(音乐|歌)/.test(text);
}

async function executeMusicTool(name, args, settings, state, musicApi = music, storage = store, options = {}) {
  if (name === 'get_music_library') {
    try {
      const library = args.refresh === true && options.allowSync !== false
        ? await musicApi.syncAccount(settings, storage)
        : await musicApi.accountState(storage);
      const summary = musicLibrarySummary(library);
      if (!summary.account) {
        return { toolResult: { ...summary, error: '还没有已同步的音乐账号。请先在音乐模块登录并同步歌单。' } };
      }
      return { toolResult: summary };
    } catch (error) {
      return { toolResult: { error: error instanceof Error ? error.message : '读取音乐歌单失败' } };
    }
  }
  if (name === 'get_music_playlist') {
    const playlistId = Number(args.playlistId);
    if (!Number.isFinite(playlistId) || playlistId <= 0) {
      return { toolResult: { error: '歌单标识无效，请先通过 get_music_library 读取真实歌单。' } };
    }
    try {
      let library = await musicApi.accountState(storage);
      const playlist = Array.isArray(library?.playlists) ? library.playlists.find((item) => Number(item.id) === playlistId) : null;
      if (!playlist) {
        return { toolResult: { error: '未找到该歌单，请先通过 get_music_library 读取当前账号的歌单。' } };
      }
      let tracks = Array.isArray(library.tracksByPlaylist?.[String(playlistId)]) ? library.tracksByPlaylist[String(playlistId)] : [];
      const needsSync = args.refresh === true || tracks.length === 0;
      if (needsSync) {
        if (options.allowSync === false) {
          return { toolResult: { playlist: { id: playlist.id, name: playlist.name, trackCount: playlist.trackCount }, tracks: [], error: '后台主动检查只读取已缓存的音乐数据，不会自动同步整张歌单。' } };
        }
        const synced = await musicApi.syncPlaylistTracks(playlistId, settings, storage);
        library = synced.library;
        tracks = Array.isArray(synced.tracks) ? synced.tracks : [];
      }
      const limit = musicTrackLimit(args.limit);
      return {
        toolResult: {
          playlist: {
            id: playlist.id,
            name: playlist.name,
            trackCount: playlist.trackCount,
            isMine: Boolean(playlist.isMine),
            subscribed: Boolean(playlist.subscribed),
          },
          tracks: tracks.slice(0, limit).map((track) => ({ id: track.id, title: track.title, artists: track.artists, album: track.album })),
          returnedTrackCount: Math.min(tracks.length, limit),
          availableTrackCount: tracks.length,
          truncated: tracks.length > limit,
          syncedAt: library?.syncedAt || null,
        },
      };
    } catch (error) {
      return { toolResult: { error: error instanceof Error ? error.message : '读取歌单曲目失败' } };
    }
  }
  if (name === 'search_music') {
    const query = safeText(args.query, 80).trim();
    if (!query) return { toolResult: { error: '搜索关键词不能为空' } };
    try {
      const tracks = await musicApi.search(query, settings);
      state.query = query;
      state.tracks = tracks;
      state.byId = new Map(tracks.map((track) => [track.id, track]));
      return {
        toolResult: { query, tracks },
        command: { type: 'show-results', query, tracks },
      };
    } catch (error) {
      return { toolResult: { error: error instanceof Error ? error.message : '音乐搜索失败' } };
    }
  }
  if (name === 'play_music') {
    const id = Number(args.id);
    const index = Number(args.index);
    const track = Number.isFinite(index) && index >= 1
      ? state.tracks[Math.floor(index) - 1]
      : state.byId.get(id);
    if (!track) {
      return { toolResult: { error: '请先通过 search_music 搜索，再使用返回的歌曲 ID 或结果序号播放' } };
    }
    try {
      const source = await musicApi.playbackUrl(id, settings);
      return {
        toolResult: { playing: { id: track.id, title: track.title, artists: track.artists } },
        command: { type: 'play', query: state.query, tracks: state.tracks, track, source },
      };
    } catch (error) {
      return { toolResult: { error: error instanceof Error ? error.message : '歌曲暂时无法播放' } };
    }
  }
  return null;
}

async function preloadMusicPreferenceContext(query, settings, musicApi = music, storage = store) {
  if (!isMusicPreferenceQuestion(query)) return null;
  const state = createMusicState();
  // 用户明确询问自己的偏好时才刷新歌单目录；后台主动检查仍只读缓存。
  const overview = await executeMusicTool('get_music_library', { refresh: true }, settings, state, musicApi, storage);
  const library = overview?.toolResult || { error: '无法读取音乐库' };
  if (library.error || !library.account) {
    return {
      status: 'unavailable',
      reason: library.error || '还没有已同步的音乐账号。',
    };
  }
  const playlists = Array.isArray(library.playlists) ? library.playlists : [];
  const own = playlists.filter((playlist) => playlist.isMine);
  const ranked = [...own, ...playlists]
    .sort((left, right) => Number(right.cachedTrackCount || 0) - Number(left.cachedTrackCount || 0)
      || Number(right.trackCount || 0) - Number(left.trackCount || 0));
  const ids = [library.selectedPlaylistId, ...ranked.map((playlist) => playlist.id)]
    .map(Number)
    .filter((id, index, list) => Number.isFinite(id) && id > 0 && list.indexOf(id) === index)
    .slice(0, 2);
  const samples = [];
  for (const playlistId of ids) {
    const result = await executeMusicTool('get_music_playlist', { playlistId, limit: 120 }, settings, state, musicApi, storage);
    const data = result?.toolResult;
    if (data?.playlist && Array.isArray(data.tracks) && data.tracks.length) samples.push(data);
  }
  return {
    status: samples.length ? 'ready' : 'empty',
    account: library.account,
    syncedAt: library.syncedAt,
    playlistCount: playlists.length,
    ownPlaylistCount: own.length,
    samples,
    reason: samples.length ? '' : '歌单已读取，但其中还没有可供分析的曲目。',
  };
}

async function runAgent(messages, settings, onDelta = () => {}, options = {}) {
  if (!settings.agent?.apiBase || !settings.agent?.apiKey || !settings.agent?.model) {
    throw new Error('请先在设置中配置 Agent 的 API 地址、密钥和模型');
  }
  const normalisedMessages = normaliseMessages(messages);
  const latestUserMessage = [...normalisedMessages].reverse().find((message) => message.role === 'user');
  const preferenceContext = await preloadMusicPreferenceContext(
    latestUserMessage?.content || '',
    settings,
    options.musicApi || music,
    options.musicStorage || store,
  );
  const systemPrompt = [
    buildSystemPrompt(settings, latestUserMessage?.content || ''),
    preferenceContext
      ? `本轮音乐偏好预读取（真实数据，优先据此直接回答，不要再说“没有记录”）：${JSON.stringify(preferenceContext)}`
      : '',
    preferenceContext?.status === 'ready'
      ? '基于音乐预读取回答时，先给出你观察到的偏好，再列出代表性歌手、歌曲或歌单；清楚说明样本来自哪些歌单和曲目数，不要把有限样本说成完整听歌历史。'
      : preferenceContext
        ? '音乐预读取不可用或没有可分析曲目时，如实说明具体原因与最短恢复步骤；不要要求用户口述自己的音乐偏好。'
        : '',
  ].filter(Boolean).join('\n');
  const full = [{ role: 'system', content: systemPrompt }, ...normalisedMessages];
  const musicState = options.musicState || createMusicState();
  for (let index = 0; index < 8; index += 1) {
    const result = await streamModel(settings, full, onDelta);
    if (!result.toolCalls.length) return { content: result.content.trim() || '我没有生成有效回复，请换一种说法。' };
    full.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const args = parseArguments(call.function.arguments);
      const musicResult = await executeMusicTool(call.function.name, args, settings, musicState, options.musicApi || music, options.musicStorage || store);
      if (musicResult) {
        if (musicResult.command) options.onMusicCommand?.(musicResult.command);
        full.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(musicResult.toolResult) });
        continue;
      }
      const prepared = buildProposal(call.function.name, args);
      if (prepared) {
        if (prepared.error) {
          full.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(prepared) });
          continue;
        }
        return prepared;
      }
      full.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(readTool(call.function.name, args)) });
    }
  }
  throw new Error('Agent 工具调用次数过多，请重新提问');
}

function parseProactiveResponse(value) {
  const raw = String(value || '').trim();
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return { action: 'no_action' };
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { action: 'no_action' };
  }
  if (!parsed || parsed.action === 'no_action') return { action: 'no_action' };
  if (parsed.action !== 'notify') return { action: 'no_action' };
  const title = safeText(parsed.title, 120).trim();
  const summary = safeText(parsed.summary, 1200).trim();
  if (!title || !summary) return { action: 'no_action' };
  const references = Array.isArray(parsed.references)
    ? parsed.references
      .filter((reference) => reference && ['todo', 'schedule', 'note', 'library'].includes(reference.type) && reference.id && reference.label)
      .slice(0, 6)
      .map((reference) => ({
        type: reference.type,
        id: safeText(reference.id, 120),
        label: safeText(reference.label, 160),
      }))
    : [];
  const proposal = normaliseProposal(parsed.proposal);
  const goalId = safeText(parsed.goalId, 120).trim() || null;
  const linkedGoal = goalId ? agentState.getGoal(goalId) : null;
  return {
    action: 'notify',
    title,
    summary,
    reason: safeText(parsed.reason, 600).trim() || 'Agent 根据工作台中的近期信息判断这件事值得你关注。',
    references,
    proposal,
    goalId: linkedGoal && ['active', 'paused'].includes(linkedGoal.status) ? linkedGoal.id : null,
  };
}

async function runProactive(settings, now = new Date(), options = {}) {
  if (!settings.agent?.apiBase || !settings.agent?.apiKey || !settings.agent?.model) {
    throw new Error('请先在设置中配置 Agent 的 API 地址、密钥和模型');
  }
  const trigger = options.trigger === 'event-follow-up' ? 'event-follow-up' : 'daily-briefing';
  const changeSummary = safeText(options.changeSummary, 800).trim();
  const isEventFollowUp = trigger === 'event-follow-up';
  const contextTypes = new Set();
  const full = [
    {
      role: 'system',
      content: [
        buildSystemPrompt(settings, changeSummary),
        '你现在执行的是个人工作台的后台主动检查，不是在回答用户即时提问。',
        '本轮只能调用 get_now、get_todos、get_schedule、get_notes、get_library、get_goals、get_memories、get_skills、get_music_library、get_music_playlist 等读取工具，不能创建、修改或删除任何数据。音乐只可读取已缓存数据，不能在后台自动同步整张歌单。',
        isEventFollowUp
          ? '工作台刚刚发生了变化。请判断这次变化是否与用户当前重点、近期安排或已有资料形成了一个真实且现在值得跟进的事情；如果没有，请返回 no_action。不要为了“看起来有用”而制造提醒。'
          : '只有发现真实、具体、现在值得用户关注的事情时才主动提醒；如果没有，请返回 no_action。不要为了“看起来有用”而制造提醒。',
        isEventFollowUp
          ? '事件跟进提醒要关注“变化之后下一步是否值得做”，例如新待办临近截止、资料更新后需要补充行动、笔记内容与当前安排产生关联；不要仅仅复述用户刚刚做了什么。'
          : '每日主动简报重点关注今天和未来 48 小时内的安排、已超期或长期未完成的开放待办、最近需要准备的事情，以及近期新增资料或备忘录中与当前重点有关的内容。',
        '输出必须是一个 JSON 对象，不要输出 Markdown、解释文字或代码围栏。',
        '有提醒时格式：{"action":"notify","title":"不超过 20 个字的标题","summary":"简洁说明发生了什么以及建议关注什么","reason":"说明为什么现在提醒","goalId":"可选的真实进行中目标 ID","references":[{"type":"todo|schedule|note|library","id":"真实数据 ID","label":"数据名称"}],"proposal":{"kind":"create_todo","title":"明确的下一步","priority":"high|medium|low","due":"ISO 时间或 null","goalId":"与 goalId 相同或省略"}}。',
        '只有下一步非常明确、值得用户直接安排时才附带 proposal；proposal 只会进入待确认卡片，不会在后台自动创建。没有明确下一步时省略 proposal。',
        '没有值得提醒的事情时只输出：{"action":"no_action"}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: isEventFollowUp
        ? `请执行一次事件跟进检查。当前时间是 ${now.toLocaleString('zh-CN', { hour12: false })}。刚刚发生的变化：${changeSummary || '工作台中的数据发生了更新，但具体来源未知。'}。请结合读取到的真实工作台数据，最多生成一条最重要的跟进提醒。`
        : `请执行今天的主动简报检查。当前时间是 ${now.toLocaleString('zh-CN', { hour12: false })}。重点关注：今天和未来 48 小时内的安排、已超期或长期未完成的开放待办、最近需要准备的事情，以及近期新增资料或备忘录中与当前重点有关的内容。最多生成一条最重要的主动提醒。`,
    },
  ];
  const musicState = createMusicState();
  for (let index = 0; index < 6; index += 1) {
    const result = await streamModel(settings, full, () => {}, READ_TOOL_DEFINITIONS);
    if (!result.toolCalls.length) return { ...parseProactiveResponse(result.content), contextTypes: [...contextTypes] };
    full.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const args = parseArguments(call.function.arguments);
      const isReadTool = READ_TOOL_DEFINITIONS.some((tool) => tool.function.name === call.function.name);
      if (isReadTool && PROACTIVE_CONTEXT_BY_TOOL[call.function.name]) {
        contextTypes.add(PROACTIVE_CONTEXT_BY_TOOL[call.function.name]);
      }
      const musicResult = await executeMusicTool(call.function.name, args, settings, musicState, music, store, { allowSync: false });
      full.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(musicResult?.toolResult || (isReadTool ? readTool(call.function.name, args) : { error: '后台主动检查不允许执行写入工具' })),
      });
    }
  }
  throw new Error('Agent 主动检查的读取次数过多，请稍后重试');
}

function confirmProposal(proposal) {
  const safeProposal = normaliseProposal(proposal);
  if (!safeProposal) throw new Error('确认内容无效或已过期');
  if (safeProposal.kind === 'create_todo') {
    const todos = workspace.createTodo({
      title: safeProposal.title,
      priority: safeProposal.priority,
      due: safeProposal.due || null,
      agentGoalId: safeProposal.goalId || null,
    });
    const goal = safeProposal.goalId ? agentState.getGoal(safeProposal.goalId) : null;
    return { content: `已添加待办“${todos[0].title}”${goal ? `，并关联到目标“${goal.title}”` : ''}。` };
  }
  if (safeProposal.kind === 'create_note') {
    const notes = workspace.saveNote({ title: safeProposal.title, content: safeProposal.content });
    return { content: `已保存备忘录“${notes[0].title}”。` };
  }
  if (safeProposal.kind === 'save_important_date') {
    const settings = store.getSettings();
    const dates = Array.isArray(settings.notify?.importantDates) ? settings.notify.importantDates : [];
    if (dates.some((item) => item.title === safeProposal.title && item.date === safeProposal.date)) {
      return { content: `个人日期“${safeProposal.title}”已存在。` };
    }
    store.setSettings({
      notify: {
        importantDates: [...dates, { id: store.newId(), title: safeProposal.title, date: safeProposal.date }],
      },
    });
    return { content: `已记住：每年 ${safeProposal.date} 是“${safeProposal.title}”。` };
  }
  if (safeProposal.kind === 'save_preference') {
    const existing = agentState.listMemories({ includeArchived: true }).find((memory) => (
      memory.content === safeProposal.preference && ['candidate', 'active'].includes(memory.status)
    ));
    if (existing?.status === 'active') {
      return { content: `这条工作偏好已经生效：“${safeProposal.preference}”。` };
    }
    const memory = existing || agentState.createMemoryCandidate({
      content: safeProposal.preference,
      kind: 'preference',
      source: 'legacy-preference-confirmed',
    });
    return { content: `已加入候选工作偏好：“${memory.content}”。请在记忆与 Skill 面板审核采纳。` };
  }
  if (safeProposal.kind === 'create_goal') {
    const goal = agentState.createGoal({
      title: safeProposal.title,
      description: safeProposal.description,
      targetDate: safeProposal.targetDate,
    });
    return { content: `已开始跟踪目标“${goal.title}”。后续待办和主动建议可以关联到它。` };
  }
  if (safeProposal.kind === 'create_memory_candidate') {
    const memory = agentState.createMemoryCandidate({
      content: safeProposal.content,
      kind: safeProposal.memoryKind,
      replacesId: safeProposal.replacesId,
      source: 'chat-confirmed',
    });
    return { content: `已加入候选长期记忆：“${memory.content}”。请在记忆与 Skill 面板审核后启用。` };
  }
  if (safeProposal.kind === 'create_skill_candidate') {
    const skill = agentState.createSkillCandidate({
      name: safeProposal.name,
      description: safeProposal.description,
      instructions: safeProposal.instructions,
      replacesId: safeProposal.replacesId,
      source: 'chat-confirmed',
    });
    return { content: `已加入候选 Skill“${skill.name}”。请在记忆与 Skill 面板审核后启用。` };
  }
  throw new Error('暂不支持该确认操作');
}

function getStatus(settings) {
  return Boolean(settings.agent?.apiBase && settings.agent?.apiKey && settings.agent?.model);
}

module.exports = { runAgent, runProactive, parseProactiveResponse, confirmProposal, getStatus, getPersona, buildProposal, createMusicState, executeMusicTool, isMusicPreferenceQuestion, preloadMusicPreferenceContext };

if (process.env.WORKBENCH_AGENT_SELF_TEST === '1') {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(`${os.tmpdir()}/workbench-agent-self-test-`);
  const todo = buildProposal('prepare_create_todo', { title: '自检待办', priority: 'high' });
  const note = buildProposal('prepare_create_note', { title: '自检笔记', content: '自检内容' });
  const importantDate = buildProposal('prepare_save_important_date', { title: '自检纪念日', date: '05-20' });
  const preference = buildProposal('prepare_save_preference', { preference: '先讲结论，再说明原因' });
  const goalProposal = buildProposal('prepare_create_goal', { title: '完成自检目标', description: '验证目标和待办关联' });
  const memoryProposal = buildProposal('prepare_memory_candidate', { content: '自检时先验证主流程。', kind: 'instruction' });
  const skillProposal = buildProposal('prepare_skill_candidate', { name: '自检流程', description: '运行最小验证。', instructions: '1. 运行检查。\n2. 记录结果。' });
  if (todo.proposal?.kind !== 'create_todo' || note.proposal?.kind !== 'create_note' || importantDate.proposal?.kind !== 'save_important_date' || preference.proposal?.kind !== 'save_preference' || goalProposal.proposal?.kind !== 'create_goal' || memoryProposal.proposal?.kind !== 'create_memory_candidate' || skillProposal.proposal?.kind !== 'create_skill_candidate') {
    throw new Error('agent proposal self-test failed');
  }
  if (!normaliseMessages([{ role: 'user', content: '总结资料', attachments: [{ name: '自检文档', content: '自检正文' }] }])[0].content.includes('自检正文')) {
    throw new Error('agent attachment self-test failed');
  }
  if (parseProactiveResponse('{"action":"notify","title":"检查","summary":"有一件事需要关注","reason":"临近截止"}').action !== 'notify') {
    throw new Error('agent proactive response self-test failed');
  }
  const proactiveWithProposal = parseProactiveResponse('{"action":"notify","title":"准备方案","summary":"方案即将到期","proposal":{"kind":"create_todo","title":"确认方案下一步","priority":"high","due":"2026-08-23T12:00:00.000Z"}}');
  if (proactiveWithProposal.proposal?.kind !== 'create_todo' || proactiveWithProposal.proposal.priority !== 'high') {
    throw new Error('agent proactive proposal self-test failed');
  }
  if (parseProactiveResponse('{"action":"notify","title":"","summary":"无效"}').action !== 'no_action') {
    throw new Error('agent proactive response guard self-test failed');
  }
  if (!buildProposal('prepare_create_todo', { title: '无效截止时间', due: 'not-a-date' }).error) {
    throw new Error('agent proposal validation self-test failed');
  }
  if (!buildProposal('prepare_save_preference', { preference: '  ' }).error) {
    throw new Error('agent preference validation self-test failed');
  }
  try {
    store.init(dir);
    const persona = getPersona({ agent: { persona: { name: '小栖', personality: 'coach', proactiveStyle: 'companion', customInstructions: '保持坦诚，少用表情。' } } });
    if (persona.name !== '小栖' || persona.personality !== 'coach' || persona.proactiveStyle !== 'companion') {
      throw new Error('agent persona self-test failed');
    }
    const personaPrompt = buildSystemPrompt({ profile: {}, notify: {}, agent: { persona } });
    if (!personaPrompt.includes('你的名字是「小栖」') || !personaPrompt.includes('保持坦诚，少用表情。') || !personaPrompt.includes('get_music_library')) {
      throw new Error('agent persona prompt self-test failed');
    }
    if (workspace.listTodos().length !== 0) throw new Error('proposal must not create a todo');
    confirmProposal(todo.proposal);
    if (workspace.listTodos().length !== 1) throw new Error('confirmed proposal did not create a todo');
    confirmProposal(importantDate.proposal);
    if (store.getSettings().notify.importantDates.length !== 1) throw new Error('confirmed important date did not save');
    confirmProposal(preference.proposal);
    if (!agentState.listMemories().some((memory) => memory.content === '先讲结论，再说明原因' && memory.status === 'candidate')) throw new Error('confirmed preference did not create a candidate');
    if (!confirmProposal(preference.proposal).content.includes('候选工作偏好')) throw new Error('duplicate preference should be idempotent');
    confirmProposal(goalProposal.proposal);
    const goal = agentState.listGoals()[0];
    const linkedTodo = buildProposal('prepare_create_todo', { title: '目标内待办', goalId: goal.id });
    confirmProposal(linkedTodo.proposal);
    if (agentState.getGoal(goal.id)?.summary.total !== 1) throw new Error('goal todo link did not persist');
    confirmProposal(memoryProposal.proposal);
    if (agentState.listMemories()[0]?.status !== 'candidate') throw new Error('memory candidate did not persist');
    confirmProposal(skillProposal.proposal);
    if (agentState.listSkills()[0]?.status !== 'candidate') throw new Error('skill candidate did not persist');
    try {
      confirmProposal({ kind: 'create_todo', title: '' });
      throw new Error('invalid proposal should be rejected');
    } catch (error) {
      if (!String(error.message).includes('确认内容无效')) throw error;
    }
    console.log('agent self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
