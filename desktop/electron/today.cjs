const store = require('./store.cjs');
const workspace = require('./workspace.cjs');
const agentState = require('./agent-state.cjs');

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = validDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function uniqueTodos(todos, now) {
  const groups = new Map();
  for (const todo of todos) {
    const key = todo.recurrenceId || todo.id;
    groups.set(key, [...(groups.get(key) || []), todo]);
  }
  return [...groups.values()].map((items) => {
    const open = items.filter((item) => !item.done);
    return open
      .filter((item) => validDate(item.due)?.getTime() >= now.getTime())
      .sort((a, b) => String(a.due).localeCompare(String(b.due)))[0]
      || open.sort((a, b) => String(b.due || '').localeCompare(String(a.due || '')))[0]
      || items[0];
  });
}

function focusReason(todo, now, endOfToday, goalTitle) {
  const due = validDate(todo.due);
  const start = validDate(todo.start);
  if (due && due.getTime() <= now.getTime()) return `已超期 · 原定 ${formatTime(todo.due) || '今天'}`;
  if (start && start.getTime() >= now.getTime() && start.getTime() <= now.getTime() + 2 * 60 * 60 * 1000) return `${formatTime(todo.start)} 开始`;
  if (due && due < endOfToday) return `今天 ${formatTime(todo.due)} 到期`;
  if (goalTitle) return `关联目标：${goalTitle}`;
  return todo.priority === 'high' ? '高优先级事项' : '今天值得推进';
}

function focusScore(todo, now, endOfToday, goalTitle) {
  const due = validDate(todo.due);
  const start = validDate(todo.start);
  if (due && due.getTime() <= now.getTime()) return 0;
  if (start && start.getTime() >= now.getTime() && start.getTime() <= now.getTime() + 2 * 60 * 60 * 1000) return 1;
  if (due && due < endOfToday && todo.priority === 'high') return 2;
  if (due && due < endOfToday) return 3;
  if (goalTitle && todo.priority === 'high') return 4;
  if (todo.priority === 'high') return 5;
  return 6;
}

function deadlineReminderRank(suggestion) {
  const title = String(suggestion?.title || '');
  if (/^任务已超期[：:]/.test(title)) return 2;
  if (/^任务即将到期[：:]/.test(title)) return 1;
  return 0;
}

function referencedTodoId(suggestion) {
  const references = Array.isArray(suggestion?.references) ? suggestion.references : [];
  return String(references.find((reference) => reference?.type === 'todo')?.id || '').trim();
}

function shouldShowPendingSuggestion(suggestion, strongestDeadlineByTodo) {
  const rank = deadlineReminderRank(suggestion);
  if (!rank) return true;
  const todoId = referencedTodoId(suggestion);
  return !todoId || strongestDeadlineByTodo.get(todoId)?.id === suggestion.id;
}

