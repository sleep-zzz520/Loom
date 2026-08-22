import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus, Repeat, Sparkles, Trash2, X } from 'lucide-react';
import type { Priority, Todo } from '../types';
import { DateField } from '../components/DateFields';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
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

function isPersonalDateCandidate(todo: Todo): boolean {
  return todo.repeat === 'yearly'
    && !todo.personalDateId
    && Boolean(todo.due)
    && /(生日|纪念日)/.test(todo.title);
}

function recurringSources(todos: Todo[]): Todo[] {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos) {
    const key = todo.recurrenceId || todo.id;
    groups.set(key, [...(groups.get(key) || []), todo]);
  }
  const now = Date.now();
  return [...groups.values()].map((items) => {
    const open = items.filter((todo) => !todo.done);
    return open.filter((todo) => todo.due && new Date(todo.due).getTime() >= now)
      .sort((a, b) => String(a.due).localeCompare(String(b.due)))[0]
      || open.sort((a, b) => String(b.due).localeCompare(String(a.due)))[0]
      || items[0];
  });
}

function occursOn(todo: Todo, key: string): boolean {
  const source = todo.start || todo.due;
  if (!source) return false;
  const sourceDate = new Date(source);
  const sourceKey = dateKey(sourceDate);
  if (key < sourceKey || (todo.repeatUntil && key > todo.repeatUntil)) return false;
  if (todo.repeat === 'none') return key === sourceKey;
  const target = new Date(`${key}T00:00`);
  const sourceDay = new Date(`${sourceKey}T00:00`);
  const days = Math.round((target.getTime() - sourceDay.getTime()) / 86_400_000);
  if (todo.repeat === 'daily') return days >= 0;
  if (todo.repeat === 'weekly') return days >= 0 && days % 7 === 0;
  if (todo.repeat === 'monthly') {
    const months = (target.getFullYear() - sourceDay.getFullYear()) * 12 + target.getMonth() - sourceDay.getMonth();
    return months >= 0 && target.getDate() === sourceDay.getDate();
  }
  return target.getMonth() === sourceDay.getMonth() && target.getDate() === sourceDay.getDate();
}

function dateAtOccurrence(value: string | null, key: string): string | null {
  if (!value) return null;
  const original = new Date(value);
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, original.getHours(), original.getMinutes(), original.getSeconds()).toISOString();
}

function occurrencesOn(todos: Todo[], key: string): Todo[] {
  return todos.flatMap((todo) => {
    if (!occursOn(todo, key)) return [];
    const sourceKey = dateKey(new Date(todo.start || todo.due!));
    if (sourceKey === key) return [todo];
    return [{
      ...todo,
      id: `${todo.id}@${key}`,
      start: dateAtOccurrence(todo.start, key),
      end: dateAtOccurrence(todo.end, key),
      due: dateAtOccurrence(todo.due, key),
      occurrenceSourceId: todo.id,
    }];
  });
}

