const store = require('./store.cjs');
const agent = require('./agent.cjs');
const agentState = require('./agent-state.cjs');
const operations = require('./operations.cjs');
const secrets = require('./secrets.cjs');
const notifier = require('./notifier.cjs');
const mail = require('./mail.cjs');

const CHECK_INTERVAL = 60_000;
// IMAP 轮询而非常驻 IDLE：每 30 秒检查一次，在及时性与常驻连接稳定性之间取平衡。
const MAIL_CHECK_INTERVAL = 30_000;
const EVENT_DEBOUNCE = 15_000;
const MAX_EVENT_RUNS_PER_DAY = 3;
const MAX_RUNS = 120;
const MAX_SUGGESTIONS = 40;
const MAX_SUGGESTION_HISTORY = 20;
const MAX_AGENT_MESSAGES = 120;
const MAX_NOTIFICATION_HISTORY = 500;
const MAX_TIMER_DELAY = 2_147_483_647;
const DAILY_TRIGGER = 'daily-briefing';
const EVENT_TRIGGER = 'event-follow-up';
const MAIL_TRIGGER = 'mail-triage';
const MAIL_PRIORITY_LABEL = { high: '高优先级邮件', medium: '中优先级邮件', low: '低优先级邮件' };

let checkTimer = null;
let mailCheckTimer = null;
let eventTimer = null;
let followUpTimer = null;
let pendingWake = '';
let running = false;
let mailRunning = false;
let onUpdated = () => {};
let onOpenAgent = () => {};
let onAlert = () => {};

function localDateKey(timestamp = new Date()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getAgentSettings() {
  return secrets.withDecryptedAgentApiKey(store.getSettings());
}

function listSuggestions() {
  return store.getModule('agentSuggestions')
    .filter((suggestion) => !['dismissed', 'acted'].includes(suggestion.status))
    .filter((suggestion) => {
      if (!suggestion.followUpAt) return true;
      const followUpAt = new Date(suggestion.followUpAt).getTime();
      return Number.isNaN(followUpAt) || followUpAt <= Date.now();
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_SUGGESTIONS);
}

function listSuggestionHistory() {
  return store.getModule('agentSuggestions')
    .filter((suggestion) => ['dismissed', 'acted'].includes(suggestion.status))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, MAX_SUGGESTION_HISTORY);
}

function dailyNotificationCount(now = new Date()) {
  const dateKey = localDateKey(now);
  return store.getModule('notificationHistory').filter((item) => localDateKey(item.sentAt) === dateKey).length;
}

function availableNotificationSlots(settings, now = new Date()) {
  const configuredLimit = Number(settings.notify?.maxDailyNotifications);
  const limit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 5;
  return Math.max(0, limit - dailyNotificationCount(now));
}

function normaliseFollowUpAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function quietHoursEndAt(quietHours, now) {
  if (!notifier.isWithinQuietHours(quietHours, now)) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(quietHours?.end || '');
  if (!match) return null;
  const endHour = Number(match[1]);
  const endMinute = Number(match[2]);
  if (endHour > 23 || endMinute > 59) return null;
  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

function nextLocalDayStart(now) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 1, 0, 0);
  return next;
}

function dueFollowUps(now = new Date()) {
  const nowTime = now.getTime();
  return store.getModule('agentSuggestions')
    .filter((suggestion) => !['dismissed', 'acted'].includes(suggestion.status) && suggestion.followUpAt)
    .filter((suggestion) => {
      const followUpAt = new Date(suggestion.followUpAt).getTime();
      return Number.isFinite(followUpAt) && followUpAt <= nowTime;
    })
    .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));
}

function recordSuggestionNotification(suggestion, now, phase) {
  const persona = agent.getPersona(store.getSettings());
  store.updateModule('notificationHistory', (history) => [
    {
      id: store.newId(),
      eventKey: `agent-suggestion:${suggestion.id}:${phase}`,
      title: `${persona.name} 主动消息`,
      body: `${suggestion.title}\n${suggestion.summary}`.slice(0, 300),
      sentAt: now.toISOString(),
    },
    ...history,
  ].slice(0, MAX_NOTIFICATION_HISTORY));
}

function scheduleFollowUpWake() {
  if (followUpTimer) {
    clearTimeout(followUpTimer);
    followUpTimer = null;
  }
  const now = new Date();
  const settings = store.getSettings();
  if (settings.agent?.proactiveEnabled === false) return;
  const suggestions = store.getModule('agentSuggestions')
    .filter((suggestion) => !['dismissed', 'acted'].includes(suggestion.status) && suggestion.followUpAt);
  const due = dueFollowUps(now);
  let nextFollowUpAt = suggestions
    .map((suggestion) => new Date(suggestion.followUpAt).getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now.getTime())
    .sort((a, b) => a - b)[0];
  if (due.length) {
    const quietEnd = quietHoursEndAt(settings.notify?.quietHours, now);
    nextFollowUpAt = quietEnd
      ? quietEnd.getTime()
      : availableNotificationSlots(settings, now) > 0
        ? now.getTime() + 1_000
        : nextLocalDayStart(now).getTime();
  }
  if (!nextFollowUpAt) return;
  const delay = Math.min(Math.max(nextFollowUpAt - now.getTime(), 1_000), MAX_TIMER_DELAY);
  followUpTimer = setTimeout(() => {
    followUpTimer = null;
    deliverDueFollowUps();
    scheduleFollowUpWake();
  }, delay);
  followUpTimer.unref?.();
}

