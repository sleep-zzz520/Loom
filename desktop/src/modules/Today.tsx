import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileText, RefreshCw, StickyNote } from 'lucide-react';
import type { ModuleKey } from '../App';
import type { TodaySnapshot } from '../types';

type TodayProps = {
  onNavigate: (target: ModuleKey) => void;
  onOpenAgent: (messageId?: string) => void;
};

function relativeUpdatedAt(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(date.getTime()) || diff < 0) return '刚刚更新';
  if (diff < 60_000) return '刚刚更新';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前更新`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前更新`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function priorityLabel(priority: 'high' | 'medium' | 'low') {
  return priority === 'high' ? '高优先级' : priority === 'medium' ? '中优先级' : '低优先级';
}

export default function Today({ onNavigate, onOpenAgent }: TodayProps) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await window.workbench.today.getSnapshot());
    } catch {
      setError('今日概览暂时无法读取，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const stopAgentUpdates = window.workbench.agent.onStateUpdated(() => void load());
    const stopProactiveUpdates = window.workbench.agent.onProactiveUpdated(() => void load());
    return () => {
      stopAgentUpdates();
      stopProactiveUpdates();
    };
  }, [load]);

  if (loading && !snapshot) {
    return <section className="today-page today-page-loading"><RefreshCw size={18} className="today-spin" /><p>正在整理今天的事项…</p></section>;
  }

  if (error && !snapshot) {
    return <section className="today-page today-page-error"><p>{error}</p><button type="button" className="text-btn" onClick={() => void load()}>重新加载</button></section>;
  }

  const data = snapshot!;
  const timelineLinkLabel = data.timelineTotal > data.timeline.length
    ? `查看全部 ${data.timelineTotal} 项`
    : '打开日历';

  return (
    <section className="today-page" aria-label="今日">
      <header className="today-toolbar">
        <button type="button" className="today-refresh" onClick={() => void load()} disabled={loading} aria-label="刷新今日概览" title="刷新今日概览">
          <RefreshCw size={15} className={loading ? 'today-spin' : ''} />
          <span>刷新</span>
        </button>
      </header>

      {error && <p className="today-inline-error" role="status">{error}</p>}

      <div className="today-desk">
        <main className="today-primary-column">
          <section className="today-section today-focus-section" aria-labelledby="today-focus-title">
            <div className="today-section-head">
              <h2 id="today-focus-title">先做</h2>
              <button type="button" className="today-section-link" onClick={() => onNavigate('todos')}>全部待办 <ChevronRight size={14} /></button>
            </div>
            {data.focusItems.length ? <ol className="today-focus-list">
              {data.focusItems.map((item, index) => (
                <li key={item.id}>
                  <button type="button" className="today-focus-item" onClick={() => onNavigate('todos')}>
                    <span className="today-focus-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="today-focus-copy"><strong>{item.title}</strong><small>{item.reason}</small></span>
                    <span className={`today-priority ${item.priority}`}>{priorityLabel(item.priority)}</span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol> : <div className="today-inline-empty"><p>今天没有临期或高优先级待办。</p><button type="button" className="today-empty-action" onClick={() => onNavigate('todos')}>添加待办 <ChevronRight size={14} /></button></div>}
          </section>

          <section className="today-section today-timeline-section" aria-labelledby="today-timeline-title">
            <div className="today-section-head">
              <h2 id="today-timeline-title">今天的安排</h2>
              <button type="button" className="today-section-link" onClick={() => onNavigate('calendar')}>{timelineLinkLabel} <ChevronRight size={14} /></button>
            </div>
            {data.timeline.length ? <ol className="today-timeline">{data.timeline.map((item) => <li key={item.id}><time dateTime={item.at}>{item.time}</time><i className={item.type} aria-hidden="true" /><button type="button" onClick={() => onNavigate('calendar')}><strong>{item.title}</strong><small>{item.type === 'schedule' ? '日程安排' : `${priorityLabel(item.priority)}待办`}</small><ChevronRight size={14} aria-hidden="true" /></button></li>)}</ol> : <div className="today-inline-empty"><p>今天暂无时间安排。</p><button type="button" className="today-empty-action" onClick={() => onNavigate('calendar')}>安排今天 <ChevronRight size={14} /></button></div>}
          </section>
        </main>

        <aside className="today-secondary-column">
          <section className="today-section today-pending-section" aria-labelledby="today-pending-title">
            <div className="today-section-head"><h2 id="today-pending-title">Agent 提醒</h2><button type="button" className="today-section-link" onClick={() => onOpenAgent()}>打开 Agent <ChevronRight size={14} /></button></div>
            {data.pending.length
              ? <div className="today-pending-list">{data.pending.map((item) => <button key={item.id} type="button" className="today-pending-item" onClick={() => onOpenAgent(item.messageId || undefined)}><span><strong>{item.title}</strong><small>{item.summary}</small></span><ChevronRight size={14} aria-hidden="true" /></button>)}</div>
              : <button type="button" className="today-pending-item today-inline-empty" onClick={() => onOpenAgent()}><p>当前没有需要处理的提醒。</p></button>}
          </section>

          {data.activeGoals.length > 0 && <section className="today-section today-goals-section" aria-labelledby="today-goals-title">
            <div className="today-section-head"><h2 id="today-goals-title">进行中的目标</h2></div>
            <div className="today-goal-list">{data.activeGoals.map((goal) => <button key={goal.id} type="button" className="today-goal-item" onClick={() => onOpenAgent()}><span><strong>{goal.title}</strong><small>{goal.nextAction ? `下一步：${goal.nextAction}` : '还没有待跟进行动'}</small></span><em>{goal.progress}%</em><i aria-hidden="true"><b style={{ width: `${goal.progress}%` }} /></i></button>)}</div>
          </section>}

          <section className="today-section today-recent-section" aria-labelledby="today-recent-title">
            <div className="today-section-head"><h2 id="today-recent-title">最近收集</h2></div>
            {data.recentCaptures.length ? <div className="today-recent-list">{data.recentCaptures.map((item) => <button key={`${item.type}-${item.id}`} type="button" className="today-recent-item" onClick={() => onNavigate(item.type === 'note' ? 'notes' : 'profile')}><span className={`today-recent-icon ${item.type}`}>{item.type === 'note' ? <StickyNote size={15} /> : <FileText size={15} />}</span><span><strong>{item.title}</strong><small>{item.type === 'note' ? '备忘录' : '资料'} · {relativeUpdatedAt(item.updatedAt)}</small></span><ChevronRight size={14} aria-hidden="true" /></button>)}</div> : <div className="today-inline-empty"><p>还没有最近收集的笔记或资料。</p></div>}
          </section>
        </aside>
      </div>
    </section>
  );
}
