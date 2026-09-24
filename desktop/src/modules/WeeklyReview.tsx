import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, CircleAlert, FileText, ListTodo, RefreshCw } from 'lucide-react';
import type { ModuleKey } from '../App';
import type { WeeklyItem, WeeklySnapshot } from '../types';
import WeeklyPlanDraft from '../components/WeeklyPlanDraft';

type WeeklyReviewProps = { onNavigate: (target: ModuleKey) => void };

function rangeLabel(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
  return `${formatter.format(new Date(`${start}T00:00`))} — ${formatter.format(new Date(`${end}T00:00`))}`;
}

function timeLabel(value: string | null) {
  if (!value) return '尚未安排时间';
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function priorityLabel(priority: WeeklyItem['priority']) {
  return priority === 'high' ? '高优先级' : priority === 'medium' ? '中优先级' : '低优先级';
}

function ItemList({ items, empty, onNavigate }: { items: WeeklyItem[]; empty: string; onNavigate: (target: ModuleKey) => void }) {
  if (!items.length) return <p className="weekly-empty">{empty}</p>;
  return <ol className="weekly-item-list">{items.map((item) => <li key={item.id}><button type="button" onClick={() => onNavigate(item.type === 'schedule' ? 'calendar' : 'todos')}><span><strong>{item.title}</strong><small>{timeLabel(item.at)} · {priorityLabel(item.priority)}</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ol>;
}

export default function WeeklyReview({ onNavigate }: WeeklyReviewProps) {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [planOpen, setPlanOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await window.workbench.weekly.getSnapshot());
    } catch {
      setError('本周回顾暂时无法读取，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const stopAgentUpdates = window.workbench.agent.onStateUpdated(() => void load());
    return () => stopAgentUpdates();
  }, [load]);

  if (loading && !snapshot) return <section className="weekly-page weekly-page-loading"><RefreshCw size={18} className="weekly-spin" /><p>正在整理这一周…</p></section>;
  if (error && !snapshot) return <section className="weekly-page weekly-page-loading"><p>{error}</p><button type="button" className="text-btn" onClick={() => void load()}>重新加载</button></section>;

  const data = snapshot!;
  const overdueIds = new Set(data.overdue.map((item) => item.id));
  const currentWeek = data.currentWeek.filter((item) => !overdueIds.has(item.id));
  return (
    <section className="weekly-page" aria-label="本周回顾">
      <header className="weekly-header">
        <div><h1>本周回顾</h1><p>{rangeLabel(data.weekStart, data.weekEnd)}</p></div>
        <div className="weekly-header-actions">
          <button type="button" className="weekly-plan-action" onClick={() => setPlanOpen(true)}>安排下周 <ChevronRight size={14} aria-hidden="true" /></button>
          <button type="button" className="weekly-refresh" onClick={() => void load()} disabled={loading} aria-label="刷新本周回顾" title="刷新本周回顾"><RefreshCw size={16} className={loading ? 'weekly-spin' : ''} /></button>
        </div>
      </header>
      {error && <p className="weekly-error" role="status">{error}</p>}

      <div className="weekly-content">
        <section className="weekly-section weekly-overdue" aria-labelledby="weekly-overdue-title">
          <div className="weekly-section-head"><div><CircleAlert size={16} aria-hidden="true" /><h2 id="weekly-overdue-title">需要收尾</h2></div><button type="button" onClick={() => onNavigate('todos')}>全部待办 <ChevronRight size={14} /></button></div>
          <ItemList items={data.overdue} empty="暂无待收尾事项" onNavigate={onNavigate} />
        </section>
        <section className="weekly-section weekly-current" aria-labelledby="weekly-current-title">
          <div className="weekly-section-head"><div><CalendarDays size={16} aria-hidden="true" /><h2 id="weekly-current-title">本周安排</h2></div><button type="button" onClick={() => onNavigate('calendar')}>打开日历 <ChevronRight size={14} /></button></div>
          <ItemList items={currentWeek} empty={data.currentWeekTotal ? '没有其他安排' : '本周暂无安排'} onNavigate={onNavigate} />
        </section>
        <section className="weekly-section weekly-notes" aria-labelledby="weekly-notes-title">
          <div className="weekly-section-head"><div><FileText size={16} aria-hidden="true" /><h2 id="weekly-notes-title">本周收集</h2></div><button type="button" onClick={() => onNavigate('notes')}>打开备忘录 <ChevronRight size={14} /></button></div>
          {data.recentNotes.length ? <ol className="weekly-note-list">{data.recentNotes.map((note) => <li key={note.id}><button type="button" onClick={() => onNavigate('notes')}><span><strong>{note.title}</strong><small>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(note.updatedAt))} 更新</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ol> : <p className="weekly-empty">本周暂无收集</p>}
        </section>
        <section className="weekly-section weekly-next" aria-labelledby="weekly-next-title">
          <div className="weekly-section-head"><div><ListTodo size={16} aria-hidden="true" /><h2 id="weekly-next-title">下周安排</h2></div></div>
          <ItemList items={data.nextWeek} empty="下周暂无安排" onNavigate={onNavigate} />
        </section>
      </div>
      <WeeklyPlanDraft open={planOpen} weekStart={data.nextWeekStart} weekEnd={data.nextWeekEnd} onClose={() => setPlanOpen(false)} onApplied={() => void load()} />
    </section>
  );
}