export default function Calendar() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [formTitle, setFormTitle] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formRepeat, setFormRepeat] = useState<Todo['repeat']>('none');
  const [formRepeatUntil, setFormRepeatUntil] = useState('');
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(cursor.year);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [personalDateCandidate, setPersonalDateCandidate] = useState<Todo | null>(null);
  const [rememberingDate, setRememberingDate] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dismissedCandidateIds = useRef(new Set<string>());

  async function load() {
    const list = await window.workbench.workspace.todos.list().catch(() => []);
    setTodos(list);
  }

  useEffect(() => { load(); }, []);

  // 兼容在此功能上线前创建的每年生日/纪念日：打开对应日期时仍会给出一次确认。
  useEffect(() => {
    if (personalDateCandidate) return;
    const candidate = todos.find((todo) => {
      const todoDate = todo.start || todo.due;
      return todoDate && dateKey(new Date(todoDate)) === selected
        && isPersonalDateCandidate(todo)
        && !dismissedCandidateIds.current.has(todo.id);
    });
    if (candidate) setPersonalDateCandidate(candidate);
  }, [todos, selected, personalDateCandidate]);

  /** 获取节假日 */
  useEffect(() => {
    const year = cursor.year;
    window.workbench.calendar
      .getHolidays(year)
      .then((data) => {
        const next = Object.fromEntries(
          Object.entries(data)
            .filter(([, holiday]) => holiday.isOffDay)
            .map(([date, holiday]) => [date, holiday.name])
        );
        setHolidays(next);
      })
      .catch(() => {
        setHolidays({});
      });
  }, [cursor.year]);

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
    moveToMonth(next.getFullYear(), next.getMonth());
  }

  function moveToMonth(year: number, month: number) {
    setCursor({ year, month });
    const selectedDate = new Date(`${selected}T00:00`);
    const day = Math.min(
      selectedDate.getDate(),
      new Date(year, month + 1, 0).getDate()
    );
    selectDate(dateKey(new Date(year, month, day)));
  }

  function toggleMonthPicker() {
    if (monthPickerOpen) {
      setMonthPickerOpen(false);
      return;
    }
    setPickerYear(cursor.year);
    setMonthPickerOpen(true);
  }

  function pickMonth(month: number) {
    moveToMonth(pickerYear, month);
    setMonthPickerOpen(false);
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
    setFormRepeatUntil('');
    setEditingId(null);
    setError('');
  }

  function setRepeatEnd(days: number) {
    const start = new Date(formStart || `${selected}T09:00`);
    if (Number.isNaN(start.getTime())) return;
    start.setDate(start.getDate() + days);
    setFormRepeatUntil(dateKey(start));
  }

  function setRepeatEndByMonths(months: number) {
    const start = new Date(formStart || `${selected}T09:00`);
    if (Number.isNaN(start.getTime())) return;
    start.setMonth(start.getMonth() + months);
    setFormRepeatUntil(dateKey(start));
  }

  /** 编辑已有待办 */
  function startEdit(todo: Todo) {
    const sourceId = todo.occurrenceSourceId || todo.id;
    dismissedCandidateIds.current.add(sourceId);
    setPersonalDateCandidate(null);
    setEditingId(sourceId);
    setFormTitle(todo.title);
    setFormStart(todo.start || todo.due ? toDatetimeLocal(new Date(todo.start || todo.due!), 9, 0) : '');
    setFormPriority(todo.priority);
    setFormRepeat(todo.repeat);
    setFormRepeatUntil(todo.repeatUntil || '');
    setTimeout(() => titleRef.current?.focus(), 100);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!formTitle.trim()) return;
    try {
      const savedId = editingId;
      const next = savedId
        ? await window.workbench.workspace.todos.update(savedId, {
          title: formTitle.trim(),
          priority: formPriority,
          start: formStart || null,
          due: formStart || `${selected}T23:59`,
          repeat: formRepeat,
          repeatUntil: formRepeat === 'none' ? null : formRepeatUntil || null,
        })
        : await window.workbench.workspace.todos.create({
          title: formTitle.trim(),
          priority: formPriority,
          start: formStart || null,
          due: formStart || `${selected}T23:59`,
          repeat: formRepeat,
          repeatUntil: formRepeat === 'none' ? null : formRepeatUntil || null,
        });
      const saved = savedId ? next.find((todo) => todo.id === savedId) : next[0];
      setTodos(next);
      if (saved && isPersonalDateCandidate(saved)) {
        setPersonalDateCandidate(saved);
      } else if (savedId === personalDateCandidate?.id) {
        setPersonalDateCandidate(null);
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function rememberPersonalDate() {
    if (!personalDateCandidate || rememberingDate) return;
    setRememberingDate(true);
    setError('');
    try {
      const result = await window.workbench.workspace.todos.rememberPersonalDate(personalDateCandidate.id);
      setTodos(result.todos);
      setPersonalDateCandidate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存个人日期失败');
    } finally {
      setRememberingDate(false);
    }
  }

  function dismissPersonalDateCandidate() {
    if (personalDateCandidate) dismissedCandidateIds.current.add(personalDateCandidate.id);
    setPersonalDateCandidate(null);
  }

  async function toggleTodo(todo: Todo) {
    const next = await window.workbench.workspace.todos.update(todo.occurrenceSourceId || todo.id, {
      done: !todo.done,
      ...(todo.occurrenceSourceId ? { start: todo.start, end: todo.end, due: todo.due } : {}),
    });
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
  const calendarTodos = useMemo(() => recurringSources(todos), [todos]);
  const dayTodos = useMemo(() =>
    occurrencesOn(calendarTodos, selected)
      .sort((a, b) => (a.start || a.due || '').localeCompare(b.start || b.due || '')),
    [calendarTodos, selected]
  );

  return (
    <section className="module-page">
      <div className="calendar-layout">
        <div className="calendar-panel">
          <div className="calendar-panel-toolbar">
            <div className="calendar-navigation" aria-label="日历导航">
              <button type="button" className="icon-btn" aria-label="上一年" onClick={() => moveToMonth(cursor.year - 1, cursor.month)}>
                <ChevronsLeft size={17} />
              </button>
              <button type="button" className="icon-btn" aria-label="上一月" onClick={() => shiftMonth(-1)}>
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="calendar-month-trigger"
                aria-haspopup="dialog"
                aria-expanded={monthPickerOpen}
                onClick={toggleMonthPicker}
              >
                <CalendarDays size={15} />
                {cursor.year}年 {cursor.month + 1}月
                <ChevronDown size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label="下一月" onClick={() => shiftMonth(1)}>
                <ChevronRight size={18} />
              </button>
              <button type="button" className="icon-btn" aria-label="下一年" onClick={() => moveToMonth(cursor.year + 1, cursor.month)}>
                <ChevronsRight size={17} />
              </button>
              <button type="button" className="calendar-today-btn" onClick={goToday}>今天</button>
              {monthPickerOpen && (
                <div className="calendar-month-popover" role="dialog" aria-label="选择年月">
                  <div className="calendar-month-popover-head">
                    <button type="button" className="icon-btn" aria-label="上一年" onClick={() => setPickerYear((year) => year - 1)}>
                      <ChevronLeft size={16} />
                    </button>
                    <strong>{pickerYear}年</strong>
                    <button type="button" className="icon-btn" aria-label="下一年" onClick={() => setPickerYear((year) => year + 1)}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="calendar-month-options">
                    {MONTHS.map((label, month) => (
                      <button
                        key={label}
                        type="button"
                        className={`calendar-month-option${pickerYear === cursor.year && month === cursor.month ? ' selected' : ''}`}
                        onClick={() => pickMonth(month)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="calendar-weekdays">
            {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="calendar-grid" ref={gridRef} tabIndex={0} onKeyDown={handleKeyDown}>
            {cells.map((cell) => {
              const dayTodos = occurrencesOn(calendarTodos, cell.key);
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
                <DateField mode="datetime" value={formStart} onChange={setFormStart} ariaLabel="选择日期和时间" placeholder="选择日期和时间" />
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
              {formRepeat !== 'none' && (
                <div className="repeat-until-field">
                  <label className="field">
                    <span>循环结束日期</span>
                    <DateField mode="date" value={formRepeatUntil} onChange={setFormRepeatUntil} ariaLabel="选择循环结束日期" placeholder="持续循环" />
                  </label>
                  <div className="repeat-until-help">
                    <span>留空则持续重复</span>
                    <div>
                      <button type="button" className="chip" onClick={() => setRepeatEnd(7)}>7 天后</button>
                      <button type="button" className="chip" onClick={() => setRepeatEndByMonths(1)}>1 个月后</button>
                      <button type="button" className="chip" onClick={() => setRepeatEndByMonths(3)}>3 个月后</button>
                    </div>
                  </div>
                </div>
              )}
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

            {personalDateCandidate && (
              <aside className="personal-date-suggestion" aria-label="Agent 发现私人日期">
                <span className="personal-date-suggestion-icon"><Sparkles size={15} /></span>
                <div>
                  <strong>Agent 发现了一条长期日期</strong>
                  <p>“{personalDateCandidate.title}”会每年重复。确认后，Agent 会把它记为你的个人日期并在当天主动提醒。</p>
                  <div>
                    <button type="button" className="btn-primary btn-small" onClick={rememberPersonalDate} disabled={rememberingDate}>
                      {rememberingDate ? '记忆中…' : '让 Agent 记住'}
                    </button>
                    <button type="button" className="text-btn" onClick={dismissPersonalDateCandidate} disabled={rememberingDate}>暂不</button>
                  </div>
                </div>
              </aside>
            )}

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
                const isEditing = editingId === (todo.occurrenceSourceId || todo.id);
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
                    <button type="button" className="icon-btn" aria-label="删除" onClick={(e) => { e.stopPropagation(); removeTodo(todo.occurrenceSourceId || todo.id); }}>
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