function notifyUpdated() {
  try {
    onUpdated();
  } catch (error) {
    console.error('[proactive] 更新通知失败:', error.message);
  }
}

function announceAlert(suggestion, directMessage, phase) {
  const messageId = String(directMessage?.id || suggestion?.messageId || '').trim();
  if (!suggestion || !messageId) return;
  try {
    onAlert({
      messageId,
      phase: phase === 'follow-up' ? 'follow-up' : 'initial',
      title: String(suggestion.title || '').slice(0, 160),
      summary: String(suggestion.summary || '').slice(0, 300),
      reason: String(suggestion.reason || '').slice(0, 300),
      ...(normaliseMailPriority(suggestion.priority) ? { priority: suggestion.priority } : {}),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[proactive] 主动提醒送达失败:', error.message);
  }
}

function countRunsForDate(trigger, dateKey) {
  return store.getModule('agentRuns').filter((run) => (
    run.trigger === trigger
    && run.dateKey === dateKey
    && ['running', 'completed', 'failed'].includes(run.status)
  )).length;
}

function hasRunForDate(dateKey, trigger = DAILY_TRIGGER) {
  return countRunsForDate(trigger, dateKey) > 0;
}

function addRun(dateKey, now, trigger = DAILY_TRIGGER, sourceKey = '') {
  const run = {
    id: store.newId(),
    trigger,
    dateKey,
    ...(sourceKey ? { sourceKey } : {}),
    status: 'running',
    startedAt: now.toISOString(),
    finishedAt: null,
    suggestionId: null,
  };
  store.updateModule('agentRuns', (runs) => [run, ...runs].slice(0, MAX_RUNS));
  return run;
}

function finishRun(id, patch) {
  const finishedAt = new Date().toISOString();
  store.updateModule('agentRuns', (runs) => runs.map((run) => (
    run.id === id ? { ...run, ...patch, finishedAt } : run
  )));
}

function normaliseRunContext(value) {
  const allowed = new Set(['todos', 'schedule', 'notes', 'library', 'current-time', 'goals', 'memories', 'skills', 'mail']);
  return Array.isArray(value) ? value.filter((item) => allowed.has(item)) : [];
}

function normaliseMailPriority(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : null;
}

function directMessageContent(suggestion, phase) {
  const persona = agent.getPersona(store.getSettings());
  const isFollowUp = phase === 'follow-up';
  const intro = isFollowUp
    ? `${persona.name} 来跟进一下「${suggestion.title}」。`
    : `${persona.name} 想主动和你说一件事：「${suggestion.title}」。`;
  const reason = String(suggestion.reason || '').trim();
  const mailPriority = suggestion.trigger === MAIL_TRIGGER ? normaliseMailPriority(suggestion.priority) : null;
  const closing = suggestion.proposal
    ? persona.proactiveStyle === 'important'
      ? '需要的话，我可以帮你安排下一步。'
      : '如果你愿意，我可以继续帮你安排下一步。'
    : persona.proactiveStyle === 'companion'
      ? '如果方便，直接告诉我你现在的进展；我会继续陪你一起推进。'
      : '你可以直接回复我当前进展，我会继续和你一起推进。';
  return [intro, mailPriority ? `我将它归为${MAIL_PRIORITY_LABEL[mailPriority]}。` : '', String(suggestion.summary || '').trim(), reason ? `我注意到：${reason}` : '', closing]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 1800);
}

function listDirectMessages() {
  return store.getModule('agentMessages')
    .filter((message) => message && message.id && message.suggestionId && message.content)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function saveDirectMessage(suggestion, now, phase = 'initial') {
  const existing = listDirectMessages().find((message) => message.suggestionId === suggestion.id && message.phase === phase);
  if (existing) return existing;
  const linkedConversationId = phase === 'follow-up'
    ? listDirectMessages().find((message) => message.suggestionId === suggestion.id && message.phase === 'initial')?.conversationId || `proactive-${suggestion.id}`
    : `proactive-${suggestion.id}`;
  const message = {
    id: store.newId(),
    phase,
    suggestionId: suggestion.id,
    goalId: suggestion.goalId || null,
    title: phase === 'follow-up' ? `跟进：${suggestion.title}` : suggestion.title,
    content: directMessageContent(suggestion, phase),
    proposal: suggestion.proposal || null,
    createdAt: now.toISOString(),
    readAt: null,
    conversationId: linkedConversationId,
  };
  store.updateModule('agentMessages', (messages) => [message, ...messages].slice(0, MAX_AGENT_MESSAGES));
  return message;
}

function markDirectMessageRead(id, conversationId) {
  const messageId = String(id || '').trim();
  const nextConversationId = String(conversationId || '').trim().slice(0, 160);
  const current = listDirectMessages().find((message) => message.id === messageId);
  if (!current || !nextConversationId) return null;
  const effectiveConversationId = current.conversationId || nextConversationId;
  const readAt = current.readAt || new Date().toISOString();
  store.updateModule('agentMessages', (messages) => messages.map((message) => (
    message.id === current.id || message.conversationId === effectiveConversationId
      ? { ...message, readAt: message.readAt || readAt, conversationId: message.conversationId || effectiveConversationId }
      : message
  )));
  const linkedSuggestion = store.getModule('agentSuggestions').find((suggestion) => suggestion.id === current.suggestionId);
  if (linkedSuggestion?.status === 'unread') {
    const now = new Date().toISOString();
    store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => (
      suggestion.id === linkedSuggestion.id ? { ...suggestion, status: 'read', updatedAt: now } : suggestion
    )));
  }
  return listDirectMessages().find((message) => message.id === current.id) || null;
}

