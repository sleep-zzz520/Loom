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
  const todo = {
    id: store.newId(),
    title,
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'medium',
    start: input.start || null,
    end: input.end || null,
    due: input.due || null,
    done: Boolean(input.done),
    repeat: REPEAT_TYPES.includes(input.repeat) ? input.repeat : 'none',
    color: input.color || null,
    createdAt: new Date().toISOString(),
  };
  return store.updateModule('todos', (items) => [todo, ...items]);
}

function updateTodo(id, patch = {}) {
  return store.updateModule('todos', (items) =>
    items.map((todo) => {
      if (todo.id !== id) return todo;
      const updated = { ...todo, ...patch };
      // 标记完成时，如果设置了循环，自动创建下一次待办
      if (patch.done === true && todo.repeat && todo.repeat !== 'none' && todo.due) {
        const nextDue = calcNextDue(todo.due, todo.repeat);
        if (nextDue) {
          const next = {
            id: store.newId(),
            title: todo.title,
            priority: todo.priority,
            start: null,
            end: null,
            due: nextDue,
            done: false,
            repeat: todo.repeat,
            color: null,
            createdAt: new Date().toISOString(),
          };
          return [next, ...items.map((item) => (item.id === id ? updated : item))];
        }
      }
      return updated;
    })
  );
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
    const snap = workspace.snapshot();
    if (snap.todos.length !== 1 || snap.notes.length !== 0) {
      throw new Error('snapshot failed');
    }
    console.log('workspace self-test ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
