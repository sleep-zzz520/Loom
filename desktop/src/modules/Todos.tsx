import { FormEvent, useEffect, useState } from 'react';
import { Check, Phone, Plus, RefreshCw, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import type { Priority, Todo } from '../types';

const PRIORITY_LABEL: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const REPEAT_LABEL: Record<Todo['repeat'], string> = {
  none: '',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** 判断是否超期 */
function isOverdue(todo: Todo): boolean {
  return !todo.done && !!todo.due && new Date(todo.due).getTime() <= Date.now();
}

/** 判断是否即将到期（1 小时内） */
function isDueSoon(todo: Todo): boolean {
  if (todo.done || !todo.due) return false;
  const diff = new Date(todo.due).getTime() - Date.now();
  return diff > 0 && diff <= 3600_000;
}

/** 相对时间描述 */
function relativeTime(due: string): string {
  const diff = new Date(due).getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3600_000);
  const days = Math.floor(abs / 86_400_000);

  if (diff < 0) {
    if (days >= 1) return `已超期 ${days} 天`;
    if (hours >= 1) return `已超期 ${hours} 小时`;
    return `已超期 ${minutes} 分钟`;
  }
  if (days >= 1) return `还有 ${days} 天`;
  if (hours >= 1) return `还有 ${hours} 小时`;
  if (minutes >= 1) return `还有 ${minutes} 分钟`;
  return '即将到期';
}

/** 格式化绝对时间（用于 title 属性） */
function absoluteTime(due: string): string {
  return new Date(due).toLocaleString('zh-CN', { hour12: false });
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export default function Todos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [due, setDue] = useState('');
  const [repeat, setRepeat] = useState<Todo['repeat']>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notifyMsg, setNotifyMsg] = useState('');

  useEffect(() => {
    window.workbench.workspace.todos
      .list()
      .then(setTodos)
      .catch(() => setTodos([]));
  }, []);

  function resetForm() {
    setTitle('');
    setPriority('medium');
    setDue('');
    setRepeat('none');
    setEditingId(null);
  }

  async function saveTodo(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const input = {
      title: title.trim(),
      priority,
      due: due || null,
      repeat,
    };
    const next = editingId
      ? await window.workbench.workspace.todos.update(editingId, input)
      : await window.workbench.workspace.todos.create(input);
    setTodos(next);
    resetForm();
  }

  function startEdit(todo: Todo) {
    setEditingId(todo.id);
    setTitle(todo.title);
    setPriority(todo.priority);
    setDue(toDatetimeLocal(todo.due));
    setRepeat(todo.repeat);
  }

  async function toggleDone(todo: Todo) {
    const next = await window.workbench.workspace.todos.update(todo.id, { done: !todo.done });
    setTodos(next);
  }

  async function removeTodo(id: string) {
    const next = await window.workbench.workspace.todos.remove(id);
    setTodos(next);
    if (editingId === id) resetForm();
  }

  async function checkNotifications() {
    try {
      await window.workbench.notify.checkTodos();
      setNotifyMsg('已检查待办通知');
    } catch {
      setNotifyMsg('检查失败');
    }
    setTimeout(() => setNotifyMsg(''), 3000);
  }

  async function testPhonePush() {
    try {
      await window.workbench.notify.sendNtfy(
        '个人工作台测试',
        '这是一条来自个人工作台的测试推送'
      );
      setNotifyMsg('手机推送已发送，请检查手机');
    } catch {
      setNotifyMsg('手机推送发送失败，请检查设置');
    }
    setTimeout(() => setNotifyMsg(''), 3000);
  }

  const sorted = [...todos].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (isOverdue(a) ? -1 : isOverdue(b) ? 1 : 0) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      String(a.due ?? '').localeCompare(String(b.due ?? ''))
  );

  return (
    <section className="module-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">待办</h2>
          <p className="page-sub">按优先级和截止时间排序</p>
        </div>
        <p className="page-meta">
          {todos.filter((todo) => !todo.done).length} 进行中 · {todos.length} 总计
        </p>
      </div>

      <form className="todo-add" onSubmit={saveTodo}>
        <label className="field">
          <span>任务</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="要做的事"
          />
        </label>
        <label className="field">
          <span>优先级</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
            <option value="high">高优先级</option>
            <option value="medium">中优先级</option>
            <option value="low">低优先级</option>
          </select>
        </label>
        <label className="field">
          <span>截止时间</span>
          <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label className="field">
          <span>重复</span>
          <select value={repeat} onChange={(event) => setRepeat(event.target.value as Todo['repeat'])}>
            <option value="none">不重复</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="yearly">每年</option>
          </select>
        </label>
        <button type="submit" className="btn-primary">
          {editingId ? <Check size={16} /> : <Plus size={16} />}
          {editingId ? '保存' : '添加'}
        </button>
        <button type="button" className="text-btn" onClick={resetForm}>
          <RotateCcw size={15} />
          重置
        </button>
      </form>

      <div className="todo-panel">
        {sorted.map((todo) => {
          const overdue = isOverdue(todo);
          const dueSoon = isDueSoon(todo);
          return (
            <div
              key={todo.id}
              className={`todo-item${todo.done ? ' done' : ''}${overdue ? ' overdue' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => startEdit(todo)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  startEdit(todo);
                }
              }}
            >
              <button
                type="button"
                aria-label="完成状态"
                className={`todo-check${todo.done ? ' checked' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleDone(todo);
                }}
              >
                {todo.done && <Check size={14} strokeWidth={3} />}
              </button>
              <span className="todo-title">{todo.title}</span>
              <div className="todo-info">
                <span className={`priority priority-${todo.priority}`}>
                  {PRIORITY_LABEL[todo.priority]}
                </span>
                {todo.repeat && todo.repeat !== 'none' && (
                  <span className="repeat-icon" title={REPEAT_LABEL[todo.repeat]}>
                    <Repeat size={12} strokeWidth={1.8} />
                  </span>
                )}
                {overdue && (
                  <span className="badge badge-overdue" title={absoluteTime(todo.due!)}>
                    {relativeTime(todo.due!)}
                  </span>
                )}
                {dueSoon && !overdue && (
                  <span className="badge badge-due-soon" title={absoluteTime(todo.due!)}>
                    {relativeTime(todo.due!)}
                  </span>
                )}
                {!overdue && !dueSoon && todo.due && (
                  <span className="todo-meta" title={absoluteTime(todo.due)}>
                    {relativeTime(todo.due)}
                  </span>
                )}
                {!todo.due && <span className="todo-meta">无期限</span>}
              </div>
              <div className="todo-controls">
                <button
                  type="button"
                  aria-label="删除"
                  className="icon-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeTodo(todo.id);
                  }}
                >
                  <Trash2 size={16} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && <p className="empty">暂无待办</p>}
      </div>

      <div className="todo-actions">
        <button type="button" className="text-btn" onClick={checkNotifications}>
          <RefreshCw size={14} />
          检查通知
        </button>
        <button type="button" className="text-btn" onClick={testPhonePush}>
          <Phone size={14} />
          测试手机推送
        </button>
        {notifyMsg && <span className="notify-msg">{notifyMsg}</span>}
      </div>
    </section>
  );
}
