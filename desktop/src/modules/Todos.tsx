import { FormEvent, useEffect, useState } from 'react';
import { CalendarClock, Check, Phone, Plus, RefreshCw, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import type { Priority, Todo } from '../types';
import { DateField } from '../components/DateFields';

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

function taskTime(due: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(due));
}

function repeatSummary(todo: Todo): string {
  const label = REPEAT_LABEL[todo.repeat];
  if (!todo.repeatUntil) return `${label}循环`;
  return `${label} · 至 ${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${todo.repeatUntil}T00:00`))}`;
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function visibleTodos(todos: Todo[]): Todo[] {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    const key = todo.recurrenceId || todo.id;
    groups.set(key, [...(groups.get(key) || []), todo]);
  }
  const now = Date.now();
  return [...groups.values()].map((items) => {
    if (items.length === 1) return items[0];
    const open = items.filter((todo) => !todo.done);
    return open
      .filter((todo) => todo.due && new Date(todo.due).getTime() >= now)
      .sort((a, b) => String(a.due).localeCompare(String(b.due)))[0]
      || open.sort((a, b) => String(b.due).localeCompare(String(a.due)))[0]
      || items.sort((a, b) => String(b.due).localeCompare(String(a.due)))[0];
  });
}

export default function Todos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [due, setDue] = useState('');
  const [repeat, setRepeat] = useState<Todo['repeat']>('none');
  const [repeatUntil, setRepeatUntil] = useState('');
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
    setRepeatUntil('');
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
      repeatUntil: repeat === 'none' ? null : repeatUntil || null,
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
    setRepeatUntil(todo.repeatUntil || '');
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
      const notifications = await window.workbench.notify.checkTodos();
      setNotifyMsg(notifications.length ? `已送达 ${notifications.length} 条提醒` : '暂无需要发送的提醒');
    } catch {
      setNotifyMsg('检查失败');
    }
    setTimeout(() => setNotifyMsg(''), 3000);
  }

  async function testPhonePush() {
    try {
      await window.workbench.notify.sendNtfy(
        'Loom 测试',
        '这是一条来自 Loom 的测试推送'
      );
      setNotifyMsg('手机推送已发送，请检查手机');
    } catch {
      setNotifyMsg('手机推送发送失败，请检查设置');
    }
    setTimeout(() => setNotifyMsg(''), 3000);
  }

  const sorted = visibleTodos(todos).sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (isOverdue(a) ? -1 : isOverdue(b) ? 1 : 0) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      String(a.due ?? '').localeCompare(String(b.due ?? ''))
  );
  const openCount = sorted.filter((todo) => !todo.done).length;
  const overdueCount = sorted.filter(isOverdue).length;
  const todayKey = new Date().toDateString();
  const dueTodayCount = sorted.filter((todo) => !todo.done && todo.due && new Date(todo.due).toDateString() === todayKey).length;

  return (
    <section className="module-page">
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
          <DateField mode="datetime" value={due} onChange={setDue} ariaLabel="选择截止时间" placeholder="选择截止时间" />
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
        {repeat !== 'none' && (
          <label className="field">
            <span>重复至（可选）</span>
            <DateField mode="date" value={repeatUntil} onChange={setRepeatUntil} ariaLabel="选择循环结束日期" placeholder="持续循环" />
          </label>
        )}
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
        <div className="todo-list-header">
          <div>
            <h2>待办清单</h2>
            <p>{openCount ? `当前有 ${openCount} 项待处理` : '所有待办均已完成'}</p>
          </div>
          <div className="todo-list-summary" aria-label="待办概览">
            <span>{dueTodayCount} 项今天截止</span>
            {overdueCount > 0 && <span className="is-overdue">{overdueCount} 项已超期</span>}
          </div>
        </div>
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
              <div className="todo-main">
                <span className="todo-title">{todo.title}</span>
                <div className="todo-details">
                  {todo.due ? (
                    <span className="todo-detail" title={absoluteTime(todo.due)}>
                      <CalendarClock size={13} strokeWidth={1.8} />
                      截止 {taskTime(todo.due)}
                    </span>
                  ) : (
                    <span className="todo-detail">未设置截止时间</span>
                  )}
                  {todo.repeat !== 'none' && (
                    <span className="todo-detail" title={repeatSummary(todo)}>
                      <Repeat size={13} strokeWidth={1.8} />
                      {repeatSummary(todo)}
                    </span>
                  )}
                </div>
              </div>
              <div className="todo-info">
                <span className={`priority priority-${todo.priority}`}>
                  {PRIORITY_LABEL[todo.priority]}
                </span>
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
