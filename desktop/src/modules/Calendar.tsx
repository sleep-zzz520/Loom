import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus, Repeat, Trash2, X } from 'lucide-react';
import type { Priority, Todo } from '../types';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PRIORITY_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayTitle(key: string) {
  return new Date(`${key}T00:00`).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

function isOverdue(todo: Todo): boolean {
  return !todo.done && !!todo.due && new Date(todo.due).getTime() <= Date.now();
}

function isDueSoon(todo: Todo): boolean {
  if (todo.done || !todo.due) return false;
  const diff = new Date(todo.due).getTime() - Date.now();
  return diff > 0 && diff <= 3600_000;
}

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

/** 格式化日期为 datetime-local 可用的值 */
function toDatetimeLocal(date: Date, hour = 9, minute = 0): string {
  const y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return `${y}-${M}-${d}T${h}:${m}`;
}

/** 获取今天 20:00 */
function todayAt(hour: number): string {
  return toDatetimeLocal(new Date(), hour);
}

/** 获取明天 09:00 */
function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDatetimeLocal(d, hour);
}

export default function Calendar() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [holidayStatus, setHolidayStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [formTitle, setFormTitle] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formRepeat, setFormRepeat] = useState<Todo['repeat']>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  async function load() {
    const list = await window.workbench.workspace.todos.list().catch(() => []);
    setTodos(list);
  }

  useEffect(() => { load(); }, []);

  /** 获取节假日 */
  useEffect(() => {
    const year = cursor.year;
    setHolidayStatus('loading');
    window.workbench.calendar
      .getHolidays(year)
      .then((data) => {
        const next = Object.fromEntries(
          Object.entries(data)
            .filter(([, holiday]) => holiday.isOffDay)
            .map(([date, holiday]) => [date, holiday.name])
        );
        setHolidays(next);
        setHolidayStatus('ready');
      })
      .catch(() => {
        setHolidays({});
        setHolidayStatus('error');
      });
  }, [cursor.year]);

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-`;
  const monthHolidayCount = Object.keys(holidays).filter((date) => date.startsWith(monthPrefix)).length;
  const holidayHint = holidayStatus === 'loading'
    ? '节假日加载中'
    : holidayStatus === 'error'
      ? '节假日数据暂不可用'
      : monthHolidayCount > 0
        ? `本月 ${monthHolidayCount} 天节假日`
        : '本月无法定节假日';

  /** 选中日期 → 自动填充日期输入框 */
  const selectDate = useCallback((key: string) => {
    setSelected(key);
    // 如果不在编辑模式，自动填充日期
    if (!editingId) {
      const d = new Date(`${key}T09:00`);
      if (!isNaN(d.getTime())) {
        setFormStart(toDatetimeLocal(d, 9, 0));
      }
    }
  }, [editingId]);

  useEffect(() => {
    const current = new Date(`${selected}T00:00`);
    if (current.getFullYear() === cursor.year && current.getMonth() === cursor.month) return;
    const day = Math.min(
      current.getDate(),
      new Date(cursor.year, cursor.month + 1, 0).getDate()
    );
    selectDate(dateKey(new Date(cursor.year, cursor.month, day)));
  }, [cursor, selected, selectDate]);

  function shiftMonth(delta: number) {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
    const selectedDate = new Date(`${selected}T00:00`);
    const day = Math.min(
      selectedDate.getDate(),
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    );
    selectDate(dateKey(new Date(next.getFullYear(), next.getMonth(), day)));
  }

  function goToday() {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    selectDate(dateKey(now));
    // 聚焦标题输入框
    setTimeout(() => titleRef.current?.focus(), 100);
  }

  /** 重置表单 */
  function resetForm() {
    setFormTitle('');
    setFormStart(toDatetimeLocal(new Date(`${selected}T09:00`), 9, 0));
    setFormPriority('medium');
    setFormRepeat('none');
    setEditingId(null);
    setError('');
  }

  /** 编辑已有待办 */
  function startEdit(todo: Todo) {
    setEditingId(todo.id);
    setFormTitle(todo.title);
    setFormStart(todo.start || todo.due ? toDatetimeLocal(new Date(todo.start || todo.due!), 9, 0) : '');
    setFormPriority(todo.priority);
    setFormRepeat(todo.repeat);
    setTimeout(() => titleRef.current?.focus(), 100);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!formTitle.trim()) return;
    try {
      if (editingId) {
        // 更新
        const next = await window.workbench.workspace.todos.update(editingId, {
          title: formTitle.trim(),
          priority: formPriority,
          start: formStart || null,
          due: formStart || `${selected}T23:59`,
          repeat: formRepeat,
        });
        setTodos(next);
      } else {
        // 新建
        const next = await window.workbench.workspace.todos.create({
          title: formTitle.trim(),
          priority: formPriority,
          start: formStart || null,
          due: formStart || `${selected}T23:59`,
          repeat: formRepeat,
        });
        setTodos(next);
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function toggleTodo(todo: Todo) {
    const next = await window.workbench.workspace.todos.update(todo.id, { done: !todo.done });
    setTodos(next);
  }

  async function removeTodo(id: string) {
    const next = await window.workbench.workspace.todos.remove(id);
    setTodos(next);
    if (editingId === id) resetForm();
  }

  /** 键盘导航 */
  function handleKeyDown(event: React.KeyboardEvent) {
    const current = new Date(`${selected}T00:00`);
    let moved = false;
    switch (event.key) {
      case 'ArrowLeft': current.setDate(current.getDate() - 1); moved = true; break;
      case 'ArrowRight': current.setDate(current.getDate() + 1); moved = true; break;
      case 'ArrowUp': current.setDate(current.getDate() - 7); moved = true; break;
      case 'ArrowDown': current.setDate(current.getDate() + 7); moved = true; break;
      case 'Enter':
        // 聚焦到标题输入框
        titleRef.current?.focus();
        event.preventDefault();
        return;
    }
    if (moved) {
      event.preventDefault();
      const key = dateKey(current);
      // 如果跨月了，自动翻月
      if (current.getMonth() !== cursor.month) {
        setCursor({ year: current.getFullYear(), month: current.getMonth() });
      }
      selectDate(key);
    }
  }

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const start = new Date(cursor.year, cursor.month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = dateKey(date);
      return { key, day: date.getDate(), inMonth: date.getMonth() === cursor.month, isToday: key === dateKey(new Date()) };
    });
  }, [cursor]);

  /** 选中日期的待办 */
  const dayTodos = useMemo(() =>
    todos
      .filter((todo) => {
        const key = todo.start ? dateKey(new Date(todo.start)) : todo.due ? dateKey(new Date(todo.due)) : null;
        return key === selected;
      })
      .sort((a, b) => (a.start || a.due || '').localeCompare(b.start || b.due || '')),
    [todos, selected]
  );

  return (
    <section className="module-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">日历</h2>
          <p className="page-sub">待办日程总览 · {holidayHint}</p>
        </div>
        <div className="calendar-head">
          <button type="button" className="icon-btn" aria-label="上一月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="text-btn" onClick={goToday}>
            {cursor.year} 年 {cursor.month + 1} 月
          </button>
          <button type="button" className="icon-btn" aria-label="下一月" onClick={() => shiftMonth(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-panel">
          <div className="calendar-weekdays">
            {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="calendar-grid" ref={gridRef} tabIndex={0} onKeyDown={handleKeyDown}>
            {cells.map((cell) => {
              const dayTodos = todos.filter((todo) => {
                const key = todo.start ? dateKey(new Date(todo.start)) : todo.due ? dateKey(new Date(todo.due)) : null;
                return key === cell.key;
              });
              const hasOverdue = dayTodos.some((t) => isOverdue(t));
              const count = dayTodos.length;
              const activeTodos = dayTodos.filter((todo) => !todo.done);
              const marker = hasOverdue
                ? 'overdue'
                : activeTodos.some((todo) => todo.start)
                  ? 'event'
                  : activeTodos.length > 0
                    ? 'todo'
                    : 'done';
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={`calendar-cell${cell.inMonth ? '' : ' muted'}${cell.isToday ? ' today' : ''}${cell.key === selected ? ' selected' : ''}${hasOverdue ? ' has-overdue' : ''}`}
                  onClick={() => selectDate(cell.key)}
                  aria-label={`${cell.day} 日${count > 0 ? `，${count} 个待办` : ''}`}
                >
                  <span className="cell-day">{cell.day}</span>
                  {holidays[cell.key] && cell.inMonth && <span className="cell-holiday">{holidays[cell.key]}</span>}
                  {count > 0 && (
                    <span className="cell-summary" title={`${count} 个待办`}>
                      <span className={`cell-dot ${marker}`} />
                      <span className="cell-dot-count">{count}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="calendar-side">
          <div className="calendar-side-inner">
            <h3 className="side-title">
              {dayTitle(selected)}
              {holidays[selected] && <span className="side-holiday">{holidays[selected]}</span>}
            </h3>

            <form className="side-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>标题</span>
                <input ref={titleRef} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="要做的事 / 日程" />
              </label>
              <label className="field">
                <span>日期 / 时间</span>
                <input type="datetime-local" value={formStart} onChange={(e) => setFormStart(e.target.value)} />
              </label>
              <div className="quick-time">
                <button type="button" className="chip" onClick={() => setFormStart(todayAt(20))}>今晚 20:00</button>
                <button type="button" className="chip" onClick={() => setFormStart(todayAt(22))}>今晚 22:00</button>
                <button type="button" className="chip" onClick={() => setFormStart(tomorrowAt(9))}>明天 09:00</button>
              </div>
              <div className="side-form-row">
                <label className="field">
                  <span>优先级</span>
                  <select value={formPriority} onChange={(e) => setFormPriority(e.target.value as Priority)}>
                    <option value="high">高优先级</option>
                    <option value="medium">中优先级</option>
                    <option value="low">低优先级</option>
                  </select>
                </label>
                <label className="field">
                  <span>重复</span>
                  <select value={formRepeat} onChange={(e) => setFormRepeat(e.target.value as Todo['repeat'])}>
                    <option value="none">不重复</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                    <option value="yearly">每年</option>
                  </select>
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary btn-small">
                  <Plus size={15} /> {editingId ? '保存修改' : '添加'}
                </button>
                {editingId && (
                  <button type="button" className="text-btn" onClick={resetForm}>
                    <X size={14} /> 取消
                  </button>
                )}
              </div>
            </form>

            {error && <p className="form-error">{error}</p>}
          </div>

          <div className="day-list-wrap">
            <h4 className="day-list-title">
              待办 <span className="day-list-count">{dayTodos.length}</span>
            </h4>
            <div className="day-list">
              {dayTodos.map((todo) => {
                const overdue = isOverdue(todo);
                const dueSoon = isDueSoon(todo);
                const hasTime = !!todo.start;
                const isEditing = editingId === todo.id;
                return (
                  <div
                    key={todo.id}
                    className={`day-item${todo.done ? ' done' : ''}${overdue ? ' overdue' : ''}${isEditing ? ' editing' : ''}`}
                    onClick={() => !isEditing && startEdit(todo)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isEditing) startEdit(todo); }}
                  >
                    <button
                      type="button"
                      aria-label="完成状态"
                      className={`todo-check small${todo.done ? ' checked' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleTodo(todo); }}
                    >
                      {todo.done && <Check size={12} strokeWidth={3} />}
                    </button>
                    {hasTime && (
                      <span className="day-item-time">
                        {new Date(todo.start!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    )}
                    <span className={`priority priority-${todo.priority}`}>
                      {PRIORITY_LABEL[todo.priority]}
                    </span>
                    <span className="day-item-title">{todo.title}</span>
                    {todo.repeat !== 'none' && <Repeat size={12} strokeWidth={1.8} className="repeat-icon" />}
                    {overdue && <span className="badge badge-overdue">{relativeTime(todo.due!)}</span>}
                    {dueSoon && !overdue && <span className="badge badge-due-soon">{relativeTime(todo.due!)}</span>}
                    <button type="button" className="icon-btn" aria-label="删除" onClick={(e) => { e.stopPropagation(); removeTodo(todo.id); }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
              {dayTodos.length === 0 && (
                <p className="empty">今天暂无安排，享受休息吧 🎉</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
