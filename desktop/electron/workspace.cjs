const store = require('./store.cjs');
const agentState = require('./agent-state.cjs');

const PRIORITIES = ['high', 'medium', 'low'];
const REPEAT_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

function snapshot() {
  const data = store.getData();
  return {
    todos: data.modules.todos,
    notes: data.modules.notes,
    categories: data.modules.categories,
    profileItems: data.modules.profileItems,
    settings: data.settings,
  };
}

function listTodos() {
  return store.getModule('todos');
}

function createTodo(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) {
    throw new Error('待办标题不能为空');
  }
  const repeat = REPEAT_TYPES.includes(input.repeat) ? input.repeat : 'none';
  const repeatUntil = normaliseRepeatUntil(input.repeatUntil);
  const agentGoalId = String(input.agentGoalId || '').trim() || null;
  if (agentGoalId && agentState.getGoal(agentGoalId)?.status !== 'active') {
    throw new Error('只能将待办关联到进行中的 Agent 目标');
  }
  if (repeatUntil && input.due && dateKey(input.due) > repeatUntil) {
    throw new Error('重复截止日期不能早于首次日期');
  }
  const todo = {
    id: store.newId(),
    title,
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'medium',
    start: input.start || null,
    end: input.end || null,
    due: input.due || null,
    done: Boolean(input.done),
    repeat,
    repeatUntil: repeat === 'none' ? null : repeatUntil,
    color: input.color || null,
    personalDateId: input.personalDateId || null,
    agentGoalId,
    recurrenceId: null,
    createdAt: new Date().toISOString(),
  };
  const todos = store.updateModule('todos', (items) => [todo, ...items]);
  if (agentGoalId) agentState.linkTodo(agentGoalId, todo);
  return todos;
}

