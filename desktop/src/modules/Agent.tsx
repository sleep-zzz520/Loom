import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, Clock3, Database, FileText, History, ListPlus, ListTodo, MessageSquare, MoreHorizontal, NotebookPen, Pencil, Plus, RefreshCw, Settings2, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import AgentMessageContent from '../components/AgentMessageContent';
import { DEFAULT_CONVERSATION_TITLE, conversationTitleFromMessages, isPlaceholderConversationTitle } from '../components/agentConversationTitle';
import type { AgentConversation, AgentConversationStore, AgentProposal, AgentRun, AgentRunStatus, AgentSuggestion, AgentSuggestionStatus, AgentTrigger, ChatAttachment, ChatMessage, ProfileItem } from '../types';

const SUGGESTIONS = [
  '今天有什么要做？',
  '整理一下本周的待办',
  '我妈妈生日是 5 月 20 日',
  '帮我看看资料库里有什么',
];

const priorityLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const runTriggerLabel: Record<AgentTrigger, string> = {
  'daily-briefing': '每日简报',
  'event-follow-up': '事件跟进',
};
const runStatusLabel: Record<AgentRunStatus, string> = {
  running: '检查中',
  completed: '已完成',
  failed: '失败',
};

function formatRunTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function suggestionStatusLabel(status: AgentSuggestionStatus) {
  if (status === 'acted') return '已安排';
  if (status === 'dismissed') return '已忽略';
  if (status === 'read') return '已了解';
  return '未读';
}