function markSuggestionMessagesRead(suggestionId) {
  const id = String(suggestionId || '').trim();
  if (!id) return;
  const now = new Date().toISOString();
  store.updateModule('agentMessages', (messages) => messages.map((message) => (
    message.suggestionId === id && !message.readAt ? { ...message, readAt: now } : message
  )));
}

function saveSuggestion(result, now, options = {}) {
  const trigger = [EVENT_TRIGGER, MAIL_TRIGGER].includes(options.trigger) ? options.trigger : DAILY_TRIGGER;
  const dateKey = localDateKey(now);
  const dedupeKey = options.dedupeKey || `${trigger}:${dateKey}`;
  const existing = store.getModule('agentSuggestions').find((suggestion) => suggestion.dedupeKey === dedupeKey);
  if (existing) return existing;
  const proposal = result.proposal && typeof result.proposal === 'object'
    ? (result.proposal.operationId
      ? result.proposal
      : { ...result.proposal, operationId: operations.prepare('agent:confirm', result.proposal).id })
    : null;
  const suggestion = {
    id: store.newId(),
    dedupeKey,
    trigger,
    title: result.title,
    summary: result.summary,
    reason: result.reason,
    references: result.references || [],
    proposal,
    priority: trigger === MAIL_TRIGGER ? normaliseMailPriority(result.priority) : null,
    goalId: result.goalId || proposal?.goalId || null,
    status: 'unread',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    notifiedAt: null,
    followUpAt: normaliseFollowUpAt(result.followUpAt) || null,
  };
  store.updateModule('agentSuggestions', (suggestions) => [suggestion, ...suggestions].slice(0, MAX_SUGGESTIONS));
  const directMessage = saveDirectMessage(suggestion, now);
  const savedSuggestion = store.updateModule('agentSuggestions', (suggestions) => suggestions.map((item) => (
    item.id === suggestion.id ? { ...item, messageId: directMessage.id } : item
  ))).find((item) => item.id === suggestion.id) || { ...suggestion, messageId: directMessage.id };
  if (savedSuggestion.goalId) agentState.linkSuggestion(savedSuggestion.goalId, savedSuggestion);
  scheduleFollowUpWake();
  return savedSuggestion;
}

function markNotified(id, now) {
  const suggestion = store.getModule('agentSuggestions').find((item) => item.id === id);
  if (!suggestion) return;
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => (
    suggestion.id === id ? { ...suggestion, notifiedAt: now.toISOString(), updatedAt: now.toISOString() } : suggestion
  )));
  recordSuggestionNotification(suggestion, now, 'initial');
}

/**
 * 将关键待办提醒稳定地写入 Agent 消息流。
 * 这条路径不依赖模型请求：截止/超期属于确定性事件，不能因模型超时、每日简报已运行或事件额度耗尽而漏发。
 */
function notifyTodoReminder(notification, now = new Date()) {
  const todoId = String(notification?.todoId || '').trim();
  const todoTitle = String(notification?.todoTitle || '').trim();
  const urgency = notification?.urgency;
  if (!todoId || !todoTitle || !['urgent', 'overdue'].includes(urgency)) return null;
  if (store.getSettings().agent?.proactiveEnabled === false) return null;

  const isOverdue = urgency === 'overdue';
  const suggestion = saveSuggestion({
    title: `${isOverdue ? '任务已超期' : '任务即将到期'}：${todoTitle}`,
    summary: String(notification.body || '').trim() || `「${todoTitle}」${isOverdue ? '已超期' : '即将到期'}。`,
    reason: isOverdue
      ? '系统检测到该待办已越过截止时间，需要尽快处理。'
      : '系统检测到该待办将在 1 小时内到期，建议优先安排。',
    references: [{ type: 'todo', id: todoId, label: todoTitle }],
  }, now, {
    trigger: EVENT_TRIGGER,
    dedupeKey: `todo-reminder:${String(notification.eventKey || `${todoId}:${urgency}`)}`,
  });

  if (suggestion.notifiedAt) return suggestion;
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((item) => (
    item.id === suggestion.id ? { ...item, notifiedAt: now.toISOString(), updatedAt: now.toISOString() } : item
  )));
  const delivered = store.getModule('agentSuggestions').find((item) => item.id === suggestion.id) || suggestion;
  announceAlert(delivered, { id: delivered.messageId }, 'initial');
  notifyUpdated();
  return delivered;
}

function showDesktopNotification(suggestion, directMessage = null) {
  try {
    const { Notification } = require('electron');
    if (!Notification) return;
    if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return;
    const mailPriority = suggestion.trigger === MAIL_TRIGGER ? normaliseMailPriority(suggestion.priority) : null;
    const notification = new Notification({
      title: mailPriority
        ? `${agent.getPersona(store.getSettings()).name} · ${MAIL_PRIORITY_LABEL[mailPriority]}`
        : `${agent.getPersona(store.getSettings()).name} 主动消息`,
      body: `${suggestion.title}\n${suggestion.summary}`.slice(0, 300),
      // macOS uses the bundled system alert sound; other platforms safely ignore this option.
      ...(mailPriority === 'high' ? { sound: 'Glass' } : {}),
    });
    notification.on('click', () => onOpenAgent(directMessage?.id || suggestion.messageId || ''));
    notification.show();
  } catch (error) {
    console.error('[proactive] 桌面通知失败:', error.message);
  }
}