function buildSnapshot(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const todayKey = localDateKey(current);
  const endOfToday = new Date(current);
  endOfToday.setHours(24, 0, 0, 0);
  const goals = agentState.listGoals().filter((goal) => goal.status === 'active');
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const todos = uniqueTodos(workspace.listTodos(), current).filter((todo) => !todo.done);
  const focusItems = todos
    .filter((todo) => {
      const due = validDate(todo.due);
      const start = validDate(todo.start);
      return (due && due < endOfToday) || (start && start < endOfToday) || todo.priority === 'high' || Boolean(todo.agentGoalId);
    })
    .sort((a, b) => {
      const goalA = goalById.get(a.agentGoalId)?.title || '';
      const goalB = goalById.get(b.agentGoalId)?.title || '';
      return focusScore(a, current, endOfToday, goalA) - focusScore(b, current, endOfToday, goalB)
        || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        || String(a.due || a.start || '').localeCompare(String(b.due || b.start || ''));
    })
    .slice(0, 3)
    .map((todo) => {
      const goalTitle = goalById.get(todo.agentGoalId)?.title || '';
      return { id: todo.id, title: todo.title, priority: todo.priority, due: todo.due, start: todo.start, reason: focusReason(todo, current, endOfToday, goalTitle), goalTitle: goalTitle || null };
    });

  const timelineItems = todos
    .map((todo) => ({ todo, at: validDate(todo.start) || validDate(todo.due) }))
    .filter(({ at }) => at && localDateKey(at) === todayKey)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ todo, at }) => ({ id: todo.id, title: todo.title, at: at.toISOString(), time: formatTime(at), type: todo.start ? 'schedule' : 'todo', priority: todo.priority }));
  const timeline = timelineItems.slice(0, 3);

  const directMessages = store.getModule('agentMessages').filter((message) => !message.readAt);
  const messageBySuggestion = new Map(directMessages.map((message) => [message.suggestionId, message]));
  const pendingSuggestions = store.getModule('agentSuggestions')
    .filter((suggestion) => ['unread', 'read'].includes(suggestion.status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const strongestDeadlineByTodo = new Map();
  for (const suggestion of pendingSuggestions) {
    const todoId = referencedTodoId(suggestion);
    const rank = deadlineReminderRank(suggestion);
    if (!todoId || !rank) continue;
    const current = strongestDeadlineByTodo.get(todoId);
    if (!current || rank > current.rank || (rank === current.rank && String(suggestion.updatedAt).localeCompare(current.updatedAt) > 0)) {
      strongestDeadlineByTodo.set(todoId, { id: suggestion.id, rank, updatedAt: String(suggestion.updatedAt) });
    }
  }
  const pending = pendingSuggestions
    .filter((suggestion) => shouldShowPendingSuggestion(suggestion, strongestDeadlineByTodo))
    .slice(0, 3)
    .map((suggestion) => ({ id: suggestion.id, title: suggestion.title, summary: suggestion.summary, messageId: messageBySuggestion.get(suggestion.id)?.id || suggestion.messageId || '', status: suggestion.status }));

  const activeGoals = goals
    .filter((goal) => goal.summary.pending > 0)
    .slice(0, 3)
    .map((goal) => ({ id: goal.id, title: goal.title, progress: goal.summary.progress, completed: goal.summary.completed, total: goal.summary.total, nextAction: goal.actions.find((action) => action.status === 'pending')?.title || '' }));

  const recentCaptures = [
    ...workspace.listNotes().map((item) => ({ id: item.id, title: item.title || '未命名笔记', updatedAt: item.updatedAt, type: 'note' })),
    ...store.getModule('profileItems').map((item) => ({ id: item.id, title: item.name || '未命名资料', updatedAt: item.updatedAt || item.createdAt, type: 'library' })),
  ]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 5);

  return { date: todayKey, focusItems, timeline, timelineTotal: timelineItems.length, pending, activeGoals, recentCaptures };
}

module.exports = { buildSnapshot };

if (process.env.WORKBENCH_TODAY_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-today-self-test-'));
  try {
    store.init(dir);
    store.setModule('todos', [
      { id: 'overdue', title: '完成方案', priority: 'high', start: null, end: null, due: '2026-08-27T18:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'meeting', title: '项目沟通', priority: 'medium', start: '2026-08-28T10:00:00', end: null, due: '2026-08-28T10:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'timeline-2', title: '整理会议纪要', priority: 'low', start: '2026-08-28T11:00:00', end: null, due: '2026-08-28T11:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'timeline-3', title: '回复项目消息', priority: 'medium', start: '2026-08-28T13:00:00', end: null, due: '2026-08-28T13:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'timeline-4', title: '准备明日计划', priority: 'low', start: '2026-08-28T16:00:00', end: null, due: '2026-08-28T16:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
    ]);
    store.setModule('notes', [{ id: 'note-1', title: '会议记录', content: '', updatedAt: '2026-08-28T08:00:00' }]);
    store.setModule('agentSuggestions', [
      { id: 'suggestion-1', title: '先确认沟通准备', summary: '会议将在两小时内开始。', status: 'unread', updatedAt: '2026-08-28T08:30:00', messageId: 'message-1', references: [] },
      { id: 'due-soon', title: '任务即将到期：完成方案', summary: '「完成方案」还有 29 分钟', status: 'read', updatedAt: '2026-08-28T08:40:00', messageId: 'message-2', references: [{ type: 'todo', id: 'overdue', label: '完成方案' }] },
      { id: 'overdue-reminder', title: '任务已超期：完成方案', summary: '「完成方案」已超期 1 分钟', status: 'unread', updatedAt: '2026-08-28T08:50:00', messageId: 'message-3', references: [{ type: 'todo', id: 'overdue', label: '完成方案' }] },
    ]);
    const snapshot = buildSnapshot(new Date('2026-08-28T09:00:00'));
    assert.equal(snapshot.focusItems[0].id, 'overdue');
    assert.equal(snapshot.timeline[0].id, 'meeting');
    assert.equal(snapshot.timeline.length, 3);
    assert.equal(snapshot.timelineTotal, 4);
    assert.equal(snapshot.pending.some((item) => item.messageId === 'message-1'), true);
    assert.equal(snapshot.pending.some((item) => item.id === 'due-soon'), false);
    assert.equal(snapshot.pending.some((item) => item.id === 'overdue-reminder'), true);
    assert.equal(snapshot.recentCaptures[0].title, '会议记录');
    console.log('today self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
