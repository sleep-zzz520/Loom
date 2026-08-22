const workspace = require('./workspace.cjs');
const store = require('./store.cjs');

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
      name: 'prepare_create_todo',
      description: '准备一条待办，必须由用户在界面确认后才会真正创建。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '待办标题' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          due: { type: 'string', description: '截止时间，ISO 8601 格式' },
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
];

const READ_TOOL_DEFINITIONS = TOOL_DEFINITIONS.filter((tool) => tool.function.name.startsWith('get_'));

function safeText(value, limit = 800) {
  return String(value || '').slice(0, limit);
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

function buildSystemPrompt(settings) {
  const profile = settings.profile || {};
  const now = new Date();
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
    confirmationInstruction,
    '工作台中的真实数据必须通过工具读取；不要编造待办、日程、备忘录或资料内容。',
    '当用户询问今天安排、日程或待办时，先调用 get_now，再调用 get_schedule 或 get_todos。',
    '当用户要求新增待办或备忘录时，只能调用 prepare_create_todo 或 prepare_create_note。它们只会生成确认卡片，绝不能声称已经保存。',
    '公共节假日与常见日期由系统自动识别。只有用户明确提到自己的生日、纪念日等私人日期时，才调用 prepare_save_important_date；它只会生成确认卡片，绝不能声称已经保存。',
    '不要要求用户提供工作台中已有的信息；需要时调用相应工具。',
    `用户资料：${JSON.stringify({
      name: profile.name || '',
      nickname: profile.nickname || '',
      role: profile.role || '',
      about: profile.about || '',
      currentFocus: profile.currentFocus || '',
      preferences: profile.preferences || [],
      personalDates: settings.notify?.importantDates || [],
    })}`,
    `当前本地时间：${now.toLocaleString('zh-CN', { hour12: false })}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`,
  ].join('\n');
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
    default:
      return { error: `未知读取工具：${name}` };
  }
}

