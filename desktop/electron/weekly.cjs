const store = require('./store.cjs');
const workspace = require('./workspace.cjs');
const agentState = require('./agent-state.cjs');

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(now) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function isWithin(date, start, end) {
  return date && date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

function visibleTodos(todos, now) {
  const groups = new Map();
  for (const todo of todos) {
    const key = todo.recurrenceId || todo.id;
    groups.set(key, [...(groups.get(key) || []), todo]);
  }
  return [...groups.values()].map((items) => {
    const open = items.filter((todo) => !todo.done);
    return open
      .filter((todo) => validDate(todo.due)?.getTime() >= now.getTime())
      .sort((left, right) => String(left.due).localeCompare(String(right.due)))[0]
      || open.sort((left, right) => String(right.due || '').localeCompare(String(left.due || '')))[0]
      || items[0];
  });
}

function todoAt(todo) {
  return validDate(todo.start) || validDate(todo.due);
}

function formatItem(todo) {
  const at = todoAt(todo);
  return {
    id: todo.id,
    title: todo.title,
    priority: todo.priority,
    at: at ? at.toISOString() : null,
    type: todo.start ? 'schedule' : 'todo',
  };
}

function orderTodos(left, right) {
  return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
    || (todoAt(left)?.getTime() || Number.MAX_SAFE_INTEGER) - (todoAt(right)?.getTime() || Number.MAX_SAFE_INTEGER)
    || String(left.title).localeCompare(String(right.title), 'zh-CN');
}

/**
 * 周回顾只从已有本地记录派生：没有完成时间的历史，就不伪造“本周完成数”。
 */
function buildSnapshot(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const weekStart = startOfWeek(current);
  const weekEnd = addDays(weekStart, 7);
  const nextWeekEnd = addDays(weekEnd, 7);
  const todos = visibleTodos(workspace.listTodos(), current).filter((todo) => !todo.done);
  const currentWeek = todos.filter((todo) => isWithin(todoAt(todo), weekStart, weekEnd)).sort(orderTodos);
  const overdue = todos
    .filter((todo) => {
      const due = validDate(todo.due);
      return due && due.getTime() < current.getTime();
    })
    .sort((left, right) => validDate(left.due).getTime() - validDate(right.due).getTime());
  const nextWeek = todos.filter((todo) => isWithin(todoAt(todo), weekEnd, nextWeekEnd)).sort(orderTodos);
  const recentNotes = workspace.listNotes()
    .filter((note) => isWithin(validDate(note.updatedAt), weekStart, weekEnd))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 5)
    .map((note) => ({ id: note.id, title: note.title || '未命名笔记', updatedAt: note.updatedAt }));
  const activeGoalCount = agentState.listGoals().filter((goal) => goal.status === 'active').length;

  return {
    weekStart: localDateKey(weekStart),
    weekEnd: localDateKey(addDays(weekEnd, -1)),
    nextWeekStart: localDateKey(weekEnd),
    nextWeekEnd: localDateKey(addDays(nextWeekEnd, -1)),
    currentWeek: currentWeek.slice(0, 6).map(formatItem),
    currentWeekTotal: currentWeek.length,
    overdue: overdue.slice(0, 5).map(formatItem),
    overdueCount: overdue.length,
    nextWeek: nextWeek.slice(0, 6).map(formatItem),
    nextWeekTotal: nextWeek.length,
    recentNotes,
    captureCount: recentNotes.length,
    activeGoalCount,
  };
}

module.exports = { buildSnapshot };

if (process.env.WORKBENCH_WEEKLY_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-weekly-self-test-'));
  try {
    store.init(dir);
    store.setModule('todos', [
      { id: 'overdue', title: '补充周报', priority: 'high', start: null, end: null, due: '2026-08-23T18:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'current', title: '整理会议纪要', priority: 'medium', start: '2026-08-27T10:00:00', end: null, due: '2026-08-27T10:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'next', title: '准备下周计划', priority: 'low', start: '2026-08-31T09:00:00', end: null, due: '2026-08-31T09:00:00', done: false, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
      { id: 'done', title: '已完成事项', priority: 'medium', start: '2026-08-26T09:00:00', end: null, due: '2026-08-26T09:00:00', done: true, repeat: 'none', repeatUntil: null, color: null, personalDateId: null, recurrenceId: null, createdAt: '2026-08-20T09:00:00' },
    ]);
    store.setModule('notes', [{ id: 'note', title: '本周记录', content: '', updatedAt: '2026-08-28T08:00:00' }]);
    const snapshot = buildSnapshot(new Date('2026-08-29T10:00:00'));
    assert.equal(snapshot.weekStart, '2026-08-24');
    assert.equal(snapshot.weekEnd, '2026-08-30');
    assert.equal(snapshot.currentWeek.some((item) => item.id === 'current'), true);
    assert.equal(snapshot.overdue[0].id, 'overdue');
    assert.equal(snapshot.nextWeek[0].id, 'next');
    assert.equal(snapshot.captureCount, 1);
    console.log('weekly self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
