import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, CalendarDays, Check, ChevronDown, Database, FileText, ListPlus, ListTodo, MessageSquare, NotebookPen, Plus, RefreshCw, Settings2, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import type { AgentConversation, AgentConversationStore, AgentProposal, AgentSuggestion, ChatAttachment, ChatMessage, ProfileItem } from '../types';

const SUGGESTIONS = [
  '今天有什么要做？',
  '整理一下本周的待办',
  '我妈妈生日是 5 月 20 日',
  '帮我看看资料库里有什么',
];

const priorityLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' };

function createConversation(): AgentConversation {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() || `conversation-${Date.now()}`,
    title: '新对话',
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
      conversations: [{ ...conversation, title: value.length ? '此前对话' : '新对话', messages: value }],
    };
  }
  if (value?.conversations?.length) {
    const activeId = value.conversations.some((conversation) => conversation.id === value.activeId)
      ? value.activeId
      : value.conversations[0].id;
    return { ...value, activeId };
  }
  return createConversationStore();
}

function conversationTitle(content: string) {
  const title = content.replace(/\s+/g, ' ').trim();
  return title.length > 26 ? `${title.slice(0, 26)}…` : title;
}

export default function Agent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [conversationStore, setConversationStore] = useState<AgentConversationStore>(createConversationStore);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [referenceDocs, setReferenceDocs] = useState<ProfileItem[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [modelName, setModelName] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [proactiveSuggestions, setProactiveSuggestions] = useState<AgentSuggestion[]>([]);
  const [proactiveBusy, setProactiveBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    window.workbench.data.getModule('agent').then((saved) => setConversationStore(normaliseConversationStore(saved))).catch(() => {});
  }, []);

  useEffect(() => {
    const stopListening = window.workbench.agent.onProactiveUpdated(() => {
      void loadProactiveSuggestions();
    });
    void loadProactiveSuggestions();
    void window.workbench.agent.checkProactive()
      .then((suggestions) => setProactiveSuggestions(suggestions))
      .catch(() => {});
    return stopListening;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, busy, proposal]);

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

  async function refreshProactive() {
    if (proactiveBusy) return;
    setProactiveBusy(true);
    try {
      setProactiveSuggestions(await window.workbench.agent.checkProactive(true));
    } catch {
      await loadProactiveSuggestions();
    } finally {
      setProactiveBusy(false);
    }
  }

  async function updateSuggestion(id: string, status: 'read' | 'dismissed') {
    try {
      setProactiveSuggestions(await window.workbench.agent.updateSuggestion(id, { status }));
    } catch {
      // 主动建议不是主流程，状态更新失败时保留当前页面内容。
    }
  }

  function startConversation() {
    if (busy || confirming) return;
    const conversation = createConversation();
    saveConversationStore({
      activeId: conversation.id,
      conversations: [conversation, ...conversationStore.conversations],
    });
    setDraft('');
    setStreaming('');
    setProposal(null);
    setError('');
    setSessionMenuOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectConversation(id: string) {
    if (busy || confirming || id === conversationStore.activeId) return;
    saveConversationStore({ ...conversationStore, activeId: id });
    setDraft('');
    setStreaming('');
    setProposal(null);
    setError('');
    setSessionMenuOpen(false);
  }

  function removeConversation(id: string) {
    if (busy || confirming) return;
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

  async function submit(text: string) {
    const content = text.trim();
    if (!content || busy || confirming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content, attachments: attachments.length ? attachments : undefined }];
    saveMessages(next, messages.length === 0 ? conversationTitle(content) : activeConversation?.title);
    setDraft('');
    setAttachments([]);
    setProposal(null);
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
      setProposal(null);
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
                  <article key={suggestion.id} className={`agent-suggestion${suggestion.status === 'unread' ? ' is-unread' : ''}`}>
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
                      <button type="button" className="text-btn" onClick={() => void updateSuggestion(suggestion.id, 'read')} disabled={suggestion.status === 'read'}>已了解</button>
                      <button type="button" className="text-btn agent-suggestion-dismiss" onClick={() => void updateSuggestion(suggestion.id, 'dismissed')}>忽略</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <div className="chat-list" ref={scrollRef} aria-live="polite">
            <div className="session-menu-shell">
              <button type="button" className="session-menu-trigger" onClick={() => setSessionMenuOpen((open) => !open)} aria-expanded={sessionMenuOpen} aria-controls="agent-session-menu">
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
                        <button type="button" className="session-select" onClick={() => selectConversation(conversation.id)} disabled={busy || confirming} title={conversation.title}>
                          <MessageSquare size={15} />
                          <span>{conversation.title}</span>
                        </button>
                        <button type="button" className="session-remove" onClick={() => removeConversation(conversation.id)} disabled={busy || confirming} aria-label={`删除会话：${conversation.title}`} title="删除会话"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </nav>
                  <div className="session-connection">
                    <span className="agent-status"><span className={configured ? 'status-dot on' : 'status-dot'} />{configured ? '已连接' : '未配置'}</span>
                    {!configured && <button type="button" className="text-btn" onClick={onOpenSettings}><Settings2 size={15} /> 配置</button>}
                  </div>
                </aside>
              )}
            </div>
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
                  {message.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-msg assistant">
                <div className={`chat-bubble${streaming ? ' streaming' : ' waiting'}`}>
                  {streaming ? <>{streaming}<span className="stream-cursor" aria-hidden="true" /></> : <LoadingDots />}
                </div>
              </div>
            )}
            {proposal && <ProposalCard proposal={proposal} busy={confirming} onConfirm={confirmProposal} onCancel={() => setProposal(null)} />}
            </div>
          </div>
          {error && <p className="form-error chat-error">{error}</p>}

          <form className="chat-form" onSubmit={send}>
            <div className="chat-composer">
              {composerMenuOpen && (
                <aside className="composer-menu" aria-label="快捷操作">
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
                <aside className="composer-scope-menu" aria-label="Agent 工作范围">
                  <strong>本次对话可读取</strong>
                  <p>待办、日历、备忘录和资料库</p>
                  <small>创建待办、备忘录和个人日期前，仍会请求你的确认。</small>
                </aside>
              )}
              {modelMenuOpen && (
                <aside className="composer-model-menu" aria-label="选择当前会话模型">
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
                  <button type="button" className="composer-tool" onClick={toggleComposerMenu} aria-expanded={composerMenuOpen} aria-label="快捷操作" title="快捷操作"><Plus size={18} /></button>
                  <button type="button" className="composer-access" onClick={() => { setScopeMenuOpen((open) => !open); setComposerMenuOpen(false); setModelMenuOpen(false); }} aria-expanded={scopeMenuOpen}><Database size={16} /> 工作台已连接 <ChevronDown size={14} /></button>
                </div>
                <div className="composer-footer-end">
                  <button type="button" className="composer-model" onClick={toggleModelMenu} aria-expanded={modelMenuOpen} title="选择当前会话模型">{activeModel || '选择模型'}<ChevronDown size={14} /></button>
                  <button type="submit" className="agent-send" aria-label="发送消息" title="发送消息" disabled={busy || confirming || !draft.trim()}><ArrowUp size={16} strokeWidth={2.25} /></button>
                </div>
              </div>
            </div>
            <p className="chat-input-hint">Enter 发送 · Shift + Enter 换行</p>
          </form>
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
  return (
    <aside className="agent-proposal" aria-label="待确认操作">
      <div className="agent-proposal-icon">{isTodo ? <ListTodo size={17} /> : isImportantDate ? <CalendarDays size={17} /> : <StickyNote size={17} />}</div>
      <div className="agent-proposal-content">
        <span>待确认</span>
        <strong>{isTodo ? '添加待办' : isImportantDate ? '记住重要日期' : '保存备忘录'}</strong>
        <p>{proposal.title}</p>
        {isTodo ? (
          <small>{priorityLabel[proposal.priority]}{proposal.due ? ` · ${new Date(proposal.due).toLocaleString('zh-CN', { hour12: false })}` : ''}</small>
        ) : isImportantDate ? (
          <small>每年 {proposal.date}</small>
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
