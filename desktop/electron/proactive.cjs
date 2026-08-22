const store = require('./store.cjs');
const agent = require('./agent.cjs');
const notifier = require('./notifier.cjs');

const CHECK_INTERVAL = 60_000;
const EVENT_DEBOUNCE = 15_000;
const MAX_EVENT_RUNS_PER_DAY = 3;
const MAX_RUNS = 120;
const MAX_SUGGESTIONS = 40;
const DAILY_TRIGGER = 'daily-briefing';
const EVENT_TRIGGER = 'event-follow-up';

let checkTimer = null;
let eventTimer = null;
let pendingWake = '';
let running = false;
let onUpdated = () => {};
let onOpenAgent = () => {};

function localDateKey(timestamp = new Date()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function listSuggestions() {
  return store.getModule('agentSuggestions')
    .filter((suggestion) => suggestion.status !== 'dismissed')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_SUGGESTIONS);
}

function notifyUpdated() {
  try {
    onUpdated();
  } catch (error) {
    console.error('[proactive] 更新通知失败:', error.message);
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

function saveSuggestion(result, now, options = {}) {
  const trigger = options.trigger === EVENT_TRIGGER ? EVENT_TRIGGER : DAILY_TRIGGER;
  const dateKey = localDateKey(now);
  const dedupeKey = options.dedupeKey || `${trigger}:${dateKey}`;
  const existing = store.getModule('agentSuggestions').find((suggestion) => suggestion.dedupeKey === dedupeKey);
  if (existing) return existing;
  const suggestion = {
    id: store.newId(),
    dedupeKey,
    trigger,
    title: result.title,
    summary: result.summary,
    reason: result.reason,
    references: result.references || [],
    status: 'unread',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    notifiedAt: null,
  };
  store.updateModule('agentSuggestions', (suggestions) => [suggestion, ...suggestions].slice(0, MAX_SUGGESTIONS));
  return suggestion;
}

function markNotified(id, now) {
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => (
    suggestion.id === id ? { ...suggestion, notifiedAt: now.toISOString(), updatedAt: now.toISOString() } : suggestion
  )));
}

function showDesktopNotification(suggestion) {
  try {
    const { Notification } = require('electron');
    if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Agent 主动发现',
      body: `${suggestion.title}\n${suggestion.summary}`.slice(0, 300),
    });
    notification.on('click', () => onOpenAgent());
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
  const settings = store.getSettings();
  if (!agent.getStatus(settings)) return listSuggestions();
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
      if (!suggestion.notifiedAt) {
        if (notify) {
          showDesktopNotification(suggestion);
          markNotified(suggestion.id, now);
        }
      }
      finishRun(run.id, { status: 'completed', suggestionId: suggestion.id });
    } else {
      finishRun(run.id, { status: 'completed', suggestionId: null });
    }
  } catch (error) {
    console.error('[proactive] 主动检查失败:', error.message);
    finishRun(run.id, { status: 'failed', suggestionId: null, error: String(error.message || error).slice(0, 300) });
  } finally {
    running = false;
    notifyUpdated();
  }
  return listSuggestions();
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
  const allowedStatuses = ['unread', 'read', 'dismissed'];
  if (!allowedStatuses.includes(patch.status)) return listSuggestions();
  store.updateModule('agentSuggestions', (suggestions) => suggestions.map((suggestion) => (
    suggestion.id === id
      ? { ...suggestion, status: patch.status, updatedAt: new Date().toISOString() }
      : suggestion
  )));
  notifyUpdated();
  return listSuggestions();
}

function start(options = {}) {
  stop();
  onUpdated = options.onUpdated || (() => {});
  onOpenAgent = options.onOpenAgent || (() => {});
  void checkNow();
  checkTimer = setInterval(() => { void checkNow(); }, CHECK_INTERVAL);
  console.log('[proactive] 主动简报检查已启动（间隔 60 秒，每天最多一次）');
}

function stop() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (eventTimer) {
    clearTimeout(eventTimer);
    eventTimer = null;
  }
  pendingWake = '';
}

module.exports = {
  start,
  stop,
  checkNow,
  checkEventNow,
  wake,
  listSuggestions,
  updateSuggestion,
  localDateKey,
  hasRunForDate,
  countRunsForDate,
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
    store.init(dir);
    const directNow = new Date('2026-08-22T09:00:00');
    const directSuggestion = saveSuggestion({
      title: '检查今天的安排',
      summary: '有一件事情需要你关注。',
      reason: '这是主动检查自检。',
      references: [],
    }, directNow);
    assert.equal(listSuggestions()[0].id, directSuggestion.id);
    assert.equal(hasRunForDate(localDateKey(directNow)), false);
    updateSuggestion(directSuggestion.id, { status: 'dismissed' });
    assert.equal(listSuggestions().length, 0);

    store.setSettings({ agent: { apiBase: 'http://agent-self-test.invalid', apiKey: 'test-key', model: 'test-model' } });
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
    const generated = await checkNow({ force: true, now: dailyNow, notify: false });
    assert.equal(requestCount, 2);
    assert.equal(generated.length, 1);
    assert.equal(generated[0].title, '优先处理方案');
    assert.equal(generated[0].references[0].id, 'todo-1');
    assert.equal(store.getModule('agentRuns')[0].status, 'completed');
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
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