async function runCheck({
  trigger = DAILY_TRIGGER,
  force = false,
  now: requestedNow,
  notify = true,
  changeSummary = '',
  sourceKey = '',
  dedupeKey = '',
} = {}) {
  if (running) return listSuggestions();
  const settings = getAgentSettings();
  if (!agent.getStatus(settings)) return listSuggestions();
  if (settings.agent?.proactiveEnabled === false) return listSuggestions();
  const now = requestedNow instanceof Date ? requestedNow : new Date();
  if (notifier.isWithinQuietHours(settings.notify?.quietHours, now)) return listSuggestions();
  const dateKey = localDateKey(now);
  if (trigger === DAILY_TRIGGER && !force && hasRunForDate(dateKey, DAILY_TRIGGER)) return listSuggestions();
  if (trigger === EVENT_TRIGGER && countRunsForDate(EVENT_TRIGGER, dateKey) >= MAX_EVENT_RUNS_PER_DAY) return listSuggestions();

  running = true;
  const run = addRun(dateKey, now, trigger, sourceKey);
  notifyUpdated();
  try {
    const result = await agent.runProactive(settings, now, { trigger, changeSummary });
    if (result.action === 'notify') {
      const suggestion = saveSuggestion(result, now, {
        trigger,
        dedupeKey: dedupeKey || (trigger === DAILY_TRIGGER
          ? `${DAILY_TRIGGER}:${dateKey}`
          : `${EVENT_TRIGGER}:${run.id}`),
      });
      let delivery = 'in-app';
      if (!suggestion.notifiedAt) {
        if (notify && availableNotificationSlots(settings, now) > 0) {
          const directMessage = { id: suggestion.messageId };
          showDesktopNotification(suggestion, directMessage);
          announceAlert(suggestion, directMessage, 'initial');
          markNotified(suggestion.id, now);
          delivery = 'desktop-notification';
        }
      }
      finishRun(run.id, {
        status: 'completed',
        suggestionId: suggestion.id,
        contextTypes: normaliseRunContext(result.contextTypes),
        decision: `生成建议：${suggestion.title}`,
        delivery,
      });
    } else {
      finishRun(run.id, {
        status: 'completed',
        suggestionId: null,
        contextTypes: normaliseRunContext(result.contextTypes),
        decision: '检查完成，当前没有需要即时提醒的事项。',
        delivery: 'none',
      });
    }
  } catch (error) {
    console.error('[proactive] 主动检查失败:', error.message);
    finishRun(run.id, {
      status: 'failed',
      suggestionId: null,
      decision: '检查未完成。',
      delivery: 'none',
      error: String(error.message || error).slice(0, 300),
    });
  } finally {
    running = false;
    notifyUpdated();
  }
  return listSuggestions();
}

function deliverDueFollowUps({ now = new Date(), deliver = showDesktopNotification } = {}) {
  const settings = store.getSettings();
  if (settings.agent?.proactiveEnabled === false) return 0;
  const due = dueFollowUps(now);
  if (!due.length || notifier.isWithinQuietHours(store.getSettings().notify?.quietHours, now)) return 0;
  const selected = due.slice(0, availableNotificationSlots(settings, now));
  if (!selected.length) return 0;
  const directMessages = new Map(selected.map((suggestion) => [suggestion.id, saveDirectMessage(suggestion, now, 'follow-up')]));
  selected.forEach((suggestion) => {
    const directMessage = directMessages.get(suggestion.id);
    deliver(suggestion, directMessage);
    announceAlert(suggestion, directMessage, 'follow-up');
  });
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => {
    if (!selected.some((item) => item.id === suggestion.id)) return suggestion;
    return {
      ...suggestion,
      followUpAt: null,
      notifiedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }));
  selected.forEach((suggestion) => recordSuggestionNotification(suggestion, now, 'follow-up'));
  notifyUpdated();
  return selected.length;
}

async function checkNow({ force = false, now: requestedNow, notify = true } = {}) {
  return runCheck({
    trigger: DAILY_TRIGGER,
    force,
    now: requestedNow,
    notify,
  });
}

async function checkEventNow({ sourceKey = '', changeSummary = '', now: requestedNow, notify = true } = {}) {
  return runCheck({
    trigger: EVENT_TRIGGER,
    now: requestedNow,
    notify,
    changeSummary,
    sourceKey,
  });
}

function wake({ source = 'workspace', detail = '' } = {}) {
  const sourceText = String(source || 'workspace').slice(0, 120);
  const detailText = String(detail || '').slice(0, 160);
  const entry = [sourceText, detailText].filter(Boolean).join('：');
  pendingWake = [pendingWake, entry].filter(Boolean).join('；').slice(-800);
  if (eventTimer) clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    const changeSummary = pendingWake;
    pendingWake = '';
    eventTimer = null;
    void checkEventNow({
      sourceKey: `batch:${Date.now()}`,
      changeSummary,
    });
  }, EVENT_DEBOUNCE);
}

function updateSuggestion(id, patch = {}) {
  const allowedStatuses = ['unread', 'read', 'dismissed', 'acted'];
  if (!allowedStatuses.includes(patch.status)) return listSuggestions();
  const hasFollowUpAt = Object.prototype.hasOwnProperty.call(patch, 'followUpAt');
  const followUpAt = hasFollowUpAt ? normaliseFollowUpAt(patch.followUpAt) : undefined;
  if (hasFollowUpAt && followUpAt === undefined) return listSuggestions();
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => {
    if (suggestion.id !== id) return suggestion;
    if (patch.status === 'acted' && !suggestion.proposal) return suggestion;
    return {
      ...suggestion,
      status: patch.status,
      ...(hasFollowUpAt ? { followUpAt } : {}),
      updatedAt: new Date().toISOString(),
    };
  }));
  const updated = store.getModule('agentSuggestions').find((suggestion) => suggestion.id === id);
  if (updated) {
    agentState.syncSuggestion(updated);
    if (['read', 'dismissed', 'acted'].includes(updated.status)) markSuggestionMessagesRead(updated.id);
  }
  scheduleFollowUpWake();
  notifyUpdated();
  return listSuggestions();
}

