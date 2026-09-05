import { useEffect, useState, type CSSProperties, type FocusEvent } from 'react';
import {
  ArrowUpRight,
  BellRing,
  BookOpenCheck,
  CalendarDays,
  ChevronDown,
  CheckSquare,
  Download,
  FileLock2,
  Inbox,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  StickyNote,
  SunMedium,
  Trash2,
  X,
} from 'lucide-react';
import Todos from './modules/Todos';
import Calendar from './modules/Calendar';
import Agent from './modules/Agent';
import Music from './modules/Music';
import MailModule from './modules/Mail';
import Settings from './modules/Settings';
import Notes from './modules/Notes';
import Profile from './modules/Profile';
import Today from './modules/Today';
import WeeklyReview from './modules/WeeklyReview';
import QuickCapture from './components/QuickCapture';
import { isQuickCaptureShortcut } from './components/captureParser';
import type { AgentMusicCommand, AgentProactiveAlert, AppUpdateStatus, Category, ProfileItem } from './types';

export type ModuleKey =
  | 'today'
  | 'weekly'
  | 'todos'
  | 'calendar'
  | 'notes'
  | 'mail'
  | 'agent'
  | 'music'
  | 'profile';

export type SettingsKey = 'settings-profile' | 'settings-notifications' | 'settings-config';

const NAV: { key: ModuleKey; label: string; icon: typeof CheckSquare }[] = [
  { key: 'today', label: '今日', icon: SunMedium },
  { key: 'weekly', label: '周回顾', icon: BookOpenCheck },
  { key: 'todos', label: '待办', icon: CheckSquare },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'notes', label: '备忘录', icon: StickyNote },
  { key: 'mail', label: '邮箱', icon: Inbox },
  { key: 'agent', label: 'Agent', icon: Sparkles },
  { key: 'music', label: '音乐', icon: Music2 },
  { key: 'profile', label: '资料', icon: FileLock2 },
];

function isLibraryItem(item: ProfileItem) {
  return item.source === 'imported' || item.source === 'created';
}

function isUncategorized(item: ProfileItem, categories: Category[]) {
  return !item.categoryId || !categories.some((category) => category.id === item.categoryId);
}

function libraryItemsOnly(items: ProfileItem[]) {
  return items.filter(isLibraryItem);
}