function createConversation(): AgentConversation {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() || `conversation-${Date.now()}`,
    title: DEFAULT_CONVERSATION_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createConversationStore(): AgentConversationStore {
  const conversation = createConversation();
  return { activeId: conversation.id, conversations: [conversation] };
}

function normaliseConversationStore(value: AgentConversationStore | ChatMessage[]): AgentConversationStore {
  if (Array.isArray(value)) {
    const conversation = createConversation();
    return {
      activeId: conversation.id,
      conversations: [{ ...conversation, title: value.length ? conversationTitleFromMessages(value) : DEFAULT_CONVERSATION_TITLE, messages: value }],
    };
  }
  if (value?.conversations?.length) {
    const conversations = value.conversations.map((conversation) => {
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      const title = isPlaceholderConversationTitle(conversation.title) && messages.length
        ? conversationTitleFromMessages(messages)
        : String(conversation.title || DEFAULT_CONVERSATION_TITLE).trim() || DEFAULT_CONVERSATION_TITLE;
      return { ...conversation, messages, title };
    });
    const activeId = conversations.some((conversation) => conversation.id === value.activeId)
      ? value.activeId
      : conversations[0].id;
    return { ...value, activeId, conversations };
  }
  return createConversationStore();
}

export default function Agent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [conversationStore, setConversationStore] = useState<AgentConversationStore>(createConversationStore);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [referenceDocs, setReferenceDocs] = useState<ProfileItem[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [modelName, setModelName] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [proactiveSuggestions, setProactiveSuggestions] = useState<AgentSuggestion[]>([]);
  const [suggestionHistory, setSuggestionHistory] = useState<AgentSuggestion[]>([]);
  const [proactiveBusy, setProactiveBusy] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [runsOpen, setRunsOpen] = useState(false);
  const [suggestionHistoryOpen, setSuggestionHistoryOpen] = useState(false);
  const [suggestionMenuOpen, setSuggestionMenuOpen] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const activeConversation = conversationStore.conversations.find((conversation) => conversation.id === conversationStore.activeId)
    || conversationStore.conversations[0];
  const messages = activeConversation?.messages || [];
  const activeModel = modelName;
  const proactiveKicker = proactiveSuggestions.some((suggestion) => suggestion.trigger === 'event-follow-up')
    ? '主动跟进'
    : '今日主动发现';

  useEffect(() => {
    window.workbench.agent.status().then(setConfigured).catch(() => setConfigured(false));
    window.workbench.data.getSettings().then((settings) => setModelName(settings.agent.model || '')).catch(() => {});
    window.workbench.data.getModule('agent').then((saved) => {
      const normalised = normaliseConversationStore(saved);
      setConversationStore(normalised);
      const savedConversations = Array.isArray(saved) ? [] : saved.conversations;
      const needsPersist = Array.isArray(saved)
        || saved.activeId !== normalised.activeId
        || normalised.conversations.some((conversation) => savedConversations.find((item) => item.id === conversation.id)?.title !== conversation.title);
      if (needsPersist) window.workbench.data.setModule('agent', normalised).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!composerMenuOpen && !scopeMenuOpen && !modelMenuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-agent-composer-toggle], [data-agent-composer-popup]')) return;
      setComposerMenuOpen(false);
      setScopeMenuOpen(false);
      setModelMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setComposerMenuOpen(false);
      setScopeMenuOpen(false);
      setModelMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [composerMenuOpen, scopeMenuOpen, modelMenuOpen]);

  useEffect(() => {
    const stopListening = window.workbench.agent.onProactiveUpdated(() => {
      void loadProactiveSuggestions();
      void loadSuggestionHistory();
      void loadAgentRuns();
    });
    void loadProactiveSuggestions();
    void loadSuggestionHistory();
    void loadAgentRuns();
    void window.workbench.agent.checkProactive()
      .then((suggestions) => {
        setProactiveSuggestions(suggestions);
        void loadSuggestionHistory();
        void loadAgentRuns();
      })
      .catch(() => {});
    return stopListening;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowScrollToBottom(false);
  }, [messages, streaming, busy, proposal]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateScrollState = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 32);
    };
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    return () => el.removeEventListener('scroll', updateScrollState);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const maxHeight = Math.max(148, Math.floor(window.innerHeight / 3));
    input.style.height = 'auto';
    input.style.maxHeight = `${maxHeight}px`;
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
  }, [draft]);

  function saveConversationStore(next: AgentConversationStore) {
    setConversationStore(next);
    window.workbench.data.setModule('agent', next).catch(() => {});
  }

  function cancelRename() {
    setEditingConversationId(null);
    setRenameDraft('');
  }

  function startRename(conversation: AgentConversation) {
    if (busy || confirming) return;
    setEditingConversationId(conversation.id);
    setRenameDraft(conversation.title);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }

  function saveConversationRename(id: string) {
    const conversation = conversationStore.conversations.find((item) => item.id === id);
    if (!conversation) return cancelRename();
    const inputTitle = renameDraft.replace(/\s+/g, ' ').trim();
    const title = inputTitle || (conversation.messages.length ? conversationTitleFromMessages(conversation.messages) : DEFAULT_CONVERSATION_TITLE);
    saveConversationStore({
      ...conversationStore,
      conversations: conversationStore.conversations.map((item) => (
        item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item
      )),
    });
    cancelRename();
  }

  function toggleSessionMenu() {
    if (sessionMenuOpen) cancelRename();
    setSessionMenuOpen((open) => !open);
    setRunsOpen(false);
  }

  function saveMessages(nextMessages: ChatMessage[], title = activeConversation?.title) {
    if (!activeConversation) return;
    const next = {
      ...conversationStore,
      conversations: conversationStore.conversations.map((conversation) => (
        conversation.id === activeConversation.id
          ? { ...conversation, messages: nextMessages, title: title || conversation.title, updatedAt: new Date().toISOString() }
          : conversation
      )),
    };
    saveConversationStore(next);
  }

  async function loadProactiveSuggestions() {
    try {
      setProactiveSuggestions(await window.workbench.agent.getSuggestions());
    } catch {
      setProactiveSuggestions([]);
    }
  }

  async function loadSuggestionHistory() {
    try {
      setSuggestionHistory(await window.workbench.agent.getSuggestionHistory());
    } catch {
      setSuggestionHistory([]);
    }
  }

  async function loadAgentRuns() {
    try {
      const runs = await window.workbench.data.getModule('agentRuns');
      setAgentRuns(runs.slice(0, 8));
    } catch {
      setAgentRuns([]);
    }
  }

  async function refreshProactive() {
    if (proactiveBusy) return;
    setProactiveBusy(true);
    try {
      setProactiveSuggestions(await window.workbench.agent.checkProactive(true));
      await loadSuggestionHistory();
    } catch {
      await loadProactiveSuggestions();
      await loadSuggestionHistory();
    } finally {
      setProactiveBusy(false);
    }
  }

  async function updateSuggestion(id: string, patch: { status: AgentSuggestionStatus; followUpAt?: string | null }) {
    try {
      setProactiveSuggestions(await window.workbench.agent.updateSuggestion(id, patch));
      await loadSuggestionHistory();
      setSuggestionMenuOpen(null);
    } catch {
      // 主动建议不是主流程，状态更新失败时保留当前页面内容。
    }
  }

  function tomorrowMorning() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }

  async function openSuggestionProposal(suggestion: AgentSuggestion) {
    if (!suggestion.proposal || busy || confirming) return;
    setProposal(suggestion.proposal);
    setPendingSuggestionId(suggestion.id);
    if (suggestion.status === 'unread') await updateSuggestion(suggestion.id, { status: 'read' });
  }

  function startConversation() {
    if (busy || confirming) return;
    cancelRename();
    const conversation = createConversation();
    saveConversationStore({
      activeId: conversation.id,
      conversations: [conversation, ...conversationStore.conversations],
    });
    setDraft('');
    setStreaming('');
    setProposal(null);
    setPendingSuggestionId(null);
    setError('');
    setSessionMenuOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectConversation(id: string) {
    if (busy || confirming || id === conversationStore.activeId) return;
    cancelRename();
    saveConversationStore({ ...conversationStore, activeId: id });
    setDraft('');
    setStreaming('');
    setProposal(null);
    setPendingSuggestionId(null);
    setError('');
    setSessionMenuOpen(false);
  }

  function removeConversation(id: string) {
    if (busy || confirming) return;
    if (editingConversationId === id) cancelRename();
    const remaining = conversationStore.conversations.filter((conversation) => conversation.id !== id);
    if (remaining.length === 0) {
      const conversation = createConversation();
      saveConversationStore({ activeId: conversation.id, conversations: [conversation] });
    } else {
      saveConversationStore({
        activeId: id === conversationStore.activeId ? remaining[0].id : conversationStore.activeId,
        conversations: remaining,
      });
    }
    setDraft('');
    setProposal(null);
    setPendingSuggestionId(null);
    setError('');
  }

  function toggleComposerMenu() {
    setComposerMenuOpen((open) => !open);
    setScopeMenuOpen(false);
    setModelMenuOpen(false);
    window.workbench.data.getModule('profileItems')
      .then((items) => setReferenceDocs(items.filter((item) => item.source === 'created' && item.content.trim()).slice(0, 6)))
      .catch(() => setReferenceDocs([]));
  }

  function prepareDraft(prefix: string) {
    setDraft((current) => current.trim() ? `${current}\n${prefix}` : prefix);
    setComposerMenuOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function attachDocument(item: ProfileItem) {
    const attachment = { id: item.id, name: item.name, content: item.content.trim() };
    setAttachments((current) => current.some((entry) => entry.id === item.id) ? current : [...current, attachment]);
    setComposerMenuOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function toggleModelMenu() {
    setModelMenuOpen((open) => !open);
    setComposerMenuOpen(false);
    setScopeMenuOpen(false);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollToBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  async function submit(text: string) {
    const content = text.trim();
    if (!content || busy || confirming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content, attachments: attachments.length ? attachments : undefined }];
    const title = isPlaceholderConversationTitle(activeConversation?.title)
      ? conversationTitleFromMessages(next)
      : activeConversation?.title;
    saveMessages(next, title);
    setDraft('');
    setAttachments([]);
    setProposal(null);
    setPendingSuggestionId(null);
    setStreaming('');
    setBusy(true);
    setError('');
    try {
      const reply = await window.workbench.agent.chat(next, (delta) => {
        setStreaming((current) => current + delta);
      });
      saveMessages([...next, { role: 'assistant', content: reply.content }]);
      setProposal(reply.proposal || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试');
    } finally {
      setStreaming('');
      setBusy(false);
    }
  }

  async function confirmProposal() {
    if (!proposal || confirming) return;
    setConfirming(true);
    setError('');
    try {
      const result = await window.workbench.agent.confirmProposal(proposal);
      saveMessages([...messages, { role: 'assistant', content: result.content }]);
      if (pendingSuggestionId) await updateSuggestion(pendingSuggestionId, { status: 'acted' });
      setProposal(null);
      setPendingSuggestionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setConfirming(false);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    void submit(draft);
  }

  return (
    <section className="module-page agent-page">
      <div className="agent-panel">
        <div className="agent-chat-area">
          <div className="session-menu-shell">
            <button type="button" className="session-menu-trigger" onClick={toggleSessionMenu} aria-expanded={sessionMenuOpen} aria-controls="agent-session-menu">
              <MessageSquare size={15} />
              <span>会话 · {activeConversation?.title || '新对话'}</span>
            </button>
            {sessionMenuOpen && (
              <aside id="agent-session-menu" className="agent-session-menu" aria-label="Agent 会话">
                <button type="button" className="session-new" onClick={startConversation} disabled={busy || confirming}><Plus size={16} /> 新建对话</button>
                <nav className="session-list" aria-label="会话列表">
                  <p>会话</p>
                  {conversationStore.conversations.map((conversation) => (
                    <div key={conversation.id} className={`session-item${conversation.id === activeConversation?.id ? ' active' : ''}`}>
                      {editingConversationId === conversation.id ? (
                        <form className="session-rename-form" onSubmit={(event) => { event.preventDefault(); saveConversationRename(conversation.id); }}>
                          <input
                            ref={renameInputRef}
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            aria-label="会话名称"
                            placeholder="输入会话名称"
                            maxLength={60}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelRename();
                              }
                            }}
                          />
                          <button type="submit" className="session-rename-save" aria-label="保存会话名称" title="保存"><Check size={14} /></button>
                          <button type="button" className="session-rename-cancel" onClick={cancelRename} aria-label="取消重命名" title="取消"><X size={14} /></button>
                        </form>
                      ) : (
                        <>
                          <button type="button" className="session-select" onClick={() => selectConversation(conversation.id)} disabled={busy || confirming} title={conversation.title}>
                            <MessageSquare size={15} />
                            <span>{conversation.title}</span>
                          </button>
                          <div className="session-item-actions">
                            <button type="button" className="session-rename" onClick={() => startRename(conversation)} disabled={busy || confirming} aria-label={`重命名会话：${conversation.title}`} title="重命名"><Pencil size={13} /></button>
                            <button type="button" className="session-remove" onClick={() => removeConversation(conversation.id)} disabled={busy || confirming} aria-label={`删除会话：${conversation.title}`} title="删除会话"><Trash2 size={14} /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </nav>
                <div className="session-connection">
                  <span className="agent-status"><span className={configured ? 'status-dot on' : 'status-dot'} />{configured ? '已连接' : '未配置'}</span>
                  {!configured && <button type="button" className="text-btn" onClick={onOpenSettings}><Settings2 size={15} /> 配置</button>}
                </div>
                {agentRuns.length > 0 && (
                  <div className={`session-run-history${runsOpen ? ' is-open' : ''}`}>
                    <button type="button" className="session-run-trigger" onClick={() => setRunsOpen((open) => !open)} aria-expanded={runsOpen} aria-controls="agent-session-runs">
                      <span><History size={14} />最近主动运行 <small>{agentRuns.length} 条</small></span>
                      <ChevronDown size={14} />
                    </button>
                    {runsOpen && (
                      <div id="agent-session-runs" className="session-run-list">
                        {agentRuns.map((run) => {
                          const suggestion = run.suggestionId
                            ? proactiveSuggestions.find((item) => item.id === run.suggestionId)
                            : null;
                          const summary = run.status === 'failed'
                            ? run.error || '主动检查失败'
                            : suggestion
                              ? `生成建议：${suggestion.title}`
                              : run.suggestionId
                                ? '已生成一条主动建议（当前已从列表隐藏）'
                                : run.status === 'running'
                                  ? '正在读取工作台上下文'
                                  : '检查完成，没有生成新的提醒';
                          return (
                            <article key={run.id} className="session-run-entry">
                              <span className={`agent-run-status-dot${run.status === 'running' ? ' is-running' : ''}${run.status === 'failed' ? ' is-failed' : ''}`} aria-hidden="true" />
                              <div className="agent-run-copy">
                                <strong>{runTriggerLabel[run.trigger]} · {runStatusLabel[run.status]}</strong>
                                <small title={summary}>{summary}</small>
                              </div>
                              <time className="agent-run-meta" dateTime={run.startedAt}>{formatRunTime(run.startedAt)}</time>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </aside>
            )}
          </div>
          {proactiveSuggestions.length > 0 && (
            <section className="agent-proactive" aria-labelledby="agent-proactive-title">
              <div className="agent-proactive-head">
                <div>
                  <span className="agent-proactive-kicker"><Sparkles size={14} />{proactiveKicker}</span>
                  <p id="agent-proactive-title">有一些事情值得你现在关注</p>
                </div>
                <button type="button" className="agent-proactive-refresh" onClick={() => void refreshProactive()} disabled={proactiveBusy}>
                  <RefreshCw size={14} className={proactiveBusy ? 'is-spinning' : ''} />
                  {proactiveBusy ? '检查中' : '重新检查'}
                </button>
              </div>
              <div className="agent-proactive-list">
                {proactiveSuggestions.map((suggestion) => (
                  <article key={suggestion.id} className={`agent-suggestion${suggestion.status === 'unread' ? ' is-unread' : ''}${suggestion.status === 'acted' ? ' is-acted' : ''}`}>
                    <div className="agent-suggestion-icon"><Sparkles size={16} /></div>
                    <div className="agent-suggestion-main">
                      <h3>{suggestion.title}</h3>
                      <p>{suggestion.summary}</p>
                      <small>{suggestion.reason}</small>
                      {suggestion.references.length > 0 && (
                        <div className="agent-suggestion-references" aria-label="相关工作台信息">
                          {suggestion.references.map((reference) => <span key={`${reference.type}-${reference.id}`}>{reference.label}</span>)}
                        </div>
                      )}
                    </div>
                    <div className="agent-suggestion-actions">
                      {suggestion.proposal?.kind === 'create_todo' && (
                        <button type="button" className="text-btn agent-suggestion-act" onClick={() => void openSuggestionProposal(suggestion)} disabled={busy || confirming || suggestion.status === 'acted'}>
                          {suggestion.status === 'acted' ? '已安排' : '安排为待办'}
                        </button>
                      )}
                      <button type="button" className="text-btn" onClick={() => void updateSuggestion(suggestion.id, { status: 'read' })} disabled={suggestion.status === 'read' || suggestion.status === 'acted'}>已了解</button>
                      <button type="button" className="text-btn agent-suggestion-dismiss" onClick={() => void updateSuggestion(suggestion.id, { status: 'dismissed' })}>忽略</button>
                      <button type="button" className="text-btn agent-suggestion-more" onClick={() => setSuggestionMenuOpen((current) => current === suggestion.id ? null : suggestion.id)} aria-label="更多主动建议操作" aria-haspopup="menu" aria-expanded={suggestionMenuOpen === suggestion.id} title="更多操作"><MoreHorizontal size={15} /></button>
                      {suggestionMenuOpen === suggestion.id && (
                        <div className="agent-suggestion-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => void updateSuggestion(suggestion.id, { status: 'unread', followUpAt: tomorrowMorning() })}><Clock3 size={14} />明天上午再看</button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {suggestionHistory.length > 0 && (
            <section className={`agent-proactive agent-suggestion-history${suggestionHistoryOpen ? ' is-open' : ''}`} aria-labelledby="agent-suggestion-history-title">
              <span id="agent-suggestion-history-title" className="visually-hidden">最近处理的主动建议</span>
              <button type="button" className="agent-suggestion-history-trigger" onClick={() => setSuggestionHistoryOpen((open) => !open)} aria-expanded={suggestionHistoryOpen} aria-controls="agent-suggestion-history-list">
                <span><History size={14} />最近处理 <small>{suggestionHistory.length} 条</small></span>
                <ChevronDown size={14} />
              </button>
              {suggestionHistoryOpen && (
                <div id="agent-suggestion-history-list" className="agent-suggestion-history-list">
                  {suggestionHistory.map((suggestion) => (
                    <article key={suggestion.id} className="agent-history-entry">
                      <span className={`agent-history-status${suggestion.status === 'acted' ? ' is-acted' : ' is-dismissed'}`} aria-hidden="true">
                        {suggestion.status === 'acted' ? <Check size={13} /> : <X size={13} />}
                      </span>
                      <div className="agent-history-main">
                        <strong>{suggestion.title}</strong>
                        <p>{suggestion.summary}</p>
                        <small>{suggestionStatusLabel(suggestion.status)} · {formatRunTime(suggestion.updatedAt || suggestion.createdAt)}</small>
                      </div>
                      <button type="button" className="text-btn agent-history-action" onClick={() => void updateSuggestion(suggestion.id, { status: 'unread', followUpAt: null })}>重新关注</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          <div className="chat-list" ref={scrollRef} aria-live="polite">
            <div className="chat-feed">
            {messages.length === 0 && !streaming && (
              <div className="chat-empty">
                <div>
                  <p className="chat-empty-title">从工作台开始</p>
                  <p>我会基于待办、日历、备忘录和资料库回答。新增内容会先请你确认。</p>
                </div>
                <div className="suggestion-row">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} type="button" className="suggestion-btn" onClick={() => setDraft(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`chat-msg ${message.role}`}>
                <div className="chat-bubble">
                  {message.attachments?.length ? (
                    <div className="chat-attachments" aria-label="本条消息引用的资料">
                      {message.attachments.map((attachment) => <span key={attachment.id}><FileText size={12} />{attachment.name}</span>)}
                    </div>
                  ) : null}
                  {message.role === 'assistant' ? <AgentMessageContent content={message.content} /> : message.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-msg assistant">
                <div className={`chat-bubble${streaming ? ' streaming' : ' waiting'}`}>
                  {streaming ? <><AgentMessageContent content={streaming} /><span className="stream-cursor" aria-hidden="true" /></> : <LoadingDots />}
                </div>
              </div>
            )}
            {proposal && <ProposalCard proposal={proposal} busy={confirming} onConfirm={confirmProposal} onCancel={() => { setProposal(null); setPendingSuggestionId(null); }} />}
            </div>
          </div>
          {error && <p className="form-error chat-error">{error}</p>}

          <div className="chat-compose-dock">
            {showScrollToBottom && (
              <button type="button" className="chat-scroll-bottom" onClick={scrollToBottom} aria-label="滚动到最新消息" title="回到底部">
                <ArrowDown size={18} strokeWidth={2.2} />
              </button>
            )}
            <form className="chat-form" onSubmit={send}>
              <div className="chat-composer">
              {composerMenuOpen && (
                <aside className="composer-menu" data-agent-composer-popup="true" aria-label="快捷操作">
                  <div className="composer-menu-actions">
                    <button type="button" onClick={() => prepareDraft('帮我添加一条待办：')}><ListPlus size={16} /><span><strong>添加待办</strong><small>交给 Agent 整理后确认</small></span></button>
                    <button type="button" onClick={() => prepareDraft('帮我记录一条备忘录：')}><NotebookPen size={16} /><span><strong>记录备忘录</strong><small>整理后再确认保存</small></span></button>
                  </div>
                  <div className="composer-menu-docs">
                    <p>引用工作台文档</p>
                    {referenceDocs.length ? referenceDocs.map((item) => (
                      <button type="button" key={item.id} onClick={() => attachDocument(item)} disabled={attachments.some((attachment) => attachment.id === item.id)}><FileText size={15} /><span>{item.name}</span>{attachments.some((attachment) => attachment.id === item.id) && <Check size={14} />}</button>
                    )) : <small>资料库中还没有可引用的工作台文档。</small>}
                  </div>
                </aside>
              )}
              {scopeMenuOpen && (
                <aside className="composer-scope-menu" data-agent-composer-popup="true" aria-label="Agent 工作范围">
                  <strong>本次对话可读取</strong>
                  <p>待办、日历、备忘录和资料库</p>
                  <small>创建待办、备忘录和个人日期前，仍会请求你的确认。</small>
                </aside>
              )}
              {modelMenuOpen && (
                <aside className="composer-model-menu" data-agent-composer-popup="true" aria-label="选择当前会话模型">
                  <p>设置中已配置的模型</p>
                  {activeModel ? <button type="button" className="active" onClick={() => setModelMenuOpen(false)}>{activeModel}<Check size={14} /></button> : <small className="model-menu-status">请先在设置中配置 Agent 模型。</small>}
                </aside>
              )}
              {attachments.length > 0 && (
                <div className="composer-attachments" aria-label="待发送引用资料">
                  {attachments.map((attachment) => (
                    <span key={attachment.id}><FileText size={13} />{attachment.name}<button type="button" onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))} aria-label={`移除引用：${attachment.name}`}><X size={13} /></button></span>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submit(draft);
                  }
                }}
                placeholder="问问今天的安排，或让 Agent 帮你整理信息"
                rows={1}
              />
              <div className="composer-footer">
                <div className="composer-footer-start">
                  <button type="button" className="composer-tool" data-agent-composer-toggle="true" onClick={toggleComposerMenu} aria-expanded={composerMenuOpen} aria-label="快捷操作" title="快捷操作"><Plus size={18} /></button>
                  <button type="button" className="composer-access" data-agent-composer-toggle="true" onClick={() => { setScopeMenuOpen((open) => !open); setComposerMenuOpen(false); setModelMenuOpen(false); }} aria-expanded={scopeMenuOpen}><Database size={16} /> 工作台已连接 <ChevronDown size={14} /></button>
                </div>
                <div className="composer-footer-end">
                  <button type="button" className="composer-model" data-agent-composer-toggle="true" onClick={toggleModelMenu} aria-expanded={modelMenuOpen} title="选择当前会话模型">{activeModel || '选择模型'}<ChevronDown size={14} /></button>
                  <button type="submit" className="agent-send" aria-label="发送消息" title="发送消息" disabled={busy || confirming || !draft.trim()}><ArrowUp size={16} strokeWidth={2.25} /></button>
                </div>
              </div>
              </div>
              <p className="chat-input-hint">Enter 发送 · Shift + Enter 换行</p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function LoadingDots() {
  return (
    <span className="loading-dots" role="status" aria-label="Agent 正在思考">
      <i /><i /><i />
    </span>
  );
}

function ProposalCard({ proposal, busy, onConfirm, onCancel }: { proposal: AgentProposal; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const isTodo = proposal.kind === 'create_todo';
  const isImportantDate = proposal.kind === 'save_important_date';
  const isPreference = proposal.kind === 'save_preference';
  return (
    <aside className="agent-proposal" aria-label="待确认操作">
      <div className="agent-proposal-icon">{isTodo ? <ListTodo size={17} /> : isImportantDate ? <CalendarDays size={17} /> : isPreference ? <Settings2 size={17} /> : <StickyNote size={17} />}</div>
      <div className="agent-proposal-content">
        <span>待确认</span>
        <strong>{isTodo ? '添加待办' : isImportantDate ? '记住重要日期' : isPreference ? '记住工作偏好' : '保存备忘录'}</strong>
        <p>{isPreference ? proposal.preference : proposal.title}</p>
        {isTodo ? (
          <small>{priorityLabel[proposal.priority]}{proposal.due ? ` · ${new Date(proposal.due).toLocaleString('zh-CN', { hour12: false })}` : ''}</small>
        ) : isImportantDate ? (
          <small>每年 {proposal.date}</small>
        ) : isPreference ? (
          <small>会保存到 Agent 的长期规则</small>
        ) : (
          <small>{proposal.content}</small>
        )}
      </div>
      <div className="agent-proposal-actions">
        <button type="button" className="text-btn" onClick={onCancel} disabled={busy}>取消</button>
        <button type="button" className="btn-primary agent-confirm" onClick={onConfirm} disabled={busy}><Check size={15} />{busy ? '保存中' : '确认保存'}</button>
      </div>
    </aside>
  );
}
