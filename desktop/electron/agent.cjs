const workspace = require('./workspace.cjs');

const TOOLS = [
  {
    name: 'get_todos',
    description: '获取当前所有待办事项',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_todo',
    description: '创建一条待办事项',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '待办标题' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        due: { type: 'string', description: '截止时间，ISO 8601 格式，例如 2026-08-18T09:00:00' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_todo',
    description: '更新一条待办事项，例如标记完成或修改截止时间',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: {
          type: 'object',
          description: '需要更新的字段，如 {"done": true}、{"due": "2026-08-18T21:00:00"}',
        },
      },
      required: ['id', 'patch'],
    },
  },
  {
    name: 'get_notes',
    description: '获取当前所有备忘录',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_note',
    description: '新建一条备忘录',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'get_profile',
    description: '获取用户个人资料与偏好',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_now',
    description: '获取当前日期、时间和时区',
    parameters: { type: 'object', properties: {} },
  },
];

function buildSystemPrompt(settings) {
  const snap = workspace.snapshot();
  const now = new Date();
  const profile = settings.profile || {};
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now);
  const todos = snap.todos
    .slice(0, 30)
    .map((todo) => `${todo.done ? '[已完成]' : '[未完成]'} ${todo.title}（${todo.priority}）截止 ${todo.due || '无'}`)
    .join('\n');
  const notes = snap.notes
    .slice(0, 20)
    .map((note) => `${note.title}: ${note.content.slice(0, 100)}`)
    .join('\n');

  return [
    '你是用户个人工作台里的私人助手。你会根据下面的真实上下文回答，并使用工具真实修改工作台数据。',
    '规则：用简体中文简洁回答；需要创建或修改数据时调用工具；不要编造工具没有返回的事实；完成操作后，用一两句话告诉用户结果。',
    '',
    `用户资料：${JSON.stringify(profile)}`,
    `当前时间：${now.toLocaleString('zh-CN', { hour12: false })}（${weekday}，时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}）`,
    '',
    '当前待办：',
    todos || '（无）',
    '',
    '备忘录：',
    notes || '（无）',
  ].join('\n');
}

function executeTool(name, args, settings) {
  try {
    switch (name) {
      case 'get_todos':
        return workspace.listTodos();
      case 'create_todo':
        return workspace.createTodo(args);
      case 'update_todo':
        return workspace.updateTodo(args.id, args.patch || {});
      case 'get_notes':
        return workspace.listNotes();
      case 'create_note':
        return workspace.saveNote(args);
      case 'get_profile':
        return settings.profile || {};
      case 'get_now': {
        const now = new Date();
        return {
          now: now.toISOString(),
          local: now.toLocaleString('zh-CN', { hour12: false }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      }
      default:
        return { error: `未知工具: ${name}` };
    }
  } catch (error) {
    return { error: error.message };
  }
}

async function callModel(settings, messages) {
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
      functions: TOOLS,
      function_call: 'auto',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败 (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function runAgent(messages, settings) {
  if (!settings.agent?.apiBase || !settings.agent?.apiKey || !settings.agent?.model) {
    throw new Error('请先在设置中配置 Agent 的 API 地址、密钥和模型');
  }
  const full = [{ role: 'system', content: buildSystemPrompt(settings) }, ...messages];
  for (let index = 0; index < 8; index += 1) {
    const data = await callModel(settings, full);
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('模型返回为空，请检查 API 配置');
    }
    if (message.function_call) {
      let args = {};
      try {
        args = JSON.parse(message.function_call.arguments || '{}');
      } catch {
        args = {};
      }
      const result = executeTool(message.function_call.name, args, settings);
      full.push(message);
      full.push({ role: 'function', name: message.function_call.name, content: JSON.stringify(result) });
      continue;
    }
    return message.content || '';
  }
  throw new Error('Agent 工具调用次数过多，请重新提问');
}

module.exports = { runAgent };