function ProactiveAlertToast({
  alert,
  onOpen,
  onDismiss,
}: {
  alert: AgentProactiveAlert;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const isFollowUp = alert.phase === 'follow-up';
  const mailPriorityLabel = alert.priority === 'high'
    ? '高优先级邮件'
    : alert.priority === 'medium'
      ? '中优先级邮件'
      : alert.priority === 'low'
        ? '低优先级邮件'
        : '';
  const alertText = `${alert.title}${alert.summary}`;
  const isDeadlineAlert = /(?:即将到期|已超期)/.test(alertText);
  const isOverdue = /超期/.test(alertText);
  const taskTitle = isDeadlineAlert
    ? (alert.title.replace(/^任务(?:即将到期|已超期)[：:]\s*/, '') || alert.title)
    : alert.title;
  const timing = isDeadlineAlert ? alert.summary.replace(/^「.*?」\s*/, '').trim() : '';
  const recommendation = isOverdue
    ? '建议先处理，或重新安排截止时间。'
    : isDeadlineAlert
      ? '建议优先处理，避免超期。'
      : alert.summary;
  return (
    <aside className={`proactive-alert-toast ${alert.priority ? `is-mail-${alert.priority}` : (isOverdue ? 'is-overdue' : 'is-upcoming')}`} role="alert" aria-live="assertive" aria-labelledby="proactive-alert-title">
      <header className="proactive-alert-header">
        <span className="proactive-alert-status">
          <BellRing size={14} aria-hidden="true" />
          {mailPriorityLabel || (isOverdue ? '已超期' : (isDeadlineAlert ? '即将到期' : (isFollowUp ? '跟进提醒' : 'Agent 提醒')))}
        </span>
        <button type="button" className="proactive-alert-close" onClick={onDismiss} aria-label="关闭主动提醒" title="关闭主动提醒"><X size={16} /></button>
      </header>
      <div className="proactive-alert-copy">
        <h2 id="proactive-alert-title">
          <span>{taskTitle}</span>
          {timing && <em>{timing}</em>}
        </h2>
        <p>{recommendation}</p>
        <div className="proactive-alert-actions">
          <button type="button" className="proactive-alert-open" onClick={onOpen}>打开 Agent <ArrowUpRight size={14} /></button>
        </div>
      </div>
    </aside>
  );
}

function AppUpdateToast({
  status,
  busy,
  onDownload,
  onInstall,
  onOpenSettings,
  onDismiss,
}: {
  status: AppUpdateStatus;
  busy: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  const downloading = status.state === 'downloading';
  const readyToInstall = status.state === 'downloaded';
  return (
    <aside className="app-update-toast" role="status" aria-live="polite" aria-labelledby="app-update-toast-title">
      <div className="app-update-toast-topline">
        <span>{readyToInstall ? '更新已就绪' : downloading ? '正在更新' : '发现新版本'}</span>
        <button type="button" onClick={onDismiss} aria-label="暂时关闭更新提示" title="暂时关闭"><X size={15} /></button>
      </div>
      <div className="app-update-toast-copy">
        <h2 id="app-update-toast-title">{readyToInstall ? '新版本已下载完成' : downloading ? '正在下载 Loom 更新' : `Loom ${status.availableVersion || '新版本'} 可以更新`}</h2>
        <p>{readyToInstall ? '重启后会自动完成安装；本地数据不会被覆盖。' : downloading ? `已下载 ${status.downloadPercent ?? 0}%` : '下载由你确认发起，安装也会等你选择重启。'}</p>
        {downloading && <span className="app-update-toast-progress" aria-label={`下载进度 ${status.downloadPercent ?? 0}%`}><i style={{ width: `${status.downloadPercent ?? 0}%` }} /></span>}
        <div className="app-update-toast-actions">
          {readyToInstall
            ? <button type="button" className="app-update-toast-primary" onClick={onInstall} disabled={busy}>重启并更新</button>
            : downloading
              ? <button type="button" className="app-update-toast-secondary" onClick={onOpenSettings}>查看进度</button>
              : <button type="button" className="app-update-toast-primary" onClick={onDownload} disabled={busy}><Download size={14} />下载更新</button>}
          {!downloading && !readyToInstall && <button type="button" className="app-update-toast-secondary" onClick={onOpenSettings}>查看详情</button>}
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [active, setActive] = useState<ModuleKey | SettingsKey>('today');
  const [clockNow, setClockNow] = useState(() => new Date());
  const [musicCommand, setMusicCommand] = useState<AgentMusicCommand | null>(null);
  const [agentOpenMessageId, setAgentOpenMessageId] = useState('');
  const [proactiveAlert, setProactiveAlert] = useState<AgentProactiveAlert | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateStatus | null>(null);
  const [updateActionBusy, setUpdateActionBusy] = useState(false);
  const [updateToastDismissed, setUpdateToastDismissed] = useState(false);
  const [unreadProactiveCount, setUnreadProactiveCount] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(272);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [libraryItems, setLibraryItems] = useState<ProfileItem[]>([]);
  const [libraryCategories, setLibraryCategories] = useState<Category[]>([]);
  const [libraryFilter, setLibraryFilter] = useState('all');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<Category | null>(null);
  const [categoryDeleteDestination, setCategoryDeleteDestination] = useState('');
  const [deletingCategory, setDeletingCategory] = useState(false);
  const [categoryDeleteError, setCategoryDeleteError] = useState('');
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [appName, setAppName] = useState('Loom');
  const [avatarDataUrl, setAvatarDataUrl] = useState('');
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(clockNow);
  const currentTime = `${String(clockNow.getHours()).padStart(2, '0')}:${String(clockNow.getMinutes()).padStart(2, '0')}`;

  useEffect(() => {
    let timerId: number;
    const refreshClock = () => {
      setClockNow(new Date());
      timerId = window.setTimeout(refreshClock, 60_000 - (Date.now() % 60_000));
    };

    refreshClock();
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    window.workbench
      .appInfo()
      .then((info) => setAppName(info.name))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let disposed = false;
    void window.workbench.updates.status()
      .then((status) => {
        if (!disposed) setAppUpdate(status);
      })
      .catch(() => {});
    const stop = window.workbench.updates.onStatus((status) => {
      if (!disposed) setAppUpdate(status);
    });
    return () => {
      disposed = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (appUpdate?.state === 'available' || appUpdate?.state === 'downloaded') setUpdateToastDismissed(false);
  }, [appUpdate?.availableVersion, appUpdate?.state]);

  useEffect(() => {
    let disposed = false;
    void window.workbench.data.getSettings()
      .then((settings) => {
        if (!disposed) setAvatarDataUrl(settings.profile.avatarDataUrl || '');
      })
      .catch(() => {});
    const handleAvatarUpdated = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      setAvatarDataUrl(typeof next === 'string' ? next : '');
    };
    window.addEventListener('workbench:profile-avatar', handleAvatarUpdated);
    return () => {
      disposed = true;
      window.removeEventListener('workbench:profile-avatar', handleAvatarUpdated);
    };
  }, []);

  useEffect(() => {
    return window.workbench.agent.onOpenAgent((messageId) => {
      setProfileOpen(false);
      setSettingsOpen(false);
      setProactiveAlert(null);
      setAgentOpenMessageId(messageId || '');
      setActive('agent');
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshUnreadCount = () => {
      void window.workbench.agent.getMessages()
        .then((messages) => {
          if (!disposed) setUnreadProactiveCount(messages.filter((message) => !message.readAt).length);
        })
        .catch(() => {
          if (!disposed) setUnreadProactiveCount(0);
        });
    };
    refreshUnreadCount();
    const stopUpdated = window.workbench.agent.onProactiveUpdated(refreshUnreadCount);
    const stopAlert = window.workbench.agent.onProactiveAlert((alert) => {
      setProactiveAlert(alert);
      refreshUnreadCount();
    });
    return () => {
      disposed = true;
      stopUpdated();
      stopAlert();
    };
  }, []);

  useEffect(() => {
    return window.workbench.agent.onMusicCommand((command) => {
      setProfileOpen(false);
      setSettingsOpen(false);
      setMusicCommand(command);
      if (command.type === 'play') setActive('music');
    });
  }, []);

  useEffect(() => {
    if (!profileOpen && active !== 'profile') return;
    Promise.all([window.workbench.data.getModule('profileItems'), window.workbench.data.getModule('categories')])
      .then(([items, categories]) => {
        setLibraryItems(libraryItemsOnly(items));
        setLibraryCategories(categories);
      })
      .catch(() => {});
  }, [active, profileOpen]);

  useEffect(() => {
    const handleProfileItems = (event: Event) => {
      const detail = (event as CustomEvent<ProfileItem[]>).detail;
      window.workbench.data.getModule('profileItems')
        .then((items) => setLibraryItems(libraryItemsOnly(items)))
        .catch(() => {
          if (Array.isArray(detail)) setLibraryItems(libraryItemsOnly(detail));
        });
    };
    window.addEventListener('workbench:profile-items', handleProfileItems);
    return () => window.removeEventListener('workbench:profile-items', handleProfileItems);
  }, []);

  function selectLibraryFilter(filter: string) {
    setLibraryFilter(filter);
    setSettingsOpen(false);
    setProfileOpen(true);
    setActive('profile');
    window.dispatchEvent(new CustomEvent('workbench:profile-category', { detail: filter }));
  }

  function openProactiveAlert() {
    if (!proactiveAlert) return;
    setProfileOpen(false);
    setSettingsOpen(false);
    setAgentOpenMessageId(proactiveAlert.messageId);
    setActive('agent');
    setProactiveAlert(null);
  }

  function openUpdateSettings() {
    setProfileOpen(false);
    setSettingsOpen(true);
    setActive('settings-config');
  }

  async function runAppUpdateAction(action: 'download' | 'install') {
    setUpdateActionBusy(true);
    try {
      const next = action === 'download'
        ? await window.workbench.updates.download()
        : await window.workbench.updates.install();
      setAppUpdate(next);
    } finally {
      setUpdateActionBusy(false);
    }
  }

  async function saveLibraryCategory() {
    const trimmed = categoryDraft.trim();
    if (!trimmed || libraryCategories.some((category) => category.name === trimmed)) return;
    const next = await window.workbench.data.setModule('categories', [...libraryCategories, { id: crypto.randomUUID(), name: trimmed }]);
    setLibraryCategories(next);
    setCategoryDraft('');
    setCreatingCategory(false);
    window.dispatchEvent(new CustomEvent('workbench:profile-categories', { detail: next }));
  }

  function cancelLibraryCategory() {
    setCategoryDraft('');
    setCreatingCategory(false);
  }

  function handleCategoryDraftBlur(event: FocusEvent<HTMLInputElement>) {
    if (event.currentTarget.form?.contains(event.relatedTarget as Node)) return;
    if (categoryDraft.trim()) void saveLibraryCategory();
    else cancelLibraryCategory();
  }

  function openLibraryCategoryDelete(category: Category) {
    setCategoryDeleteError('');
    setCategoryDeleteDestination('');
    setCategoryDeleteTarget(category);
  }

  async function removeLibraryCategory(deleteItems: boolean, destinationId = categoryDeleteDestination) {
    const category = categoryDeleteTarget;
    if (!category || deletingCategory) return;
    const affectedItems = libraryItems.filter((item) => item.categoryId === category.id);
    setDeletingCategory(true);
    setCategoryDeleteError('');
    try {
      let nextItems = libraryItems;
      for (const item of affectedItems) {
        if (deleteItems) {
          nextItems = libraryItemsOnly(await window.workbench.library.removeItem(item.id));
        } else {
          nextItems = libraryItemsOnly((await window.workbench.library.updateItem(item.id, { categoryId: destinationId })).items);
        }
      }
      const nextCategories = await window.workbench.data.setModule('categories', libraryCategories.filter((item) => item.id !== category.id));
      setLibraryItems(nextItems);
      setLibraryCategories(nextCategories);
      window.dispatchEvent(new CustomEvent('workbench:profile-items', { detail: nextItems }));
      window.dispatchEvent(new CustomEvent('workbench:profile-categories', { detail: nextCategories }));
      if (libraryFilter === category.id) selectLibraryFilter('all');
      setCategoryDeleteTarget(null);
    } catch {
      setCategoryDeleteError('分类处理失败，请稍后重试。');
    } finally {
      setDeletingCategory(false);
    }
  }

  useEffect(() => {
    if (!resizingSidebar) return;
    const handleMove = (event: PointerEvent) => {
      setSidebarWidth(Math.min(280, Math.max(176, event.clientX)));
    };
    const stopResizing = () => setResizingSidebar(false);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [resizingSidebar]);

  useEffect(() => {
    const openQuickCapture = (event: KeyboardEvent) => {
      if (!isQuickCaptureShortcut(event)) return;
      event.preventDefault();
      setQuickCaptureOpen(true);
    };
    document.addEventListener('keydown', openQuickCapture);
    return () => document.removeEventListener('keydown', openQuickCapture);
  }, []);

  const shellStyle = {
    '--sidebar-width': sidebarCollapsed ? '64px' : `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div className="app-shell" style={shellStyle}>
      <aside className={`sidebar${sidebarCollapsed ? ' compact' : ''}`}>
        <div className="brand">
          <div className="brand-avatar" aria-hidden="true">{avatarDataUrl && <img src={avatarDataUrl} alt="" />}</div>
          <div className="brand-copy">
            <h1>{appName}</h1>
          </div>
          <button
            type="button"
            className="sidebar-collapse"
            aria-label={sidebarCollapsed ? '展开全局导航' : '收起全局导航'}
            title={sidebarCollapsed ? '展开全局导航' : '收起全局导航'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav className="nav">
          {NAV.map(({ key, label, icon: Icon }) => key === 'profile' ? (
            <div key={key} className={`nav-group${active === key ? ' has-active' : ''}`}>
              <button
                type="button"
                className="nav-item nav-parent"
                aria-expanded={profileOpen}
                onClick={() => {
                  setSettingsOpen(false);
                  setProfileOpen((open) => !open);
                }}
              >
                <Icon size={17} />
                <span>{label}</span>
                <ChevronDown className="nav-caret" size={15} />
              </button>
              {profileOpen && (
                <div className="nav-submenu sidebar-library-subnav">
                  <button type="button" className={active === 'profile' && libraryFilter === 'all' ? 'active' : ''} onClick={() => selectLibraryFilter('all')}><span>全部资料</span><em>{libraryItems.length}</em></button>
                  {libraryItems.some((item) => isUncategorized(item, libraryCategories)) && <button type="button" className={active === 'profile' && libraryFilter === 'uncategorized' ? 'active' : ''} onClick={() => selectLibraryFilter('uncategorized')}><span>未分类</span><em>{libraryItems.filter((item) => isUncategorized(item, libraryCategories)).length}</em></button>}
                  {libraryCategories.map((category) => (
                    <div key={category.id} className="sidebar-library-category-row" onContextMenu={(event) => { event.preventDefault(); openLibraryCategoryDelete(category); }}>
                      <button type="button" className={`sidebar-library-category-select${active === 'profile' && libraryFilter === category.id ? ' active' : ''}`} onClick={() => selectLibraryFilter(category.id)}><span>{category.name}</span><em>{libraryItems.filter((item) => item.categoryId === category.id).length}</em></button>
                      <button type="button" className="sidebar-library-category-delete" aria-label={`删除分类：${category.name}`} title={`删除分类：${category.name}`} onClick={(event) => { event.stopPropagation(); openLibraryCategoryDelete(category); }}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  {creatingCategory ? (
                    <form className="sidebar-library-category-form" onSubmit={(event) => { event.preventDefault(); void saveLibraryCategory(); }}>
                      <input autoFocus value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} onBlur={handleCategoryDraftBlur} onKeyDown={(event) => { if (event.key === 'Escape') cancelLibraryCategory(); }} placeholder="分类名称" aria-label="分类名称" />
                      <button type="button" onClick={cancelLibraryCategory}>取消</button>
                    </form>
                  ) : (
                    <button type="button" className="sidebar-library-new-category" onClick={() => { setCategoryDraft(''); setCreatingCategory(true); }}><Plus size={13} /><span>新建分类</span></button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div key={key} className="nav-entry">
              <button
                type="button"
                className={`nav-item${active === key ? ' active' : ''}`}
                onClick={() => {
                  setProfileOpen(false);
                  setSettingsOpen(false);
                  setActive(key);
                }}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  {key === 'agent' && unreadProactiveCount > 0 && (
                    <i className="nav-agent-unread-badge" aria-label={`${unreadProactiveCount} 条未读 Agent 提醒`} title={`${unreadProactiveCount} 条未读 Agent 提醒`}>
                      {unreadProactiveCount > 9 ? '9+' : unreadProactiveCount}
                    </i>
                  )}
                </button>
            </div>
          ))}
          <div className={`nav-group${active.startsWith('settings-') ? ' has-active' : ''}`}>
            <button
              type="button"
              className="nav-item nav-parent"
              aria-expanded={settingsOpen}
              onClick={() => {
                setProfileOpen(false);
                setSettingsOpen((open) => !open);
              }}
            >
              <SettingsIcon size={17} />
              <span>设置</span>
              <ChevronDown className="nav-caret" size={15} />
            </button>
            {settingsOpen && (
              <div className="nav-submenu">
                {[
                  { key: 'settings-profile', label: '个人资料' },
                  { key: 'settings-notifications', label: '通知' },
                  { key: 'settings-config', label: '配置' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`nav-subitem${active === key ? ' active' : ''}`}
                    onClick={() => {
                      setProfileOpen(false);
                      setActive(key as SettingsKey);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
        <button type="button" className="sidebar-capture" onClick={() => setQuickCaptureOpen(true)} aria-label="快速收集，快捷键 Command 加 K" title="快速收集（⌘ K）">
          <Plus size={16} aria-hidden="true" />
          <span>快速收集</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="sidebar-foot" aria-label={`当前时间 ${currentTime}，${today}`}>
          <time className="sidebar-clock" dateTime={currentTime}>{currentTime}</time>
          <span className="sidebar-date">{today}</span>
        </div>
      </aside>
      <div
        className={`pane-resizer${resizingSidebar ? ' is-dragging' : ''}`}
        role="separator"
        aria-label="调整全局导航宽度"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          if (sidebarCollapsed) return;
          event.preventDefault();
          setResizingSidebar(true);
        }}
      />
      <main className={`content${active === 'agent' ? ' content-agent' : ''}${active === 'mail' ? ' content-mail' : ''}`}>
        {active === 'today' ? (
          <Today
            onNavigate={(target) => {
              setProfileOpen(target === 'profile');
              setSettingsOpen(false);
              setActive(target);
            }}
            onOpenAgent={(messageId) => {
              setProfileOpen(false);
              setSettingsOpen(false);
              setAgentOpenMessageId(messageId || '');
              setActive('agent');
            }}
          />
        ) : active === 'weekly' ? (
          <WeeklyReview
            onNavigate={(target) => {
              setProfileOpen(target === 'profile');
              setSettingsOpen(false);
              setActive(target);
            }}
          />
        ) : active === 'todos' ? (
          <Todos />
        ) : active === 'calendar' ? (
          <Calendar />
        ) : active === 'notes' ? (
          <Notes />
        ) : active === 'mail' ? (
          <MailModule />
        ) : active === 'profile' ? (
          <Profile initialCategoryFilter={libraryFilter} />
        ) : active === 'agent' ? (
          <Agent
            onOpenSettings={() => { setSettingsOpen(true); setActive('settings-config'); }}
            openProactiveMessageId={agentOpenMessageId}
            onProactiveMessageOpened={() => setAgentOpenMessageId('')}
          />
        ) : active === 'music' ? (
          <Music
            agentCommand={musicCommand}
            onAgentCommandHandled={() => setMusicCommand(null)}
            onOpenSettings={() => { setSettingsOpen(true); setActive('settings-config'); }}
          />
        ) : active === 'settings-profile' || active === 'settings-notifications' || active === 'settings-config' ? (
          <Settings section={active} />
        ) : (
          null
        )}
      </main>
      <QuickCapture
        open={quickCaptureOpen}
        onClose={() => setQuickCaptureOpen(false)}
        onNavigate={(target) => {
          setProfileOpen(false);
          setSettingsOpen(false);
          setActive(target);
        }}
      />
      {proactiveAlert && (
        <ProactiveAlertToast
          alert={proactiveAlert}
          onOpen={openProactiveAlert}
          onDismiss={() => setProactiveAlert(null)}
        />
      )}
      {appUpdate && !updateToastDismissed && ['available', 'downloading', 'downloaded'].includes(appUpdate.state) && (
        <AppUpdateToast
          status={appUpdate}
          busy={updateActionBusy}
          onDownload={() => void runAppUpdateAction('download')}
          onInstall={() => void runAppUpdateAction('install')}
          onOpenSettings={openUpdateSettings}
          onDismiss={() => setUpdateToastDismissed(true)}
        />
      )}
      {categoryDeleteTarget && (() => {
        const itemCount = libraryItems.filter((item) => item.categoryId === categoryDeleteTarget.id).length;
        return (
          <div className="category-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !deletingCategory) setCategoryDeleteTarget(null); }}>
            <section className="category-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="category-delete-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="category-delete-dialog-head">
                <div>
                  <h2 id="category-delete-title">删除分类“{categoryDeleteTarget.name}”</h2>
                  <p>{itemCount ? `此分类下有 ${itemCount} 份资料，请选择资料的处理方式。` : '此分类下暂无资料。'}</p>
                </div>
                <button type="button" className="category-delete-close" onClick={() => setCategoryDeleteTarget(null)} disabled={deletingCategory}>取消</button>
              </div>
              {categoryDeleteError && <p className="category-delete-error">{categoryDeleteError}</p>}
              <div className="category-delete-actions">
                <button type="button" className="category-delete-option danger" onClick={() => void removeLibraryCategory(true)} disabled={deletingCategory}>
                  <Trash2 size={16} />
                  <span><strong>{itemCount ? '删除分类及资料' : '删除分类'}</strong><small>{itemCount ? '分类下的资料和导入副本都会删除' : '移除这个空分类'}</small></span>
                </button>
                {itemCount > 0 && <div className="category-delete-option category-delete-migrate-option">
                  <span><strong>只删除分类</strong><small>资料保留，并迁移到指定分类</small></span>
                  <select value={categoryDeleteDestination} onChange={(event) => setCategoryDeleteDestination(event.target.value)} aria-label="资料迁移目标分类" disabled={deletingCategory}>
                    <option value="">未分类</option>
                    {libraryCategories.filter((category) => category.id !== categoryDeleteTarget.id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  <button type="button" className="category-delete-migrate-confirm" onClick={() => void removeLibraryCategory(false)} disabled={deletingCategory}>确认迁移</button>
                </div>}
              </div>
            </section>
          </div>
        );
      })()}
    </div>
  );
}
