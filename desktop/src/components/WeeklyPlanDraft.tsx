import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ListPlus, X } from 'lucide-react';
import { DateField } from './DateFields';
import type { Todo, WeeklyPlanEntry } from '../types';

type WeeklyPlanDraftProps = {
  open: boolean;
  weekStart: string;
  weekEnd: string;
  onClose: () => void;
  onApplied: () => void;
};

type PlanRow = WeeklyPlanEntry & { title: string; priority: Todo['priority']; due: string | null };

const MAX_PLANNED_TODOS = 3;
const PRIORITY_LABEL: Record<Todo['priority'], string> = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const PRIORITY_RANK: Record<Todo['priority'], number> = { high: 0, medium: 1, low: 2 };

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function initialStart(weekStart: string, index: number) {
  const date = new Date(`${weekStart}T09:30`);
  date.setDate(date.getDate() + index);
  return localDateTime(date);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00`));
}

function dueLabel(due: string | null) {
  const date = validDate(due);
  if (!date) return '尚未设置截止时间';
  return `截止 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)}`;
}

function selectableTodos(todos: Todo[], weekStart: string) {
  const nextWeekStart = new Date(`${weekStart}T00:00`).getTime();
  return todos
    .filter((todo) => {
      if (todo.done || todo.repeat !== 'none' || todo.start) return false;
      const due = validDate(todo.due);
      return !due || due.getTime() >= nextWeekStart;
    })
    .sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      || String(left.due || '9999').localeCompare(String(right.due || '9999'))
      || String(right.createdAt).localeCompare(String(left.createdAt)));
}

/** 用户从既有待办中选计划；不根据内容推断优先级，也不会自动添加事项。 */
export default function WeeklyPlanDraft({ open, weekStart, weekEnd, onClose, onApplied }: WeeklyPlanDraftProps) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [stage, setStage] = useState<'select' | 'draft' | 'saved'>('select');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setStage('select');
    setSelectedIds([]);
    setRows([]);
    setError('');
    setLoading(true);
    void window.workbench.workspace.todos.list()
      .then((next) => { if (!disposed) setTodos(next); })
      .catch(() => { if (!disposed) setError('待办暂时无法读取，请稍后重试。'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [open]);

  function close() {
    if (!saving) onClose();
  }

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, saving]);

  const candidates = useMemo(() => selectableTodos(todos, weekStart), [todos, weekStart]);
  const candidateById = useMemo(() => new Map(candidates.map((todo) => [todo.id, todo])), [candidates]);

  function toggle(todoId: string) {
    setError('');
    setSelectedIds((ids) => {
      if (ids.includes(todoId)) return ids.filter((id) => id !== todoId);
      // ponytail: 第一版把每周聚焦限制为三项；未来若引入工时和容量模型，再开放更多槽位。
      if (ids.length >= MAX_PLANNED_TODOS) return ids;
      return [...ids, todoId];
    });
  }

  function makeDraft() {
    const nextRows = selectedIds
      .map((id) => candidateById.get(id))
      .filter((todo): todo is Todo => Boolean(todo))
      .map((todo, index) => ({ id: todo.id, title: todo.title, priority: todo.priority, due: todo.due, start: initialStart(weekStart, index) }));
    if (!nextRows.length) return;
    setRows(nextRows);
    setStage('draft');
    setError('');
  }

  async function apply() {
    if (!rows.length || saving) return;
    setSaving(true);
    setError('');
    try {
      await window.workbench.weekly.applyPlan(rows.map(({ id, start }) => ({ id, start })));
      setStage('saved');
      onApplied();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划暂时无法写入，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="weekly-plan-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <section className="weekly-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-plan-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="weekly-plan-head">
          <div><p><CalendarDays size={14} aria-hidden="true" /> 下周计划</p><h2 id="weekly-plan-title">把重要事项放进时间里</h2><span>{dateLabel(weekStart)} — {dateLabel(weekEnd)} · 只处理已有待办</span></div>
          <button type="button" className="weekly-plan-close" onClick={close} aria-label="关闭下周计划" title="关闭" disabled={saving}><X size={17} /></button>
        </header>

        {stage === 'select' && <>
          <p className="weekly-plan-intro">选择 1 至 {MAX_PLANNED_TODOS} 项一次性待办。生成草稿后可逐项调整日期和时间，确认前不会改动数据。</p>
          {loading ? <p className="weekly-plan-state">正在读取待办…</p> : candidates.length ? <ol className="weekly-plan-candidates">{candidates.slice(0, 8).map((todo) => {
            const checked = selectedIds.includes(todo.id);
            const disabled = !checked && selectedIds.length >= MAX_PLANNED_TODOS;
            return <li key={todo.id}><label className={`${checked ? 'is-selected' : ''}${disabled ? ' is-disabled' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(todo.id)} /><span><strong>{todo.title}</strong><small>{PRIORITY_LABEL[todo.priority]} · {dueLabel(todo.due)}</small></span><i>{checked ? '已选' : '选择'}</i></label></li>;
          })}</ol> : <p className="weekly-plan-state">没有可加入的候选待办。已安排、已完成、循环或临近到期的事项会留在原来的处理流程中。</p>}
          {error && <p className="weekly-plan-error" role="status">{error}</p>}
          <footer className="weekly-plan-actions"><button type="button" className="weekly-plan-cancel" onClick={close}>取消</button><button type="button" className="weekly-plan-next" onClick={makeDraft} disabled={!selectedIds.length || loading}>{selectedIds.length ? `生成 ${selectedIds.length} 项计划草稿` : '生成计划草稿'} <ListPlus size={15} /></button></footer>
        </>}

        {stage === 'draft' && <>
          <p className="weekly-plan-intro">这是你的计划草稿。确认后只会写入以下事项的开始时间；已有截止时间保持不变。</p>
          <ol className="weekly-plan-rows">{rows.map((row, index) => <li key={row.id}><span className="weekly-plan-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{row.title}</strong><small>{PRIORITY_LABEL[row.priority]} · {dueLabel(row.due)}</small></div><DateField mode="datetime" value={row.start} onChange={(start) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, start } : item))} ariaLabel={`安排 ${row.title} 的时间`} /></li>)}</ol>
          {error && <p className="weekly-plan-error" role="status">{error}</p>}
          <footer className="weekly-plan-actions"><button type="button" className="weekly-plan-cancel" onClick={() => { setStage('select'); setError(''); }} disabled={saving}><ChevronLeft size={15} /> 返回选择</button><button type="button" className="weekly-plan-next" onClick={() => void apply()} disabled={saving}>{saving ? '写入中…' : `确认写入 ${rows.length} 项安排`} <Check size={15} /></button></footer>
        </>}

        {stage === 'saved' && <div className="weekly-plan-saved" role="status"><Check size={18} /><div><strong>下周计划已写入</strong><span>{rows.length} 项待办已进入日历；你仍可在日历中调整时间。</span></div><button type="button" onClick={close}>完成</button></div>}
      </section>
    </div>
  );
}