function buildProposal(name, args) {
  if (name === 'prepare_create_todo') {
    const title = String(args.title || '').trim();
    if (!title) return { error: '待办标题不能为空' };
    return {
      proposal: {
        kind: 'create_todo',
        title,
        priority: ['high', 'medium', 'low'].includes(args.priority) ? args.priority : 'medium',
        due: args.due ? String(args.due) : null,
      },
      content: `已准备好“${title}”，确认后才会添加到待办。`,
    };
  }
  if (name === 'prepare_create_note') {
    const title = String(args.title || '').trim();
    const content = String(args.content || '').trim();
    if (!title || !content) return { error: '笔记需要标题和内容' };
    return {
      proposal: { kind: 'create_note', title, content },
      content: `已整理为“${title}”，确认后才会保存到备忘录。`,
    };
  }
  if (name === 'prepare_save_important_date') {
    const title = String(args.title || '').trim();
    const date = String(args.date || '').trim();
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
  return null;
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

async function runAgent(messages, settings, onDelta = () => {}) {
  if (!settings.agent?.apiBase || !settings.agent?.apiKey || !settings.agent?.model) {
    throw new Error('请先在设置中配置 Agent 的 API 地址、密钥和模型');
  }
  const full = [{ role: 'system', content: buildSystemPrompt(settings) }, ...normaliseMessages(messages)];
  for (let index = 0; index < 8; index += 1) {
    const result = await streamModel(settings, full, onDelta);
    if (!result.toolCalls.length) return { content: result.content.trim() || '我没有生成有效回复，请换一种说法。' };
    full.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const args = parseArguments(call.function.arguments);
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
  return {
    action: 'notify',
    title,
    summary,
    reason: safeText(parsed.reason, 600).trim() || 'Agent 根据工作台中的近期信息判断这件事值得你关注。',
    references,
  };
}

async function runProactive(settings, now = new Date(), options = {}) {
  if (!settings.agent?.apiBase || !settings.agent?.apiKey || !settings.agent?.model) {
    throw new Error('请先在设置中配置 Agent 的 API 地址、密钥和模型');
  }
  const trigger = options.trigger === 'event-follow-up' ? 'event-follow-up' : 'daily-briefing';
  const changeSummary = safeText(options.changeSummary, 800).trim();
  const isEventFollowUp = trigger === 'event-follow-up';
  const full = [
    {
      role: 'system',
      content: [
        buildSystemPrompt(settings),
        '你现在执行的是个人工作台的后台主动检查，不是在回答用户即时提问。',
        '本轮只能调用 get_now、get_todos、get_schedule、get_notes、get_library 等读取工具，不能创建、修改或删除任何数据。',
        isEventFollowUp
          ? '工作台刚刚发生了变化。请判断这次变化是否与用户当前重点、近期安排或已有资料形成了一个真实且现在值得跟进的事情；如果没有，请返回 no_action。不要为了“看起来有用”而制造提醒。'
          : '只有发现真实、具体、现在值得用户关注的事情时才主动提醒；如果没有，请返回 no_action。不要为了“看起来有用”而制造提醒。',
        isEventFollowUp
          ? '事件跟进提醒要关注“变化之后下一步是否值得做”，例如新待办临近截止、资料更新后需要补充行动、笔记内容与当前安排产生关联；不要仅仅复述用户刚刚做了什么。'
          : '每日主动简报重点关注今天和未来 48 小时内的安排、已超期或长期未完成的开放待办、最近需要准备的事情，以及近期新增资料或备忘录中与当前重点有关的内容。',
        '输出必须是一个 JSON 对象，不要输出 Markdown、解释文字或代码围栏。',
        '有提醒时格式：{"action":"notify","title":"不超过 20 个字的标题","summary":"简洁说明发生了什么以及建议关注什么","reason":"说明为什么现在提醒","references":[{"type":"todo|schedule|note|library","id":"真实数据 ID","label":"数据名称"}]}。',
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
  for (let index = 0; index < 6; index += 1) {
    const result = await streamModel(settings, full, () => {}, READ_TOOL_DEFINITIONS);
    if (!result.toolCalls.length) return parseProactiveResponse(result.content);
    full.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const args = parseArguments(call.function.arguments);
      const isReadTool = READ_TOOL_DEFINITIONS.some((tool) => tool.function.name === call.function.name);
      full.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(isReadTool ? readTool(call.function.name, args) : { error: '后台主动检查不允许执行写入工具' }),
      });
    }
  }
  throw new Error('Agent 主动检查的读取次数过多，请稍后重试');
}

function confirmProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') throw new Error('确认内容无效');
  if (proposal.kind === 'create_todo') {
    const todos = workspace.createTodo({ title: proposal.title, priority: proposal.priority, due: proposal.due || null });
    return { content: `已添加待办“${todos[0].title}”。` };
  }
  if (proposal.kind === 'create_note') {
    const notes = workspace.saveNote({ title: proposal.title, content: proposal.content });
    return { content: `已保存备忘录“${notes[0].title}”。` };
  }
  if (proposal.kind === 'save_important_date') {
    const settings = store.getSettings();
    const dates = Array.isArray(settings.notify?.importantDates) ? settings.notify.importantDates : [];
    if (dates.some((item) => item.title === proposal.title && item.date === proposal.date)) {
      return { content: `个人日期“${proposal.title}”已存在。` };
    }
    store.setSettings({
      notify: {
        importantDates: [...dates, { id: store.newId(), title: proposal.title, date: proposal.date }],
      },
    });
    return { content: `已记住：每年 ${proposal.date} 是“${proposal.title}”。` };
  }
  throw new Error('暂不支持该确认操作');
}

function getStatus(settings) {
  return Boolean(settings.agent?.apiBase && settings.agent?.apiKey && settings.agent?.model);
}

module.exports = { runAgent, runProactive, parseProactiveResponse, confirmProposal, getStatus, buildProposal };

if (process.env.WORKBENCH_AGENT_SELF_TEST === '1') {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(`${os.tmpdir()}/workbench-agent-self-test-`);
  const todo = buildProposal('prepare_create_todo', { title: '自检待办', priority: 'high' });
  const note = buildProposal('prepare_create_note', { title: '自检笔记', content: '自检内容' });
  const importantDate = buildProposal('prepare_save_important_date', { title: '自检纪念日', date: '05-20' });
  if (todo.proposal?.kind !== 'create_todo' || note.proposal?.kind !== 'create_note' || importantDate.proposal?.kind !== 'save_important_date') {
    throw new Error('agent proposal self-test failed');
  }
  if (!normaliseMessages([{ role: 'user', content: '总结资料', attachments: [{ name: '自检文档', content: '自检正文' }] }])[0].content.includes('自检正文')) {
    throw new Error('agent attachment self-test failed');
  }
  if (parseProactiveResponse('{"action":"notify","title":"检查","summary":"有一件事需要关注","reason":"临近截止"}').action !== 'notify') {
    throw new Error('agent proactive response self-test failed');
  }
  if (parseProactiveResponse('{"action":"notify","title":"","summary":"无效"}').action !== 'no_action') {
    throw new Error('agent proactive response guard self-test failed');
  }
  try {
    store.init(dir);
    if (workspace.listTodos().length !== 0) throw new Error('proposal must not create a todo');
    confirmProposal(todo.proposal);
    if (workspace.listTodos().length !== 1) throw new Error('confirmed proposal did not create a todo');
    confirmProposal(importantDate.proposal);
    if (store.getSettings().notify.importantDates.length !== 1) throw new Error('confirmed important date did not save');
    console.log('agent self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
