import { useEffect, useState } from 'react';
import {
  CalendarDays,
  CheckSquare,
  FileLock2,
  Inbox,
  Music2,
  Settings as SettingsIcon,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import Todos from './modules/Todos';
import Calendar from './modules/Calendar';
import Agent from './modules/Agent';
import Settings from './modules/Settings';
import Notes from './modules/Notes';
import Placeholder from './modules/Placeholder';

export type ModuleKey =
  | 'todos'
  | 'calendar'
  | 'notes'
  | 'mail'
  | 'agent'
  | 'music'
  | 'profile'
  | 'settings';

const NAV: { key: ModuleKey; label: string; icon: typeof CheckSquare }[] = [
  { key: 'todos', label: '待办', icon: CheckSquare },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'notes', label: '备忘录', icon: StickyNote },
  { key: 'mail', label: '邮箱', icon: Inbox },
  { key: 'agent', label: 'Agent', icon: Sparkles },
  { key: 'music', label: '音乐', icon: Music2 },
  { key: 'profile', label: '资料', icon: FileLock2 },
  { key: 'settings', label: '设置', icon: SettingsIcon },
];

const PLACEHOLDER: Record<ModuleKey, { title: string; hint: string }> = {
  todos: { title: '待办', hint: '' },
  calendar: { title: '日历', hint: '日程与待办到期视图将在后续迭代接入。' },
  notes: { title: '备忘录', hint: 'Markdown 备忘录将在后续迭代接入。' },
  mail: { title: '邮箱', hint: 'IMAP / SMTP 邮箱收发将在后续迭代接入。' },
  agent: { title: 'Agent', hint: '绑定个人资料与待办的助手将在后续迭代接入。' },
  music: { title: '音乐', hint: '网易云音乐播放将在后续迭代接入。' },
  profile: { title: '资料', hint: '资料分类与隐私分级将在后续迭代接入。' },
  settings: { title: '设置', hint: '邮箱、网易云、Agent 与同步配置将在后续迭代接入。' },
};

export default function App() {
  const [active, setActive] = useState<ModuleKey>('todos');
  const [appName, setAppName] = useState('个人工作台');
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());

  useEffect(() => {
    window.workbench
      .appInfo()
      .then((info) => setAppName(info.name))
      .catch(() => {});
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>{appName}</h1>
          <p>统一桌面工作台</p>
        </div>
        <nav className="nav">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`nav-item${active === key ? ' active' : ''}`}
              onClick={() => setActive(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">{today}</div>
      </aside>
      <main className="content">
        {active === 'todos' ? (
          <Todos />
        ) : active === 'calendar' ? (
          <Calendar />
        ) : active === 'notes' ? (
          <Notes />
        ) : active === 'agent' ? (
          <Agent onOpenSettings={() => setActive('settings')} />
        ) : active === 'settings' ? (
          <Settings />
        ) : (
          <Placeholder title={PLACEHOLDER[active].title} hint={PLACEHOLDER[active].hint} />
        )}
      </main>
    </div>
  );
}
