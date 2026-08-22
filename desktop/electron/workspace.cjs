const store = require('./store.cjs');

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
    recurrenceId: null,
    createdAt: new Date().toISOString(),
  };
  return store.updateModule('todos', (items) => [todo, ...items]);
}

function updateTodo(id, patch = {}) {
  return store.updateModule('todos', (items) => {
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
  return store.updateModule('todos', (items) => items.filter((todo) => todo.id !== id));
}

function monthDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 将确认后的每年日历记录关联为 Agent 的个人重要日期。 */
function rememberPersonalDate(todoId) {
  const todo = store.getModule('todos').find((item) => item.id === todoId);
  if (!todo || todo.repeat !== 'yearly' || !todo.due) {
    throw new Error('只有带日期的每年重复日历记录才能记为个人日期');
  }
  const date = monthDay(todo.due);
  if (!date) throw new Error('日历日期无效');
  const settings = store.getSettings();
  const dates = Array.isArray(settings.notify?.importantDates) ? settings.notify.importantDates : [];
  const personalDate = dates.find((item) => item.title === todo.title && item.date === date)
    || { id: store.newId(), title: todo.title, date };
  if (!dates.some((item) => item.id === personalDate.id)) {
    store.setSettings({ notify: { importantDates: [...dates, personalDate] } });
  }
  const recurrenceId = todo.recurrenceId || todo.id;
  const todos = store.updateModule('todos', (items) => {
    return items.map((item) =>
      item.id === todo.id || item.recurrenceId === recurrenceId
        ? { ...item, recurrenceId, personalDateId: personalDate.id }
        : item
    );
  });
  return { todos, personalDate };
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
    console.log('workspace self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