function updateTodo(id, patch = {}) {
  const todos = store.updateModule('todos', (items) => {
    const current = items.find((todo) => todo.id === id);
    if (!current) return items;
    const recurrenceId = current.recurrenceId || (current.repeat !== 'none' ? current.id : null);
    const repeatUntil = patch.repeatUntil === undefined ? current.repeatUntil : normaliseRepeatUntil(patch.repeatUntil);
    const updated = {
      ...current,
      ...patch,
      repeatUntil: (patch.repeat ?? current.repeat) === 'none' ? null : repeatUntil,
      recurrenceId,
    };
    if (updated.repeatUntil && updated.due && dateKey(updated.due) > updated.repeatUntil) {
      throw new Error('重复截止日期不能早于首次日期');
    }
    // 循环任务只维护一条当前记录；完成后推进到下一次，避免物化出无限待办。
    if (patch.done === true && !current.done && updated.repeat !== 'none' && updated.due) {
      const nextDue = calcNextDue(updated.due, updated.repeat);
      if (nextDue && (!updated.repeatUntil || dateKey(nextDue) <= updated.repeatUntil)) {
        return items.map((item) => (item.id === id ? {
          ...updated,
          start: updated.start ? calcNextDue(updated.start, updated.repeat) : null,
          end: updated.end ? calcNextDue(updated.end, updated.repeat) : null,
          due: nextDue,
          done: false,
        } : item));
      }
    }
    return items.map((item) => (item.id === id ? updated : item));
  });
  const updated = todos.find((todo) => todo.id === id);
  if (updated?.agentGoalId) agentState.syncTodo(updated);
  return todos;
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normaliseRepeatUntil(value) {
  const date = String(value || '');
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00`).getTime())) {
    throw new Error('重复截止日期无效');
  }
  return date;
}

function calcNextDue(due, repeat) {
  const date = new Date(due);
  if (isNaN(date.getTime())) return null;
  switch (repeat) {
    case 'daily': date.setDate(date.getDate() + 1); break;
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
    case 'yearly': date.setFullYear(date.getFullYear() + 1); break;
    default: return null;
  }
  return date.toISOString();
}

function removeTodo(id) {
  const todos = store.updateModule('todos', (items) => items.filter((todo) => todo.id !== id));
  agentState.markTodoRemoved(id);
  return todos;
}

function monthDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalisePersonalDate(input = {}) {
  const title = String(input.title || '').trim();
  const date = String(input.date || '').trim();
  const match = /^(\d{2})-(\d{2})$/.exec(date);
  const month = match ? Number(match[1]) : 0;
  const day = match ? Number(match[2]) : 0;
  if (!title || !match || month < 1 || month > 12 || day < 1 || day > new Date(2024, month, 0).getDate()) {
    throw new Error('个人日期需要名称和有效的 MM-DD 日期');
  }
  return { title, date };
}

function nextPersonalDateDue(date, now = new Date()) {
  const [month, day] = date.split('-').map(Number);
  const today = dateKey(now);
  for (let year = now.getFullYear(); year <= now.getFullYear() + 8; year += 1) {
    const candidate = new Date(year, month - 1, day, 9, 0, 0, 0);
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day || dateKey(candidate) < today) continue;
    return candidate.toISOString();
  }
  throw new Error('无法计算个人日期的下一次日历时间');
}

function reconcilePersonalDateTodo(todos, personalDate, now = new Date()) {
  const linkedIndex = todos.findIndex((todo) => todo.personalDateId === personalDate.id);
  const compatibleIndex = todos.findIndex((todo) => (
    !todo.personalDateId
    && todo.repeat === 'yearly'
    && todo.title === personalDate.title
    && monthDay(todo.start || todo.due) === personalDate.date
  ));
  const index = linkedIndex >= 0 ? linkedIndex : compatibleIndex;
  if (index >= 0) {
    const current = todos[index];
    const recurrenceId = current.recurrenceId || current.id;
    const hasCorrectDate = monthDay(current.start || current.due) === personalDate.date;
    const due = hasCorrectDate && current.due ? current.due : nextPersonalDateDue(personalDate.date, now);
    const next = {
      ...current,
      title: personalDate.title,
      start: current.start ? (hasCorrectDate ? current.start : due) : null,
      due,
      done: false,
      repeat: 'yearly',
      repeatUntil: null,
      personalDateId: personalDate.id,
      recurrenceId,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    return {
      todos: changed ? todos.map((todo, todoIndex) => (todoIndex === index ? next : todo)) : todos,
      todo: next,
      changed,
      created: false,
    };
  }

  const id = store.newId();
  const due = nextPersonalDateDue(personalDate.date, now);
  const todo = {
    id,
    title: personalDate.title,
    priority: 'medium',
    start: due,
    end: null,
    due,
    done: false,
    repeat: 'yearly',
    repeatUntil: null,
    color: null,
    personalDateId: personalDate.id,
    agentGoalId: null,
    recurrenceId: id,
    createdAt: new Date().toISOString(),
  };
  return { todos: [todo, ...todos], todo, changed: true, created: true };
}

/** 保存个人日期时同步建立年度日历记录；重复确认也会修复旧版孤儿数据。 */
function savePersonalDate(input, now = new Date()) {
  const safeInput = normalisePersonalDate(input);
  let result = null;
  const data = store.updateData((current) => {
    const dates = Array.isArray(current.settings.notify?.importantDates) ? current.settings.notify.importantDates : [];
    const existing = dates.find((item) => item.title === safeInput.title && item.date === safeInput.date);
    const personalDate = existing || { id: store.newId(), ...safeInput };
    if (!existing) current.settings.notify.importantDates = [...dates, personalDate];
    const reconciled = reconcilePersonalDateTodo(current.modules.todos || [], personalDate, now);
    current.modules.todos = reconciled.todos;
    result = {
      personalDate,
      todo: reconciled.todo,
      personalDateCreated: !existing,
      todoCreated: reconciled.created,
    };
  });
  return { ...result, todos: data.modules.todos };
}

/** 启动时只在确有缺失时迁移，避免每次启动都改写用户数据。 */
function repairPersonalDateTodos(now = new Date()) {
  const current = store.getData();
  const dates = Array.isArray(current.settings.notify?.importantDates) ? current.settings.notify.importantDates : [];
  let previewTodos = current.modules.todos || [];
  let needsRepair = false;
  for (const rawDate of dates) {
    let personalDate;
    try {
      personalDate = { id: String(rawDate.id || '').trim(), ...normalisePersonalDate(rawDate) };
    } catch {
      continue;
    }
    if (!personalDate.id) continue;
    const reconciled = reconcilePersonalDateTodo(previewTodos, personalDate, now);
    previewTodos = reconciled.todos;
    needsRepair ||= reconciled.changed;
  }
  if (!needsRepair) return { todos: current.modules.todos || [], repaired: 0 };

  let repaired = 0;
  const data = store.updateData((next) => {
    let todos = next.modules.todos || [];
    for (const rawDate of dates) {
      let personalDate;
      try {
        personalDate = { id: String(rawDate.id || '').trim(), ...normalisePersonalDate(rawDate) };
      } catch {
        continue;
      }
      if (!personalDate.id) continue;
      const reconciled = reconcilePersonalDateTodo(todos, personalDate, now);
      todos = reconciled.todos;
      if (reconciled.changed) repaired += 1;
    }
    next.modules.todos = todos;
  });
  return { todos: data.modules.todos, repaired };
}

/** 将确认后的每年日历记录关联为 Agent 的个人重要日期。 */
function rememberPersonalDate(todoId) {
  const todo = store.getModule('todos').find((item) => item.id === todoId);
  if (!todo || todo.repeat !== 'yearly' || !todo.due) {
    throw new Error('只有带日期的每年重复日历记录才能记为个人日期');
  }
  const date = monthDay(todo.due);
  if (!date) throw new Error('日历日期无效');
  return savePersonalDate({ title: todo.title, date });
}

function listNotes() {
  return store.getModule('notes');
}

function saveNote(input = {}) {
  const existing = input.id ? store.getModule('notes').find((note) => note.id === input.id) : null;
  if (existing) {
    const next = { ...existing, ...input, updatedAt: new Date().toISOString() };
    return store.updateModule('notes', (items) =>
      items.map((note) => (note.id === next.id ? next : note))
    );
  }
  const note = {
    id: store.newId(),
    title: String(input.title || '未命名笔记').trim(),
    content: input.content || '',
    updatedAt: new Date().toISOString(),
  };
  return store.updateModule('notes', (items) => [note, ...items]);
}

function removeNote(id) {
  return store.updateModule('notes', (items) => items.filter((note) => note.id !== id));
}

const workspace = {
  snapshot,
  listTodos,
  createTodo,
  updateTodo,
  removeTodo,
  savePersonalDate,
  repairPersonalDateTodos,
  rememberPersonalDate,
  listNotes,
  saveNote,
  removeNote,
};

module.exports = workspace;

if (process.env.WORKBENCH_SELF_TEST === '1') {
  const os = require('node:os');
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(`${os.tmpdir()}/workbench-self-test-`);
  try {
    store.init(dir);
    const todos = workspace.createTodo({ title: '自检待办', priority: 'high' });
    if (todos.length !== 1 || todos[0].title !== '自检待办') {
      throw new Error('todo create failed');
    }
    const updated = workspace.updateTodo(todos[0].id, { done: true });
    if (!updated[0].done) {
      throw new Error('todo update failed');
    }
    const yearly = workspace.createTodo({ title: '自检生日', due: '2026-05-20T09:00:00', repeat: 'yearly' })[0];
    const remembered = workspace.rememberPersonalDate(yearly.id);
    if (remembered.personalDate.date !== '05-20' || !remembered.todos.find((todo) => todo.id === yearly.id)?.personalDateId) {
      throw new Error('personal date remember failed');
    }
    const repeated = workspace.updateTodo(yearly.id, { done: true });
    if (repeated.some(Array.isArray) || repeated.length !== 2 || repeated.find((todo) => todo.id === yearly.id)?.done || new Date(repeated.find((todo) => todo.id === yearly.id).due).getFullYear() !== 2027) {
      throw new Error('yearly todo repeat failed');
    }
    const daily = workspace.createTodo({ title: '每日学习', due: '2026-05-20T09:00:00', repeat: 'daily', repeatUntil: '2026-05-22' })[0];
    const dayTwo = workspace.updateTodo(daily.id, { done: true }).find((todo) => todo.id === daily.id);
    const dayThree = workspace.updateTodo(daily.id, { done: true }).find((todo) => todo.id === daily.id);
    const finalDay = workspace.updateTodo(daily.id, { done: true }).find((todo) => todo.id === daily.id);
    if (dateKey(dayTwo.due) !== '2026-05-21' || dateKey(dayThree.due) !== '2026-05-22' || !finalDay.done || store.getModule('todos').filter((todo) => todo.title === '每日学习').length !== 1) {
      throw new Error('repeat-until self-test failed');
    }
    const notes = workspace.saveNote({ title: '自检笔记', content: 'hello' });
    if (notes.length !== 1 || notes[0].content !== 'hello') {
      throw new Error('note create failed');
    }
    const changedNotes = workspace.saveNote({ id: notes[0].id, content: 'updated' });
    if (changedNotes[0].title !== '自检笔记' || changedNotes[0].content !== 'updated') {
      throw new Error('note update failed');
    }
    const removedNotes = workspace.removeNote(notes[0].id);
    if (removedNotes.length !== 0) {
      throw new Error('note remove failed');
    }
    const category = { id: 'self-test-category', name: '工作资料' };
    store.setModule('categories', [category]);
    store.setModule('profileItems', [{
      id: 'self-test-profile-item',
      name: '自检资料',
      categoryId: category.id,
      source: 'created',
      storageName: '',
      mimeType: 'text/markdown',
      size: 0,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
    if (store.getModule('profileItems')[0].categoryId !== category.id) {
      throw new Error('profile item save failed');
    }
    const snap = workspace.snapshot();
    if (snap.todos.length !== 3 || snap.notes.length !== 0 || snap.categories.length !== 1 || snap.settings.notify.importantDates.length !== 1) {
      throw new Error('snapshot failed');
    }
    const legacyBirthday = {
      id: 'legacy-birthday',
      title: '我的生日',
      priority: 'medium',
      start: '2026-05-20T09:00:00',
      end: null,
      due: '2026-05-20T09:00:00',
      done: false,
      repeat: 'yearly',
      repeatUntil: null,
      color: null,
      personalDateId: null,
      recurrenceId: null,
      createdAt: new Date().toISOString(),
    };
    store.setModule('todos', [legacyBirthday]);
    const migrated = workspace.rememberPersonalDate(legacyBirthday.id);
    const nextBirthday = workspace.updateTodo(legacyBirthday.id, { done: true }).find((todo) => todo.id === legacyBirthday.id);
    if (!nextBirthday || new Date(nextBirthday.due).getFullYear() !== 2027 || nextBirthday.done || store.getModule('todos').length !== 1 || !nextBirthday.personalDateId || migrated.personalDate.date !== '05-20') {
      throw new Error('legacy yearly birthday migration failed');
    }
    store.setModule('todos', []);
    store.setSettings({ notify: { importantDates: [] } });
    const agentBirthday = workspace.savePersonalDate({ title: 'Agent 生日', date: '05-20' }, new Date('2026-08-29T10:00:00'));
    const savedBirthdayTodo = agentBirthday.todos.find((todo) => todo.personalDateId === agentBirthday.personalDate.id);
    if (!agentBirthday.personalDateCreated || !agentBirthday.todoCreated || !savedBirthdayTodo || savedBirthdayTodo.repeat !== 'yearly' || dateKey(savedBirthdayTodo.due) !== '2027-05-20') {
      throw new Error('agent personal date calendar sync failed');
    }
    const duplicateBirthday = workspace.savePersonalDate({ title: 'Agent 生日', date: '05-20' }, new Date('2026-08-29T10:00:00'));
    if (duplicateBirthday.personalDateCreated || duplicateBirthday.todoCreated || duplicateBirthday.todos.length !== 1) {
      throw new Error('personal date duplicate sync failed');
    }
    store.setModule('todos', []);
    const repaired = workspace.repairPersonalDateTodos(new Date('2026-08-29T10:00:00'));
    if (repaired.repaired !== 1 || repaired.todos.length !== 1 || dateKey(repaired.todos[0].due) !== '2027-05-20') {
      throw new Error('orphan personal date repair failed');
    }
    console.log('workspace self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