function linkSuggestionToGoal(id, goalId) {
  const suggestionId = String(id || '').trim();
  const goal = agentState.getGoal(String(goalId || '').trim());
  if (!goal || goal.status !== 'active') throw new Error('只能关联到进行中的目标');
  const current = store.getModule('agentSuggestions').find((suggestion) => suggestion.id === suggestionId);
  if (!current) throw new Error('主动建议不存在');
  if (current.goalId && current.goalId !== goal.id) throw new Error('这条建议已经关联到其他目标');
  const now = new Date().toISOString();
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => (
    suggestion.id === current.id ? { ...suggestion, goalId: goal.id, updatedAt: now } : suggestion
  )));
  const linked = store.getModule('agentSuggestions').find((suggestion) => suggestion.id === current.id);
  if (linked) agentState.linkSuggestion(goal.id, linked);
  notifyUpdated();
  return listSuggestions();
}

function getMailWatchState() {
  const saved = store.getModule('agentMailWatch');
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

function saveMailWatchState(state) {
  store.setModule('agentMailWatch', {
    account: String(state?.account || '').slice(0, 320),
    folder: String(state?.folder || '').slice(0, 240),
    uidValidity: Number.isSafeInteger(Number(state?.uidValidity)) ? Number(state.uidValidity) : 0,
    lastUid: Number.isSafeInteger(Number(state?.lastUid)) ? Number(state.lastUid) : 0,
    initialized: state?.initialized === true,
    updatedAt: new Date().toISOString(),
  });
}

function deliverMailSuggestion(suggestion, now, notify) {
  if (suggestion.notifiedAt || !notify) return 'in-app';
  const settings = store.getSettings();
  if (notifier.isWithinQuietHours(settings.notify?.quietHours, now)) return 'in-app';
  const directMessage = { id: suggestion.messageId };
  showDesktopNotification(suggestion, directMessage);
  announceAlert(suggestion, directMessage, 'initial');
  markNotified(suggestion.id, now);
  return 'desktop-notification';
}

/**
 * 用 IMAP UID 游标增量检查收件箱。首次启用或账号/UIDVALIDITY 改变时只建立基线，
 * 不回溯旧信，避免一次性对历史广告和旧招聘信制造提醒。
 */
async function checkInbox({
  now = new Date(),
  notify = true,
  mailApi = mail,
  triage = agent.triageIncomingMail,
} = {}) {
  if (mailRunning) return [];
  const settings = getAgentSettings();
  if (settings.agent?.proactiveEnabled === false || settings.agent?.emailMonitorEnabled !== true || !agent.getStatus(settings)) return [];
  const account = mailApi.account();
  if (!account?.configured || !account.user) return [];

  mailRunning = true;
  try {
    const previous = getMailWatchState();
    const sameAccount = previous.account === account.user && previous.initialized === true;
    const result = await mailApi.listInboxForAgent(sameAccount ? previous.lastUid : null);
    if (!sameAccount || result.initialized || (previous.uidValidity && result.uidValidity !== previous.uidValidity)) {
      const baseline = result.initialized || !sameAccount
        ? result
        : await mailApi.listInboxForAgent(null);
      saveMailWatchState({
        account: account.user,
        folder: baseline.folder,
        uidValidity: baseline.uidValidity,
        lastUid: baseline.nextUid,
        initialized: true,
      });
      return [];
    }

    const incoming = Array.isArray(result.messages) ? result.messages : [];
    const candidates = incoming.filter((message) => !message?.locallyFiltered);
    const decisions = candidates.length ? await triage(settings, candidates) : [];
    if (decisions.length !== candidates.length) {
      throw new Error('邮件分诊结果不完整，将在下次检查时重试');
    }
    // 先持久化每封邮件的 UID 去重建议，再推进游标。若进程在中间退出，下次会安全地
    // 命中同一 dedupeKey，而不会因游标已推进却尚未保存建议造成漏提醒。
    const saved = decisions.filter((decision) => decision?.priority !== 'junk').map((decision) => {
      const source = decision.source || {};
      const suggestion = saveSuggestion({
        title: decision.title,
        summary: decision.summary,
        reason: decision.reason,
        references: decision.references,
        proposal: decision.proposal,
        priority: decision.priority,
      }, now, {
        trigger: MAIL_TRIGGER,
        dedupeKey: `mail:${account.user}:${result.uidValidity}:${source.folder}:${source.uid}`,
      });
      deliverMailSuggestion(suggestion, now, notify);
      return suggestion;
    });
    // 分诊、建议持久化与通知状态都完成后才推进游标；模型失败或异常退出时保留游标，稍后安全重试。
    saveMailWatchState({
      account: account.user,
      folder: result.folder,
      uidValidity: result.uidValidity,
      lastUid: result.nextUid,
      initialized: true,
    });
    if (saved.length) notifyUpdated();
    return saved;
  } catch (error) {
    console.error('[proactive] 邮件智能分诊失败:', error.message);
    return [];
  } finally {
    mailRunning = false;
  }
}

function start(options = {}) {
  stop();
  onUpdated = options.onUpdated || (() => {});
  onOpenAgent = options.onOpenAgent || (() => {});
  onAlert = options.onAlert || (() => {});
  deliverDueFollowUps();
  scheduleFollowUpWake();
  void checkNow();
  void checkInbox();
  checkTimer = setInterval(() => { void checkNow(); }, CHECK_INTERVAL);
  mailCheckTimer = setInterval(() => { void checkInbox(); }, MAIL_CHECK_INTERVAL);
  mailCheckTimer.unref?.();
  console.log('[proactive] 主动简报检查已启动（简报 60 秒；邮件 30 秒）');
}

function stop() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (mailCheckTimer) {
    clearInterval(mailCheckTimer);
    mailCheckTimer = null;
  }
  if (eventTimer) {
    clearTimeout(eventTimer);
    eventTimer = null;
  }
  if (followUpTimer) {
    clearTimeout(followUpTimer);
    followUpTimer = null;
  }
  pendingWake = '';
}

