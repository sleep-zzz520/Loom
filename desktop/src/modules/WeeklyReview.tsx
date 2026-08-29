import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, CircleAlert, FileText, ListTodo, RefreshCw, Target } from 'lucide-react';
import type { ModuleKey } from '../App';
import type { WeeklyItem, WeeklySnapshot } from '../types';

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
  return (
    <section className="weekly-page" aria-label="本周回顾">
      <header className="weekly-header">
        <div><p>本周回顾</p><h1>{rangeLabel(data.weekStart, data.weekEnd)}</h1><span>只汇总已有记录，不会替你补写完成情况。</span></div>
        <button type="button" className="weekly-refresh" onClick={() => void load()} disabled={loading} aria-label="刷新本周回顾" title="刷新本周回顾"><RefreshCw size={15} className={loading ? 'weekly-spin' : ''} /><span>刷新</span></button>
      </header>
      {error && <p className="weekly-error" role="status">{error}</p>}

      <dl className="weekly-summary" aria-label="本周概览">
        <div><dt>本周安排</dt><dd>{data.currentWeekTotal}</dd><small>带日期或时间的事项</small></div>
        <div className={data.overdueCount ? 'is-attention' : ''}><dt>仍需收尾</dt><dd>{data.overdueCount}</dd><small>当前尚未完成且已到期</small></div>
        <div><dt>本周收集</dt><dd>{data.captureCount}</dd><small>本周更新的备忘录</small></div>
        <div><dt>进行目标</dt><dd>{data.activeGoalCount}</dd><small>当前活跃的 Agent 目标</small></div>
      </dl>

      <div className="weekly-grid">
        <section className="weekly-section weekly-current" aria-labelledby="weekly-current-title">
          <div className="weekly-section-head"><div><CalendarDays size={15} aria-hidden="true" /><h2 id="weekly-current-title">这一周的安排</h2></div><button type="button" onClick={() => onNavigate('calendar')}>打开日历 <ChevronRight size={14} /></button></div>
          <ItemList items={data.currentWeek} empty="这一周没有带日期的待办或日程。" onNavigate={onNavigate} />
        </section>
        <aside className="weekly-side">
          <section className="weekly-section weekly-overdue" aria-labelledby="weekly-overdue-title">
            <div className="weekly-section-head"><div><CircleAlert size={15} aria-hidden="true" /><h2 id="weekly-overdue-title">需要收尾</h2></div><button type="button" onClick={() => onNavigate('todos')}>全部待办 <ChevronRight size={14} /></button></div>
            <ItemList items={data.overdue} empty="目前没有超期事项。" onNavigate={onNavigate} />
          </section>
          <section className="weekly-section weekly-notes" aria-labelledby="weekly-notes-title">
            <div className="weekly-section-head"><div><FileText size={15} aria-hidden="true" /><h2 id="weekly-notes-title">本周收集</h2></div><button type="button" onClick={() => onNavigate('notes')}>打开备忘录 <ChevronRight size={14} /></button></div>
            {data.recentNotes.length ? <ol className="weekly-note-list">{data.recentNotes.map((note) => <li key={note.id}><button type="button" onClick={() => onNavigate('notes')}><span><strong>{note.title}</strong><small>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(note.updatedAt))} 更新</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ol> : <p className="weekly-empty">这一周还没有更新备忘录。</p>}
          </section>
        </aside>
      </div>

      <section className="weekly-section weekly-next" aria-labelledby="weekly-next-title">
        <div className="weekly-section-head"><div><ListTodo size={15} aria-hidden="true" /><h2 id="weekly-next-title">下周准备</h2></div><span>{rangeLabel(data.nextWeekStart, data.nextWeekEnd)}</span></div>
        <ItemList items={data.nextWeek} empty="下周还没有排入具体时间的事项。需要时可用 ⌘ K 快速添加。" onNavigate={onNavigate} />
      </section>
      <p className="weekly-footnote"><Target size={14} aria-hidden="true" /> 回顾的是当前留在工作台里的事实；已完成但未保留完成时间的事项不会被计入本周完成数。</p>
    </section>
  );
}
