import { FormEvent, useEffect, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, Brain, CalendarDays, Check, ChevronDown, CircleCheck, Clock3, Database, FileText, History, ListPlus, ListTodo, Mail, MessageSquare, MoreHorizontal, NotebookPen, Pause, Pencil, Pin, Plus, RefreshCw, RotateCcw, Settings2, Sparkles, StickyNote, Target, Trash2, WandSparkles, X } from 'lucide-react';
import AgentMessageContent from '../components/AgentMessageContent';
import { DEFAULT_CONVERSATION_TITLE, conversationTitleFromMessages, isPlaceholderConversationTitle } from '../components/agentConversationTitle';
import type { AgentConversation, AgentConversationStore, AgentDirectMessage, AgentGoal, AgentGoalAction, AgentGoalActionStatus, AgentGoalStatus, AgentMemory, AgentMemoryDecision, AgentProposal, AgentRun, AgentRunStatus, AgentSkill, AgentSuggestion, AgentSuggestionStatus, AgentTrigger, ChatAttachment, ChatMessage, ProfileItem } from '../types';

const SUGGESTIONS = [
  '今天有什么要做？',
  '整理一下本周的待办',
  '我妈妈生日是 5 月 20 日',
  '帮我看看资料库里有什么',
];

const runContextLabel = {
  todos: '待办',
  schedule: '日程',
  notes: '备忘录',
  library: '资料库',
  'current-time': '当前时间',
  goals: '目标',
  memories: '长期记忆',
  skills: 'Skill',
  mail: '邮件',
} as const;

const priorityLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const mailPriorityLabel = { high: '高优先级邮件', medium: '中优先级邮件', low: '低优先级邮件' };
const goalStatusLabel: Record<AgentGoalStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};
const actionStatusLabel: Record<AgentGoalActionStatus, string> = {
  pending: '待跟进',
  completed: '已完成',
  dismissed: '已忽略',
  removed: '已移除',
};
const runTriggerLabel: Record<AgentTrigger, string> = {
  'daily-briefing': '每日简报',
  'event-follow-up': '事件跟进',
  'mail-triage': '邮件分诊',
};
const runStatusLabel: Record<AgentRunStatus, string> = {
  running: '检查中',
  completed: '已完成',
  failed: '失败',
};
const runDeliveryLabel: Record<NonNullable<AgentRun['delivery']>, string> = {
  none: '无需送达',
  'in-app': '已加入建议队列',
  'desktop-notification': '已发桌面通知',
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

export default function Agent({
  onOpenSettings,
  openProactiveMessageId,
  onProactiveMessageOpened,
}: {
  onOpenSettings: () => void;
  openProactiveMessageId: string;
  onProactiveMessageOpened: () => void;
}) {
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
  const [agentName, setAgentName] = useState('Agent');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [proactiveSuggestions, setProactiveSuggestions] = useState<AgentSuggestion[]>([]);
  const [suggestionHistory, setSuggestionHistory] = useState<AgentSuggestion[]>([]);
  const [directMessages, setDirectMessages] = useState<AgentDirectMessage[]>([]);
  const [openingDirectMessageId, setOpeningDirectMessageId] = useState<string | null>(null);
  const [proactiveBusy, setProactiveBusy] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [runsOpen, setRunsOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [suggestionHistoryOpen, setSuggestionHistoryOpen] = useState(false);
  const [suggestionMenuOpen, setSuggestionMenuOpen] = useState<string | null>(null);
  const [goals, setGoals] = useState<AgentGoal[]>([]);
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [goalComposerOpen, setGoalComposerOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalActionTarget, setGoalActionTarget] = useState<string | null>(null);
  const [goalActionTitle, setGoalActionTitle] = useState('');
  const [goalActionFollowUpAt, setGoalActionFollowUpAt] = useState('');
  const [actionOutcomeDrafts, setActionOutcomeDrafts] = useState<Record<string, string>>({});
  const [goalCompletionTarget, setGoalCompletionTarget] = useState<string | null>(null);
  const [goalOutcomeDraft, setGoalOutcomeDraft] = useState('');
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [stateBusy, setStateBusy] = useState(false);
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
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const pendingKnowledgeCount = memories.filter((memory) => memory.status === 'candidate').length
    + skills.filter((skill) => skill.status === 'candidate').length;
  const unreadDirectMessages = directMessages.filter((message) => !message.readAt);

  useEffect(() => {
    window.workbench.agent.status().then(setConfigured).catch(() => setConfigured(false));
    window.workbench.data.getSettings().then((settings) => {
      setModelName(settings.agent.model || '');
      setAgentName(settings.agent.persona?.name.trim() || 'Agent');
    }).catch(() => {});
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
      void loadDirectMessages();
      void loadAgentState();
    });
    const stopStateListening = window.workbench.agent.onStateUpdated(() => {
      void loadAgentState();
    });
    void loadProactiveSuggestions();
    void loadSuggestionHistory();
    void loadAgentRuns();
    void loadDirectMessages();
    void loadAgentState();
    void window.workbench.agent.checkProactive()
      .then((suggestions) => {
        setProactiveSuggestions(suggestions);
        void loadSuggestionHistory();
        void loadAgentRuns();
      })
      .catch(() => {});
    return () => {
      stopListening();
      stopStateListening();
    };
  }, []);

  useEffect(() => {
    if (!openProactiveMessageId || busy || confirming || openingDirectMessageId === openProactiveMessageId) return;
    const message = directMessages.find((item) => item.id === openProactiveMessageId);
    if (message) void openDirectMessage(message, true);
  }, [openProactiveMessageId, directMessages, busy, confirming, openingDirectMessageId]);

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

  function saveConversationStore(next: AgentConversationStore, throwOnError = false) {
    setConversationStore(next);
    const request = window.workbench.data.setModule('agent', next);
    return throwOnError ? request : request.catch(() => null);
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

  async function loadDirectMessages() {
    try {
      setDirectMessages(await window.workbench.agent.getMessages());
    } catch {
      setDirectMessages([]);
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

  async function loadAgentState() {
    try {
      const [nextGoals, nextMemories, nextSkills] = await Promise.all([
        window.workbench.agent.getGoals(true),
        window.workbench.agent.getMemories(true),
        window.workbench.agent.getSkills(true),
      ]);
      setGoals(nextGoals);
      setMemories(nextMemories);
      setSkills(nextSkills);
    } catch {
      // Agent 辅助状态加载失败不应影响聊天主流程。
    }
  }

  async function openDirectMessage(message: AgentDirectMessage, openedFromNotification = false) {
    if (busy || confirming || openingDirectMessageId === message.id) return;
    setOpeningDirectMessageId(message.id);
    cancelRename();
    const conversationId = message.conversationId || `proactive-${message.id}`;
    const now = new Date().toISOString();
    const threadMessages = directMessages
      .filter((item) => (item.conversationId || `proactive-${item.id}`) === conversationId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const incoming = threadMessages.map((item): ChatMessage => ({
      id: `proactive-${item.id}`,
      role: 'assistant',
      content: item.content,
      source: item.phase === 'follow-up' ? 'follow-up' : 'proactive',
      createdAt: item.createdAt,
      proactiveMessageId: item.id,
      suggestionId: item.suggestionId,
      goalId: item.goalId,
    }));
    const existing = conversationStore.conversations.find((conversation) => conversation.id === conversationId);
    const conversation: AgentConversation = existing
      ? {
        ...existing,
        messages: [...existing.messages, ...incoming.filter((item) => !existing.messages.some((entry) => entry.proactiveMessageId === item.proactiveMessageId))],
        updatedAt: now,
      }
      : {
        id: conversationId,
        title: message.title,
        messages: incoming,
        createdAt: message.createdAt,
        updatedAt: now,
      };
    const nextStore: AgentConversationStore = {
      activeId: conversation.id,
      conversations: [conversation, ...conversationStore.conversations.filter((item) => item.id !== conversation.id)],
    };
    try {
      await saveConversationStore(nextStore, true);
      const marked = await window.workbench.agent.markMessageRead(message.id, conversation.id);
      if (marked) {
        setDirectMessages((items) => items.map((item) => (
          item.conversationId === marked.conversationId ? { ...item, readAt: item.readAt || marked.readAt } : item
        )));
      }
      setDraft('');
      setStreaming('');
      setProposal(message.proposal || null);
      setPendingSuggestionId(message.proposal ? message.suggestionId : null);
      setError('');
      setSessionMenuOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开主动消息失败，请稍后重试');
    } finally {
      setOpeningDirectMessageId(null);
      if (openedFromNotification) onProactiveMessageOpened();
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
      await loadAgentState();
      setSuggestionMenuOpen(null);
    } catch {
      // 主动建议不是主流程，状态更新失败时保留当前页面内容。
    }
  }

  async function linkSuggestionToGoal(id: string, goalId: string) {
    try {
      setProactiveSuggestions(await window.workbench.agent.linkSuggestionToGoal(id, goalId));
      await loadAgentState();
      setSuggestionMenuOpen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '关联目标失败，请稍后重试');
    }
  }

  function tomorrowMorning() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }

  async function createGoal(event: FormEvent) {
    event.preventDefault();
    const title = goalTitle.trim();
    if (!title || stateBusy) return;
    const targetDate = goalTargetDate ? new Date(goalTargetDate) : null;
    if (targetDate && Number.isNaN(targetDate.getTime())) {
      setError('目标日期无效');
      return;
    }
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.createGoal({
        title,
        description: goalDescription.trim(),
        targetDate: targetDate?.toISOString() || null,
      });
      setGoalTitle('');
      setGoalDescription('');
      setGoalTargetDate('');
      setGoalComposerOpen(false);
      await loadAgentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建目标失败，请稍后重试');
    } finally {
      setStateBusy(false);
    }
  }

  async function updateGoalStatus(id: string, status: AgentGoalStatus, outcome?: string) {
    if (stateBusy) return false;
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.updateGoal(id, { status, ...(outcome === undefined ? {} : { outcome }) });
      await loadAgentState();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新目标失败，请稍后重试');
      return false;
    } finally {
      setStateBusy(false);
    }
  }

  function beginGoalCompletion(goal: AgentGoal) {
    setGoalCompletionTarget(goal.id);
    setGoalOutcomeDraft(goal.outcome || '');
  }

  async function completeGoal(event: FormEvent, id: string) {
    event.preventDefault();
    if (await updateGoalStatus(id, 'completed', goalOutcomeDraft.trim())) {
      setGoalCompletionTarget(null);
      setGoalOutcomeDraft('');
    }
  }

  async function addGoalFollowUp(event: FormEvent) {
    event.preventDefault();
    const title = goalActionTitle.trim();
    if (!goalActionTarget || !title || stateBusy) return;
    const followUp = goalActionFollowUpAt ? new Date(goalActionFollowUpAt) : null;
    if (followUp && Number.isNaN(followUp.getTime())) {
      setError('跟进时间无效');
      return;
    }
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.addGoalAction({
        goalId: goalActionTarget,
        title,
        type: 'follow-up',
        followUpAt: followUp?.toISOString() || null,
      });
      setGoalActionTitle('');
      setGoalActionFollowUpAt('');
      setGoalActionTarget(null);
      await loadAgentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加跟进失败，请稍后重试');
    } finally {
      setStateBusy(false);
    }
  }

  async function updateFollowUp(action: AgentGoalAction, status: AgentGoalActionStatus) {
    if (stateBusy) return;
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.updateGoalAction(action.id, {
        status,
        outcome: status === 'completed' ? (actionOutcomeDrafts[action.id] || action.outcome) : action.outcome,
      });
      setActionOutcomeDrafts((current) => {
        const next = { ...current };
        delete next[action.id];
        return next;
      });
      await loadAgentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新跟进失败，请稍后重试');
    } finally {
      setStateBusy(false);
    }
  }

  async function reviewMemory(id: string, decision: AgentMemoryDecision) {
    if (stateBusy) return;
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.reviewMemory(id, decision);
      await loadAgentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核记忆失败，请稍后重试');
    } finally {
      setStateBusy(false);
    }
  }

  async function saveMemoryEdit(id: string, content: string) {
    if (stateBusy || !content.trim()) return;
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.updateMemory(id, content);
      setEditingMemoryId(null);
      setMemoryDraft('');
      await loadAgentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存记忆失败，请稍后重试');
    } finally {
      setStateBusy(false);
    }
  }

  async function reviewSkill(id: string, decision: 'activate' | 'reject' | 'archive' | 'restore') {
    if (stateBusy) return;
    setStateBusy(true);
    setError('');
    try {
      await window.workbench.agent.reviewSkill(id, decision);
      await loadAgentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核 Skill 失败，请稍后重试');
    } finally {
      setStateBusy(false);
    }
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
      await loadAgentState();
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
            <div className="agent-top-actions">
              <button type="button" className="agent-management-trigger" onClick={() => { setManagementOpen(true); setSessionMenuOpen(false); }} aria-expanded={managementOpen} aria-controls="agent-management-drawer">
                <ListTodo size={15} /><span>管理</span>
              </button>
              <button type="button" className="session-menu-trigger" onClick={toggleSessionMenu} aria-expanded={sessionMenuOpen} aria-controls="agent-session-menu">
                <MessageSquare size={15} />
                <span>会话 · {activeConversation?.title || '新对话'}</span>
                {unreadDirectMessages.length > 0 && <i className="session-unread-badge" aria-label={`${unreadDirectMessages.length} 条未读主动消息`}>{unreadDirectMessages.length}</i>}
              </button>
            </div>
            {sessionMenuOpen && (
              <aside id="agent-session-menu" className="agent-session-menu" aria-label={`${agentName} 会话`}>
                <button type="button" className="session-new" onClick={startConversation} disabled={busy || confirming}><Plus size={16} /> 新建对话</button>
                <nav className="session-list" aria-label="会话列表">
                  {unreadDirectMessages.length > 0 && (
                    <>
                      <p className="session-direct-heading"><Sparkles size={12} />{agentName} 的消息 <small>{unreadDirectMessages.length} 条未读</small></p>
                      {unreadDirectMessages.map((message) => (
                        <button key={message.id} type="button" className="session-direct-message" onClick={() => void openDirectMessage(message)} disabled={busy || confirming || openingDirectMessageId === message.id}>
                          <Sparkles size={15} />
                          <span><strong>{message.title}</strong><small>{message.phase === 'follow-up' ? `${agentName} 跟进` : `${agentName} 主动消息`} · {formatRunTime(message.createdAt)}</small></span>
                          <b>新</b>
                        </button>
                      ))}
                    </>
                  )}
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
                            : run.decision
                              ? run.decision
                              : suggestion
                                ? `生成建议：${suggestion.title}`
                              : run.suggestionId
                                ? '已生成一条主动建议（当前已从列表隐藏）'
                                : run.status === 'running'
                                  ? '正在读取工作台上下文'
                                  : '检查完成，没有生成新的提醒';
                          const contextSummary = run.contextTypes?.length
                            ? `已读取：${run.contextTypes.map((type) => runContextLabel[type]).join('、')}`
                            : '';
                          const deliverySummary = run.delivery ? runDeliveryLabel[run.delivery] : '';
                          const memoryDetail = run.memoryIds?.length
                            ? `本轮记忆：${run.memoryIds.map((id) => memories.find((item) => item.id === id)?.content || '（已删除的记忆）').join('；')}`
                            : '';
                          return (
                            <article key={run.id} className="session-run-entry">
                              <span className={`agent-run-status-dot${run.status === 'running' ? ' is-running' : ''}${run.status === 'failed' ? ' is-failed' : ''}`} aria-hidden="true" />
                              <div className="agent-run-copy">
                                <strong>{runTriggerLabel[run.trigger]} · {runStatusLabel[run.status]}</strong>
                                <small title={[summary, contextSummary, memoryDetail, deliverySummary].filter(Boolean).join(' · ')}>{summary}{contextSummary ? ` · ${contextSummary}` : ''}{deliverySummary ? ` · ${deliverySummary}` : ''}</small>
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
          {managementOpen && (
            <div className="agent-management-layer">
              <button type="button" className="agent-management-backdrop" aria-label="关闭 Agent 管理" onClick={() => { setManagementOpen(false); setSuggestionHistoryOpen(false); setSuggestionMenuOpen(null); }} />
              <aside id="agent-management-drawer" className="agent-management-drawer" role="dialog" aria-modal="true" aria-label="Agent 管理">
                <header className="agent-management-header">
                  <div>
                    <span>Agent</span>
                    <h2>目标、记忆与主动事项</h2>
                  </div>
                  <button type="button" className="text-btn agent-management-close" aria-label="关闭 Agent 管理" title="关闭" onClick={() => { setManagementOpen(false); setSuggestionHistoryOpen(false); setSuggestionMenuOpen(null); }}><X size={16} /></button>
                </header>
                <div className="agent-management-content">
          <AgentGoalsPanel
            goals={goals}
            open={goalsOpen}
            composerOpen={goalComposerOpen}
            goalTitle={goalTitle}
            goalDescription={goalDescription}
            goalTargetDate={goalTargetDate}
            actionTargetId={goalActionTarget}
            actionTitle={goalActionTitle}
            actionFollowUpAt={goalActionFollowUpAt}
            actionOutcomeDrafts={actionOutcomeDrafts}
            completionTargetId={goalCompletionTarget}
            goalOutcomeDraft={goalOutcomeDraft}
            busy={stateBusy}
            onToggle={() => setGoalsOpen((open) => !open)}
            onToggleComposer={() => setGoalComposerOpen((open) => !open)}
            onGoalTitleChange={setGoalTitle}
            onGoalDescriptionChange={setGoalDescription}
            onGoalTargetDateChange={setGoalTargetDate}
            onCreateGoal={createGoal}
            onStatusChange={updateGoalStatus}
            onBeginCompletion={beginGoalCompletion}
            onCancelCompletion={() => {
              setGoalCompletionTarget(null);
              setGoalOutcomeDraft('');
            }}
            onGoalOutcomeChange={setGoalOutcomeDraft}
            onCompleteGoal={completeGoal}
            onActionTargetChange={(id) => {
              setGoalActionTarget((current) => current === id ? null : id);
              setGoalActionTitle('');
              setGoalActionFollowUpAt('');
            }}
            onActionTitleChange={setGoalActionTitle}
            onActionFollowUpAtChange={setGoalActionFollowUpAt}
            onAddAction={addGoalFollowUp}
            onOutcomeChange={(id, value) => setActionOutcomeDrafts((current) => ({ ...current, [id]: value }))}
            onActionStatusChange={updateFollowUp}
          />
          <AgentKnowledgePanel
            memories={memories}
            skills={skills}
            open={knowledgeOpen}
            pendingCount={pendingKnowledgeCount}
            busy={stateBusy}
            onToggle={() => setKnowledgeOpen((open) => !open)}
            onReviewMemory={reviewMemory}
            onReviewSkill={reviewSkill}
            onUpdateMemory={saveMemoryEdit}
            editingMemoryId={editingMemoryId}
            memoryDraft={memoryDraft}
            onStartMemoryEdit={(memory) => {
              setEditingMemoryId(memory.id);
              setMemoryDraft(memory.content);
            }}
            onCancelMemoryEdit={() => {
              setEditingMemoryId(null);
              setMemoryDraft('');
            }}
            onMemoryDraftChange={setMemoryDraft}
          />
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
                      {suggestion.priority && <span className={`agent-suggestion-priority is-${suggestion.priority}`}>{mailPriorityLabel[suggestion.priority]}</span>}
                      <h3>{suggestion.title}</h3>
                      <p>{suggestion.summary}</p>
                      <small>{suggestion.reason}</small>
                      {suggestion.goalId && goalsById.get(suggestion.goalId) && (
                        <span className="agent-suggestion-goal"><Target size={11} />目标 · {goalsById.get(suggestion.goalId)?.title}</span>
                      )}
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
                          {!suggestion.goalId && goals.filter((goal) => goal.status === 'active').slice(0, 4).map((goal) => (
                            <button key={goal.id} type="button" role="menuitem" onClick={() => void linkSuggestionToGoal(suggestion.id, goal.id)}><Target size={14} />关联到「{goal.title}」</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {suggestionHistory.length > 0 && (
            <section className={`agent-proactive agent-suggestion-history${suggestionHistoryOpen ? ' is-open' : ''}`} aria-label="最近处理的主动建议">
              <button type="button" className="agent-suggestion-history-trigger" onClick={() => setSuggestionHistoryOpen((open) => !open)} aria-expanded={suggestionHistoryOpen} aria-controls="agent-suggestion-history-list">
                <span><History size={14} />最近处理 <small>{suggestionHistory.length} 条</small></span>
                <ChevronDown size={14} />
              </button>
              {suggestionHistoryOpen && (
                <div id="agent-suggestion-history-list" className="agent-suggestion-history-list">
                  {suggestionHistory.map((suggestion) => (
                    <article key={suggestion.id} className="agent-history-entry">
                      <div className="agent-history-main">
                        <strong>{suggestion.title}</strong>
                        <p>{suggestion.summary}</p>
                        <small>{suggestionStatusLabel(suggestion.status)} · {formatRunTime(suggestion.updatedAt || suggestion.createdAt)}</small>
                      </div>
                      <button type="button" className="text-btn agent-history-action" onClick={() => void updateSuggestion(suggestion.id, { status: 'unread', followUpAt: null })}><RotateCcw size={13} />重新关注</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
                </div>
              </aside>
            </div>
          )}
          <div className="chat-list" ref={scrollRef} aria-live="polite">
            <div className="chat-feed">
            {messages.length === 0 && !streaming && (
              <div className="chat-empty">
                <div>
                  <p className="chat-empty-title">从工作台开始</p>
                  <p>{agentName} 会结合待办、资料、当前目标和已审核记忆回答。新增内容会先请你确认。</p>
                </div>
                <div className="suggestion-row">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} type="button" className="suggestion-btn" onClick={() => setDraft(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={message.id || `${index}-${message.role}`} className={`chat-msg ${message.role}${message.source ? ' is-proactive' : ''}`}>
                {message.source && (
                  <div className="chat-proactive-meta">
                    <Sparkles size={12} />
                    <span>{message.source === 'follow-up' ? `${agentName} 主动跟进` : `${agentName} 主动消息`}</span>
                    {message.createdAt && <time dateTime={message.createdAt}>{formatRunTime(message.createdAt)}</time>}
                    {message.goalId && goalsById.get(message.goalId) && <em><Target size={11} />{goalsById.get(message.goalId)?.title}</em>}
                  </div>
                )}
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
                  <p>待办、日历、备忘录、资料库、当前目标、已审核记忆和相关 Skill</p>
                  <small>创建目标、待办、候选记忆和候选 Skill 前，仍会请求你的确认。</small>
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
  const isGoal = proposal.kind === 'create_goal';
  const isMemory = proposal.kind === 'create_memory_candidate';
  const isSkill = proposal.kind === 'create_skill_candidate';
  const isEmail = proposal.kind === 'send_email';
  const isGithubIssue = proposal.kind === 'github_create_issue';
  const isMusicPlaylistChange = proposal.kind === 'add_music_to_playlist' || proposal.kind === 'remove_music_from_playlist';
  const isMusicPlaylistAdd = proposal.kind === 'add_music_to_playlist';
  const icon = isTodo
    ? <ListTodo size={17} />
    : isImportantDate
      ? <CalendarDays size={17} />
      : isPreference
        ? <Settings2 size={17} />
        : isGoal
          ? <Target size={17} />
          : isMemory
            ? <Brain size={17} />
              : isSkill
                ? <WandSparkles size={17} />
                : isGithubIssue
                  ? <FileText size={17} />
                : isEmail
                  ? <Mail size={17} />
                : isMusicPlaylistChange
                ? <ListPlus size={17} />
                : <StickyNote size={17} />;
  const title = isTodo
    ? '添加待办'
    : isImportantDate
      ? '记住重要日期'
      : isPreference
        ? '加入候选工作偏好'
        : isGoal
          ? '创建持续目标'
          : isMemory
            ? '加入候选长期记忆'
          : isSkill
            ? '加入候选 Skill'
            : isGithubIssue
              ? '创建 GitHub issue'
            : isEmail
              ? '发送邮件'
            : isMusicPlaylistChange
              ? (isMusicPlaylistAdd ? '添加到网易云歌单' : '从网易云歌单移除')
              : '保存备忘录';
  const body = isPreference
    ? proposal.preference
    : isMemory
      ? proposal.content
      : isSkill
        ? proposal.name
        : isGithubIssue
          ? proposal.arguments.title
        : isEmail
          ? `“${proposal.subject}”`
        : isMusicPlaylistChange
          ? `“${proposal.trackTitle}”`
        : proposal.title;
  return (
    <aside className="agent-proposal" aria-label="待确认操作">
      <div className="agent-proposal-icon">{icon}</div>
      <div className="agent-proposal-content">
        <span>待确认</span>
        <strong>{title}</strong>
        <p>{body}</p>
        {isTodo ? (
          <small>{priorityLabel[proposal.priority]}{proposal.due ? ` · ${new Date(proposal.due).toLocaleString('zh-CN', { hour12: false })}` : ''}{proposal.goalId ? ' · 会关联到当前目标' : ''}</small>
        ) : isImportantDate ? (
          <small>每年 {proposal.date}</small>
        ) : isPreference ? (
          <small>确认后进入候选记忆区，审核采纳后才会生效。</small>
        ) : isGoal ? (
          <small>{proposal.description || '创建后可关联待办、主动建议和手动跟进行动。'}{proposal.targetDate ? ` · 目标日期 ${new Date(proposal.targetDate).toLocaleString('zh-CN', { hour12: false })}` : ''}</small>
        ) : isMemory ? (
          <small>确认后进入候选区，审核采纳后才会影响后续对话。{proposal.validUntil ? `有效期至 ${new Date(proposal.validUntil).toLocaleString('zh-CN', { hour12: false })}。` : ''}</small>
        ) : isSkill ? (
          <small>{proposal.description} · 确认后仍需审核启用。</small>
        ) : isGithubIssue ? (
          <div className="agent-github-proposal">
            <small>仓库：{proposal.arguments.owner}/{proposal.arguments.repo} · 确认后会提交到 GitHub。</small>
            {proposal.arguments.body && <details><summary>查看 issue 正文</summary><pre>{proposal.arguments.body}</pre></details>}
          </div>
        ) : isEmail ? (
          <small>收件人：{proposal.to}{proposal.cc ? ` · 抄送：${proposal.cc}` : ''} · 确认后会通过已配置的 SMTP 账户发出。</small>
        ) : isMusicPlaylistChange ? (
          <small>{isMusicPlaylistAdd ? '添加到' : '从'}「{proposal.playlistName}」{isMusicPlaylistAdd ? '，确认后会同步到网易云音乐。' : '移除，确认后会同步到网易云音乐。'}</small>
        ) : (
          <small>{proposal.content}</small>
        )}
      </div>
      <div className="agent-proposal-actions">
        <button type="button" className="text-btn" onClick={onCancel} disabled={busy}>取消</button>
        <button type="button" className="btn-primary agent-confirm" onClick={onConfirm} disabled={busy}><Check size={15} />{busy ? '同步中' : isGithubIssue ? '确认创建' : isEmail ? '确认发送' : isMusicPlaylistChange ? '确认同步' : '确认保存'}</button>
      </div>
    </aside>
  );
}

function shortDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDateTimeInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function AgentGoalsPanel({
  goals,
  open,
  composerOpen,
  goalTitle,
  goalDescription,
  goalTargetDate,
  actionTargetId,
  actionTitle,
  actionFollowUpAt,
  actionOutcomeDrafts,
  completionTargetId,
  goalOutcomeDraft,
  busy,
  onToggle,
  onToggleComposer,
  onGoalTitleChange,
  onGoalDescriptionChange,
  onGoalTargetDateChange,
  onCreateGoal,
  onStatusChange,
  onBeginCompletion,
  onCancelCompletion,
  onGoalOutcomeChange,
  onCompleteGoal,
  onActionTargetChange,
  onActionTitleChange,
  onActionFollowUpAtChange,
  onAddAction,
  onOutcomeChange,
  onActionStatusChange,
}: {
  goals: AgentGoal[];
  open: boolean;
  composerOpen: boolean;
  goalTitle: string;
  goalDescription: string;
  goalTargetDate: string;
  actionTargetId: string | null;
  actionTitle: string;
  actionFollowUpAt: string;
  actionOutcomeDrafts: Record<string, string>;
  completionTargetId: string | null;
  goalOutcomeDraft: string;
  busy: boolean;
  onToggle: () => void;
  onToggleComposer: () => void;
  onGoalTitleChange: (value: string) => void;
  onGoalDescriptionChange: (value: string) => void;
  onGoalTargetDateChange: (value: string) => void;
  onCreateGoal: (event: FormEvent) => void;
  onStatusChange: (id: string, status: AgentGoalStatus) => void | Promise<boolean>;
  onBeginCompletion: (goal: AgentGoal) => void;
  onCancelCompletion: () => void;
  onGoalOutcomeChange: (value: string) => void;
  onCompleteGoal: (event: FormEvent, id: string) => void;
  onActionTargetChange: (id: string) => void;
  onActionTitleChange: (value: string) => void;
  onActionFollowUpAtChange: (value: string) => void;
  onAddAction: (event: FormEvent) => void;
  onOutcomeChange: (id: string, value: string) => void;
  onActionStatusChange: (action: AgentGoalAction, status: AgentGoalActionStatus) => void;
}) {
  const visibleGoals = goals;
  return (
    <section className={`agent-goals${open ? ' is-open' : ''}`} aria-label="目标与跟进">
      <div className="agent-goals-head">
        <button type="button" className="agent-goals-trigger" onClick={onToggle} aria-expanded={open} aria-controls="agent-goals-content">
          <span><Target size={14} />当前目标 <small>{goals.filter((goal) => goal.status === 'active').length} 个进行中</small></span>
          <ChevronDown size={14} />
        </button>
        <button type="button" className="text-btn agent-goals-add" onClick={onToggleComposer} disabled={busy}><Plus size={14} />新目标</button>
      </div>
      {open && (
        <div id="agent-goals-content" className="agent-goals-content">
          {composerOpen && (
            <form className="agent-goal-form" onSubmit={onCreateGoal}>
              <input value={goalTitle} onChange={(event) => onGoalTitleChange(event.target.value)} placeholder="例如：在本周完成项目方案" maxLength={160} autoFocus />
              <textarea value={goalDescription} onChange={(event) => onGoalDescriptionChange(event.target.value)} placeholder="成功标准、范围或背景（可选）" maxLength={1200} rows={2} />
              <div>
                <label>目标日期<input type="datetime-local" value={goalTargetDate} onChange={(event) => onGoalTargetDateChange(event.target.value)} /></label>
                <button type="submit" className="btn-primary" disabled={busy || !goalTitle.trim()}><Check size={14} />创建目标</button>
              </div>
            </form>
          )}
          {visibleGoals.length === 0 ? (
            <div className="agent-goals-empty">
              <Target size={17} />
              <div className="agent-goals-empty-copy">
                <strong>还没有持续目标</strong>
                <p>新建目标，或在聊天中让 Agent 帮你建立。</p>
              </div>
            </div>
          ) : (
            <div className="agent-goal-list">
              {visibleGoals.map((goal) => (
                <article key={goal.id} className={`agent-goal-card is-${goal.status}`}>
                  <div className="agent-goal-title-row">
                    <div>
                      <span className={`agent-goal-status is-${goal.status}`}>{goalStatusLabel[goal.status]}</span>
                      <h3>{goal.title}</h3>
                    </div>
                    <div className="agent-goal-actions">
                      {goal.status === 'active' && <button type="button" className="text-btn" onClick={() => onStatusChange(goal.id, 'paused')} disabled={busy}><Pause size={13} />暂停</button>}
                      {goal.status === 'paused' && <button type="button" className="text-btn" onClick={() => onStatusChange(goal.id, 'active')} disabled={busy}><RotateCcw size={13} />继续</button>}
                      {['active', 'paused'].includes(goal.status) && <button type="button" className="text-btn agent-goal-complete" onClick={() => onBeginCompletion(goal)} disabled={busy}><CircleCheck size={13} />完成</button>}
                      {goal.status === 'completed' && <button type="button" className="text-btn" onClick={() => onStatusChange(goal.id, 'active')} disabled={busy}><RotateCcw size={13} />重新跟踪</button>}
                      {['active', 'paused', 'completed'].includes(goal.status) && <button type="button" className="text-btn" onClick={() => onStatusChange(goal.id, 'archived')} disabled={busy}><Archive size={13} />归档</button>}
                      {goal.status === 'archived' && <button type="button" className="text-btn" onClick={() => onStatusChange(goal.id, 'active')} disabled={busy}><RotateCcw size={13} />恢复跟踪</button>}
                    </div>
                  </div>
                  {goal.description && <p className="agent-goal-description">{goal.description}</p>}
                  {goal.outcome && <p className="agent-goal-outcome"><CircleCheck size={13} />{goal.status === 'completed' ? '完成结果' : '最近结果'}：{goal.outcome}</p>}
                  <div className="agent-goal-progress" aria-label={`${goal.title} 进度 ${goal.summary.progress}%`}>
                    <span><strong>{goal.summary.progress}%</strong> · {goal.summary.completed}/{goal.summary.total || 0} 项行动已完成</span>
                    <i><b style={{ width: `${goal.summary.progress}%` }} /></i>
                    {goal.completedAt ? <time dateTime={goal.completedAt}>完成于 {shortDate(goal.completedAt)}</time> : goal.targetDate ? <time dateTime={goal.targetDate}>目标日期 {shortDate(goal.targetDate)}</time> : null}
                  </div>
                  {completionTargetId === goal.id && (
                    <form className="agent-goal-complete-form" onSubmit={(event) => onCompleteGoal(event, goal.id)}>
                      <input value={goalOutcomeDraft} onChange={(event) => onGoalOutcomeChange(event.target.value)} placeholder="完成结果或成功判断（可选）" maxLength={1200} autoFocus />
                      <button type="submit" className="btn-primary" disabled={busy}><CircleCheck size={13} />确认完成</button>
                      <button type="button" className="text-btn" onClick={onCancelCompletion} disabled={busy}>取消</button>
                    </form>
                  )}
                  {goal.actions.length > 0 && (
                    <div className="agent-goal-followups" aria-label={`${goal.title} 的跟进行动`}>
                      {goal.actions.slice(0, 8).map((action) => (
                        <div key={action.id} className={`agent-goal-followup is-${action.status}`}>
                          <span className="agent-goal-followup-icon">{action.status === 'completed' ? <Check size={12} /> : action.type === 'todo' ? <ListTodo size={12} /> : action.type === 'suggestion' ? <Sparkles size={12} /> : <Clock3 size={12} />}</span>
                          <div className="agent-goal-followup-copy">
                            <strong>{action.title}</strong>
                            <small>{action.type === 'todo' ? '关联待办' : action.type === 'suggestion' ? '主动建议' : '手动跟进'} · {actionStatusLabel[action.status]}{action.followUpAt ? ` · ${shortDate(action.followUpAt)}` : ''}</small>
                            {action.outcome && <em>结果：{action.outcome}</em>}
                          </div>
                          {action.type === 'follow-up' && action.status === 'pending' ? (
                            <div className="agent-followup-complete">
                              <input value={actionOutcomeDrafts[action.id] || ''} onChange={(event) => onOutcomeChange(action.id, event.target.value)} placeholder="结果（可选）" maxLength={1200} />
                              <button type="button" className="text-btn" onClick={() => onActionStatusChange(action, 'completed')} disabled={busy}><Check size={13} />完成</button>
                            </div>
                          ) : action.type === 'follow-up' && action.status === 'completed' ? (
                            <button type="button" className="text-btn" onClick={() => onActionStatusChange(action, 'pending')} disabled={busy}><RotateCcw size={13} />重新打开</button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {goal.status === 'active' && (
                    <>
                      <button type="button" className="text-btn agent-goal-add-followup" onClick={() => onActionTargetChange(goal.id)} disabled={busy}><Plus size={13} />添加跟进</button>
                      {actionTargetId === goal.id && (
                        <form className="agent-goal-followup-form" onSubmit={onAddAction}>
                          <input value={actionTitle} onChange={(event) => onActionTitleChange(event.target.value)} placeholder="下一步要跟进什么？" maxLength={240} autoFocus />
                          <input type="datetime-local" value={actionFollowUpAt} onChange={(event) => onActionFollowUpAtChange(event.target.value)} aria-label="跟进时间" />
                          <button type="submit" className="btn-primary" disabled={busy || !actionTitle.trim()}><Check size={13} />加入</button>
                        </form>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AgentKnowledgePanel({
  memories,
  skills,
  open,
  pendingCount,
  busy,
  onToggle,
  onReviewMemory,
  onReviewSkill,
  onUpdateMemory,
  editingMemoryId,
  memoryDraft,
  onStartMemoryEdit,
  onCancelMemoryEdit,
  onMemoryDraftChange,
}: {
  memories: AgentMemory[];
  skills: AgentSkill[];
  open: boolean;
  pendingCount: number;
  busy: boolean;
  onToggle: () => void;
  onReviewMemory: (id: string, decision: AgentMemoryDecision) => void;
  onReviewSkill: (id: string, decision: 'activate' | 'reject' | 'archive' | 'restore') => void;
  onUpdateMemory: (id: string, content: string) => void;
  editingMemoryId: string | null;
  memoryDraft: string;
  onStartMemoryEdit: (memory: AgentMemory) => void;
  onCancelMemoryEdit: () => void;
  onMemoryDraftChange: (value: string) => void;
}) {
  const candidateMemories = memories.filter((memory) => memory.status === 'candidate');
  const activeMemories = memories.filter((memory) => memory.status === 'active');
  const archivedMemories = memories.filter((memory) => memory.status === 'archived');
  const candidateSkills = skills.filter((skill) => skill.status === 'candidate');
  const activeSkills = skills.filter((skill) => skill.status === 'active');
  const archivedSkills = skills.filter((skill) => skill.status === 'archived');
  const pinnedMemories = activeMemories.filter((memory) => memory.pinned);
  const memoryKindLabel = (kind: AgentMemory['kind']) => (kind === 'preference' ? '偏好' : kind === 'fact' ? '事实' : '工作规则');
  const memoryMeta = (memory: AgentMemory) => [
    memory.pinned ? '已置顶，每次对话都会带上' : '',
    memory.usageCount ? `已使用 ${memory.usageCount} 次` : '',
    memory.validUntil
      ? `${memory.expired ? '已过期' : '有效期至'} ${new Date(memory.validUntil).toLocaleString('zh-CN', { hour12: false })}`
      : '',
    memory.stale ? '超过 30 天未被使用，可考虑归档' : '',
  ].filter(Boolean).join(' · ');
  const memorySupersedeNote = (memory: AgentMemory) => (
    memory.similarIds?.length ? `采纳后将归档 ${memory.similarIds.length} 条内容相近的旧记忆` : ''
  );
  return (
    <section className={`agent-knowledge${open ? ' is-open' : ''}`} aria-label="记忆与 Skill">
      <button type="button" className="agent-knowledge-trigger" onClick={onToggle} aria-expanded={open} aria-controls="agent-knowledge-content">
        <span><Brain size={14} />记忆与 Skill{pendingCount > 0 && <small>{pendingCount} 项待审核</small>}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div id="agent-knowledge-content" className="agent-knowledge-content">
          {(candidateMemories.length > 0 || candidateSkills.length > 0) && (
            <div className="agent-knowledge-group is-candidates">
              <h3>待审核</h3>
              {candidateMemories.map((memory) => (
                <article key={memory.id} className="agent-knowledge-item">
                  <Brain size={15} />
                  <div><strong>候选记忆</strong><p>{memory.content}</p><small>{[memoryKindLabel(memory.kind), memoryMeta(memory), memorySupersedeNote(memory)].filter(Boolean).join(' · ')}</small></div>
                  <div className="agent-knowledge-actions"><button type="button" className="text-btn agent-knowledge-approve" onClick={() => onReviewMemory(memory.id, 'activate')} disabled={busy}><Check size={13} />采纳</button><button type="button" className="text-btn" onClick={() => onReviewMemory(memory.id, 'reject')} disabled={busy}>丢弃</button></div>
                </article>
              ))}
              {candidateSkills.map((skill) => (
                <article key={skill.id} className="agent-knowledge-item">
                  <WandSparkles size={15} />
                  <div><strong>候选 Skill · {skill.name}</strong><p>{skill.description}</p><details><summary>查看步骤</summary><pre>{skill.instructions}</pre></details></div>
                  <div className="agent-knowledge-actions"><button type="button" className="text-btn agent-knowledge-approve" onClick={() => onReviewSkill(skill.id, 'activate')} disabled={busy}><Check size={13} />启用</button><button type="button" className="text-btn" onClick={() => onReviewSkill(skill.id, 'reject')} disabled={busy}>丢弃</button></div>
                </article>
              ))}
            </div>
          )}
          <div className="agent-knowledge-group">
            <h3>长期记忆{pinnedMemories.length ? `（已置顶 ${pinnedMemories.length} 条，每轮最多带入 6 条）` : ''}</h3>
            {activeMemories.length ? activeMemories.map((memory) => (
              <article key={memory.id} className="agent-knowledge-item is-active">
                <Brain size={15} />
                {editingMemoryId === memory.id ? (
                  <form
                    className="agent-knowledge-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onUpdateMemory(memory.id, memoryDraft);
                    }}
                  >
                    <textarea value={memoryDraft} onChange={(event) => onMemoryDraftChange(event.target.value)} rows={2} maxLength={600} autoFocus />
                    <div className="agent-knowledge-actions">
                      <button type="submit" className="text-btn agent-knowledge-approve" disabled={busy || !memoryDraft.trim()}><Check size={13} />保存</button>
                      <button type="button" className="text-btn" onClick={onCancelMemoryEdit} disabled={busy}>取消</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div><strong>{memoryKindLabel(memory.kind)}</strong><p>{memory.content}</p>{memoryMeta(memory) && <small>{memoryMeta(memory)}</small>}</div>
                    <div className="agent-knowledge-actions">
                      <button type="button" className="text-btn" onClick={() => onStartMemoryEdit(memory)} disabled={busy}><Pencil size={13} />编辑</button>
                      <button type="button" className="text-btn" onClick={() => onReviewMemory(memory.id, memory.pinned ? 'unpin' : 'pin')} disabled={busy}><Pin size={13} />{memory.pinned ? '取消置顶' : '置顶'}</button>
                      <button type="button" className="text-btn" onClick={() => onReviewMemory(memory.id, 'archive')} disabled={busy}><Archive size={13} />归档</button>
                    </div>
                  </>
                )}
              </article>
            )) : <p className="agent-knowledge-empty">暂无长期记忆</p>}
          </div>
          <div className="agent-knowledge-group">
            <h3>已启用的 Skill</h3>
            {activeSkills.length ? activeSkills.map((skill) => (
              <article key={skill.id} className="agent-knowledge-item is-active">
                <WandSparkles size={15} />
                <div><strong>{skill.name}</strong><p>{skill.description}</p><small>已按需使用 {skill.usageCount || 0} 次</small><details><summary>查看步骤</summary><pre>{skill.instructions}</pre></details></div>
                <button type="button" className="text-btn" onClick={() => onReviewSkill(skill.id, 'archive')} disabled={busy}><Archive size={13} />停用</button>
              </article>
            )) : <p className="agent-knowledge-empty">暂无已启用的 Skill</p>}
          </div>
          {(archivedMemories.length > 0 || archivedSkills.length > 0) && (
            <div className="agent-knowledge-group">
              <h3>已归档（不会进入 Agent 上下文）</h3>
              {archivedMemories.map((memory) => (
                <article key={memory.id} className="agent-knowledge-item is-active">
                  <Brain size={15} />
                  <div>
                    <strong>记忆 · {memoryKindLabel(memory.kind)}</strong>
                    <p>{memory.content}</p>
                    {memory.archivedReason === 'capacity' && <small>因超出容量归档，恢复后仍可继续使用</small>}
                  </div>
                  <button type="button" className="text-btn" onClick={() => onReviewMemory(memory.id, 'restore')} disabled={busy}><RotateCcw size={13} />恢复</button>
                </article>
              ))}
              {archivedSkills.map((skill) => (
                <article key={skill.id} className="agent-knowledge-item is-active">
                  <WandSparkles size={15} />
                  <div><strong>Skill · {skill.name}</strong><p>{skill.description}</p></div>
                  <button type="button" className="text-btn" onClick={() => onReviewSkill(skill.id, 'restore')} disabled={busy}><RotateCcw size={13} />恢复</button>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