module.exports = {
  start,
  stop,
  checkNow,
  checkEventNow,
  checkInbox,
  wake,
  notifyTodoReminder,
  listSuggestions,
  listSuggestionHistory,
  listDirectMessages,
  markDirectMessageRead,
  updateSuggestion,
  linkSuggestionToGoal,
  localDateKey,
  hasRunForDate,
  countRunsForDate,
  dailyNotificationCount,
  dueFollowUps,
  deliverDueFollowUps,
  saveSuggestion,
};

if (process.env.WORKBENCH_PROACTIVE_SELF_TEST === '1') {
  void (async () => {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const os = require('node:os');
    const dir = fs.mkdtempSync(`${os.tmpdir()}/workbench-proactive-self-test-`);
    const originalFetch = global.fetch;
    try {
    secrets.init({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
      },
    });
    store.init(dir);
    store.setSettings({ agent: { persona: { name: '小栖', personality: 'warm', proactiveStyle: 'companion', customInstructions: '' } } });
    const directNow = new Date('2026-08-22T09:00:00');
    const directSuggestion = saveSuggestion({
      title: '检查今天的安排',
      summary: '有一件事情需要你关注。',
      reason: '这是主动检查自检。',
      references: [],
    }, directNow);
    assert.equal(listSuggestions()[0].id, directSuggestion.id);
    const initialMessage = listDirectMessages().find((message) => message.suggestionId === directSuggestion.id && message.phase === 'initial');
    assert.equal(initialMessage?.id, directSuggestion.messageId);
    assert.match(initialMessage?.content || '', /小栖 想主动和你说一件事/);
    const readMessage = markDirectMessageRead(initialMessage.id, 'proactive-self-test-conversation');
    assert.equal(readMessage?.conversationId, initialMessage?.conversationId);
    assert.ok(readMessage?.readAt);
    assert.equal(hasRunForDate(localDateKey(directNow)), false);
    const linkedGoal = agentState.createGoal({ title: '主动建议关联自检' });
    linkSuggestionToGoal(directSuggestion.id, linkedGoal.id);
    assert.equal(store.getModule('agentSuggestions').find((item) => item.id === directSuggestion.id)?.goalId, linkedGoal.id);
    assert.equal(agentState.getGoal(linkedGoal.id)?.summary.pending, 1);
    updateSuggestion(directSuggestion.id, { status: 'dismissed' });
    assert.equal(listSuggestions().length, 0);
    const actionableSuggestion = saveSuggestion({
      title: '安排下一步',
      summary: '这条建议带有待确认动作。',
      reason: '主动检查自检。',
      references: [],
      proposal: { kind: 'create_todo', title: '自检行动', priority: 'medium', due: null },
    }, directNow, { dedupeKey: 'self-test-actionable' });
    updateSuggestion(actionableSuggestion.id, { status: 'acted' });
    assert.equal(listSuggestions().find((item) => item.id === actionableSuggestion.id), undefined);
    assert.equal(store.getModule('agentSuggestions').find((item) => item.id === actionableSuggestion.id)?.status, 'acted');
    assert.equal(listSuggestionHistory().find((item) => item.id === actionableSuggestion.id)?.id, actionableSuggestion.id);
    assert.ok(listDirectMessages().find((message) => message.suggestionId === actionableSuggestion.id)?.readAt);

    store.setSettings({
      agent: {
        apiBase: 'https://agent-self-test.invalid',
        apiKey: 'test-key',
        model: 'test-model',
        proactiveEnabled: true,
        emailMonitorEnabled: true,
      },
    });
    let inboxStep = 0;
    const triageInputs = [];
    const fakeMail = {
      account: () => ({ configured: true, user: 'me@example.com' }),
      listInboxForAgent: async (afterUid) => {
        if (afterUid === null) return { initialized: true, folder: 'INBOX', uidValidity: 11, nextUid: 40, messages: [] };
        if (inboxStep === 0) return { initialized: false, folder: 'INBOX', uidValidity: 11, nextUid: 41, messages: [{ uid: 41, folder: 'INBOX', subject: '面试时间确认', locallyFiltered: false }] };
        if (inboxStep === 1) return { initialized: false, folder: 'INBOX', uidValidity: 11, nextUid: 42, messages: [{ uid: 42, folder: 'INBOX', subject: '会员优惠', locallyFiltered: true }] };
        return { initialized: false, folder: 'INBOX', uidValidity: 11, nextUid: 43, messages: [{ uid: 43, folder: 'INBOX', subject: '推广订阅', locallyFiltered: false }] };
      },
    };
    const fakeTriage = async (_settings, messages) => {
      triageInputs.push(messages.map((message) => message.uid));
      if (messages[0]?.uid === 43) {
        return [{
          priority: 'junk',
          title: '推广订阅',
          summary: '这是一封推广订阅邮件。',
          reason: '没有需要用户处理的事项。',
          references: [{ type: 'mail', id: 'INBOX:43', label: '推广订阅' }],
          proposal: null,
          source: messages[0],
        }];
      }
      return [{
        priority: 'high',
        title: '需要确认面试时间',
        summary: '招聘方邀请你确认面试时间。',
        reason: '邮件要求在近期回复。',
        references: [{ type: 'mail', id: 'INBOX:41', label: '面试时间确认' }],
        proposal: { kind: 'create_todo', title: '确认面试时间', priority: 'high', due: null },
        source: messages[0],
      }];
    };
    assert.deepEqual(await checkInbox({ now: directNow, notify: false, mailApi: fakeMail, triage: fakeTriage }), []);
    assert.equal(store.getModule('agentMailWatch').lastUid, 40);
    const mailSuggestions = await checkInbox({ now: directNow, notify: false, mailApi: fakeMail, triage: fakeTriage });
    assert.equal(mailSuggestions.length, 1);
    assert.equal(mailSuggestions[0].trigger, MAIL_TRIGGER);
    assert.equal(mailSuggestions[0].priority, 'high');
    assert.equal(mailSuggestions[0].proposal?.kind, 'create_todo');
    assert.match(mailSuggestions[0].proposal?.operationId || '', /^[0-9a-f-]{36}$/i);
    assert.deepEqual(triageInputs, [[41]]);
    inboxStep = 1;
    await checkInbox({ now: directNow, notify: false, mailApi: fakeMail, triage: fakeTriage });
    assert.deepEqual(triageInputs, [[41]]);
    assert.equal(store.getModule('agentMailWatch').lastUid, 42);
    inboxStep = 2;
    assert.deepEqual(await checkInbox({ now: directNow, notify: false, mailApi: fakeMail, triage: fakeTriage }), []);
    assert.deepEqual(triageInputs, [[41], [43]]);
    assert.equal(store.getModule('agentMailWatch').lastUid, 43);
    updateSuggestion(actionableSuggestion.id, { status: 'unread', followUpAt: null });
    assert.equal(listSuggestions().find((item) => item.id === actionableSuggestion.id)?.id, actionableSuggestion.id);
    assert.equal(listSuggestionHistory().find((item) => item.id === actionableSuggestion.id), undefined);
    updateSuggestion(actionableSuggestion.id, { status: 'dismissed' });
    assert.equal(listSuggestionHistory().find((item) => item.id === actionableSuggestion.id)?.id, actionableSuggestion.id);

    const followUpSuggestion = saveSuggestion({
      title: '稍后再看',
      summary: '这条建议暂时不需要马上处理。',
      reason: '主动检查自检。',
      references: [],
    }, directNow, { dedupeKey: 'self-test-follow-up' });
    const followUpInitialMessage = listDirectMessages().find((message) => message.suggestionId === followUpSuggestion.id && message.phase === 'initial');
    markDirectMessageRead(followUpInitialMessage.id, 'follow-up-self-test-conversation');
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    updateSuggestion(followUpSuggestion.id, { status: 'read', followUpAt });
    assert.equal(listSuggestions().find((item) => item.id === followUpSuggestion.id), undefined);
    assert.equal(store.getModule('agentSuggestions').find((item) => item.id === followUpSuggestion.id)?.followUpAt, followUpAt);
    updateSuggestion(followUpSuggestion.id, { status: 'read', followUpAt: null });
    assert.equal(listSuggestions().find((item) => item.id === followUpSuggestion.id)?.id, followUpSuggestion.id);
    updateSuggestion(followUpSuggestion.id, {
      status: 'read',
      followUpAt: new Date(directNow.getTime() - 1_000).toISOString(),
    });
    let followUpDeliveryCount = 0;
    assert.equal(deliverDueFollowUps({ now: directNow, deliver: () => { followUpDeliveryCount += 1; } }), 1);
    assert.equal(followUpDeliveryCount, 1);
    assert.equal(store.getModule('agentSuggestions').find((item) => item.id === followUpSuggestion.id)?.followUpAt, null);
    const followUpMessage = listDirectMessages().find((message) => message.suggestionId === followUpSuggestion.id && message.phase === 'follow-up');
    assert.match(followUpMessage?.content || '', /小栖 来跟进一下/);
    assert.equal(followUpMessage?.conversationId, followUpInitialMessage?.conversationId);
    assert.equal(dailyNotificationCount(directNow), 1);
    updateSuggestion(followUpSuggestion.id, { status: 'dismissed' });

    store.setSettings({ notify: { maxDailyNotifications: 1 } });
    const cappedFollowUp = saveSuggestion({
      title: '达到上限后不打扰',
      summary: '这条跟进应保留在页面中，但不会再次弹出通知。',
      reason: '主动检查自检。',
      references: [],
    }, directNow, { dedupeKey: 'self-test-capped-follow-up' });
    updateSuggestion(cappedFollowUp.id, {
      status: 'read',
      followUpAt: new Date(directNow.getTime() - 1_000).toISOString(),
    });
    assert.equal(deliverDueFollowUps({ now: directNow, deliver: () => { throw new Error('notification cap should prevent delivery'); } }), 0);
    assert.equal(store.getModule('agentSuggestions').find((item) => item.id === cappedFollowUp.id)?.followUpAt, new Date(directNow.getTime() - 1_000).toISOString());
    updateSuggestion(cappedFollowUp.id, { status: 'dismissed' });

    const deliveredAlerts = [];
    onAlert = (alert) => deliveredAlerts.push(alert);
    store.setSettings({
      notify: { maxDailyNotifications: 5 },
      agent: { apiBase: 'https://agent-self-test.invalid', apiKey: 'test-key', model: 'test-model' },
    });
    store.updateModule('todos', () => [{
      id: 'todo-1',
      title: '准备方案',
      priority: 'high',
      start: null,
      end: null,
      due: '2026-08-23T12:00:00.000Z',
      done: false,
      repeat: 'none',
      repeatUntil: null,
      color: null,
      personalDateId: null,
      recurrenceId: null,
      createdAt: '2026-08-22T08:00:00.000Z',
    }]);
    let requestCount = 0;
    const encoder = new TextEncoder();
    const streamResponse = (payload) => {
      let sent = false;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: encoder.encode(payload) };
            },
          }),
        },
      };
    };
    global.fetch = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return streamResponse('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"get_todos","arguments":"{\\"status\\":\\"open\\"}"}}]}}]}\n\ndata: [DONE]\n\n');
      }
      return streamResponse('data: {"choices":[{"delta":{"content":"{\\"action\\":\\"notify\\",\\"title\\":\\"优先处理方案\\",\\"summary\\":\\"准备方案即将到期，建议先确认今天的完成路径。\\",\\"reason\\":\\"这是当前最接近截止时间的高优先级待办。\\",\\"references\\":[{\\"type\\":\\"todo\\",\\"id\\":\\"todo-1\\",\\"label\\":\\"准备方案\\"}]}"}}]}\n\ndata: [DONE]\n\n');
    };
    const dailyNow = new Date('2026-08-23T09:00:00');
    const runsBeforeDisabled = store.getModule('agentRuns').length;
    store.setSettings({ agent: { proactiveEnabled: false } });
    await checkNow({ force: true, now: dailyNow, notify: false });
    assert.equal(requestCount, 0);
    assert.equal(store.getModule('agentRuns').length, runsBeforeDisabled);
    store.setSettings({ agent: { proactiveEnabled: true } });
    const generated = await checkNow({ force: true, now: dailyNow, notify: true });
    assert.equal(requestCount, 2);
    const generatedSuggestion = generated.find((suggestion) => suggestion.title === '优先处理方案');
    assert.ok(generatedSuggestion);
    assert.equal(generatedSuggestion.references[0].id, 'todo-1');
    assert.equal(deliveredAlerts.length, 1);
    assert.equal(deliveredAlerts[0].messageId, generatedSuggestion.messageId);
    assert.equal(deliveredAlerts[0].title, '优先处理方案');
    assert.equal(deliveredAlerts[0].summary, '准备方案即将到期，建议先确认今天的完成路径。');
    assert.equal(deliveredAlerts[0].phase, 'initial');
    assert.equal(store.getModule('agentRuns')[0].status, 'completed');
    assert.deepEqual(store.getModule('agentRuns')[0].contextTypes, ['todos']);
    assert.equal(store.getModule('agentRuns')[0].delivery, 'desktop-notification');
    assert.equal(store.getModule('agentRuns')[0].decision, '生成建议：优先处理方案');
    const deadlineAlert = notifyTodoReminder({
      eventKey: 'todo:todo-1:due:2026-08-23T10:00:00.000Z:overdue',
      todoId: 'todo-1',
      todoTitle: '准备方案',
      urgency: 'overdue',
      body: '「准备方案」已超期 1 分钟',
    }, new Date('2026-08-23T10:01:00'));
    assert.equal(deadlineAlert.title, '任务已超期：准备方案');
    assert.equal(deadlineAlert.notifiedAt, '2026-08-23T02:01:00.000Z');
    assert.equal(store.getModule('agentMessages').some((message) => message.suggestionId === deadlineAlert.id), true);
    assert.equal(deliveredAlerts.at(-1).messageId, deadlineAlert.messageId);
    onAlert = () => {};
    await checkNow({ now: dailyNow, notify: false });
    assert.equal(requestCount, 2);
    const eventNow = new Date('2026-08-23T10:00:00');
    const eventGenerated = await checkEventNow({
      sourceKey: 'todo:created:todo-1',
      changeSummary: '新增待办：准备方案',
      now: eventNow,
      notify: false,
    });
    assert.equal(requestCount, 3);
    assert.equal(eventGenerated[0].trigger, EVENT_TRIGGER);
    assert.equal(store.getModule('agentRuns')[0].trigger, EVENT_TRIGGER);
    assert.equal(countRunsForDate(EVENT_TRIGGER, localDateKey(eventNow)), 1);
    await checkEventNow({ sourceKey: 'note:saved:note-1', changeSummary: '更新备忘录：准备方案', now: eventNow, notify: false });
    await checkEventNow({ sourceKey: 'library:updated:item-1', changeSummary: '更新资料：方案文档', now: eventNow, notify: false });
    assert.equal(countRunsForDate(EVENT_TRIGGER, localDateKey(eventNow)), MAX_EVENT_RUNS_PER_DAY);
    const requestCountAtLimit = requestCount;
    await checkEventNow({ sourceKey: 'todo:updated:todo-1', changeSummary: '修改待办：准备方案', now: eventNow, notify: false });
    assert.equal(requestCount, requestCountAtLimit);
      console.log('proactive self-test ok');
    } finally {
      global.fetch = originalFetch;
      secrets.init();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
