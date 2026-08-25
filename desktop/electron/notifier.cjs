const { Notification } = require('electron');
const store = require('./store.cjs');
const holidays = require('./holidays.cjs');

const MAX_HISTORY_ITEMS = 500;
const OBSERVANCE_DATES = [
  { id: 'valentines-day', date: '02-14', title: '情人节' },
  { id: 'may-20', date: '05-20', title: '5·20' },
];
let checkTimer = null;
let onNotifications = () => {};

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 获取相对时间描述 */
function relativeTime(due, now = Date.now()) {
  const dueTime = validDate(due)?.getTime();
  if (!dueTime) return '时间无效';
  const diff = dueTime - now;
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3600_000);
  const days = Math.floor(abs / 86_400_000);

  if (diff < 0) {
    if (days >= 1) return `已超期 ${days} 天`;
    if (hours >= 1) return `已超期 ${hours} 小时`;
    return `已超期 ${minutes} 分钟`;
  }
  if (days >= 1) return `还有 ${days} 天`;
  if (hours >= 1) return `还有 ${hours} 小时`;
  return `还有 ${minutes} 分钟`;
}

function localDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isWithinQuietHours(quietHours, now) {
  const start = quietHours?.start || '';
  const end = quietHours?.end || '';
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

function normaliseReminderMinutes(value) {
  const fallback = [1440, 240, 60];
  if (!Array.isArray(value)) return fallback;
  const offsets = [...new Set(value.map(Number).filter((minutes) => Number.isInteger(minutes) && minutes > 0))];
  return offsets.length ? offsets.sort((a, b) => a - b) : fallback;
}

function eligibleDueNotification(todo, reminderMinutes, historyKeys, now) {
  // 已确认的个人日期由“今天是你的重要日期”规则提醒，不再按普通待办催截止。
  if (todo.done || !todo.due || todo.personalDateId) return null;
  const due = validDate(todo.due);
  if (!due) return null;
  const dueTime = due.getTime();
  const dueToken = due.toISOString();

  if (dueTime <= now.getTime()) {
    const eventKey = `todo:${todo.id}:due:${dueToken}:overdue`;
    if (historyKeys.has(eventKey)) return null;
    return {
      eventKey,
      title: '待办已超期',
      body: `「${todo.title}」${relativeTime(todo.due, now.getTime())}`,
      sendPhone: true,
      todoId: todo.id,
      todoTitle: todo.title,
      urgency: 'overdue',
    };
  }

  const remainingMinutes = (dueTime - now.getTime()) / 60_000;
  // 只选择离截止时间最近的适用档位，避免晚启动后倒序补发旧提醒。
  const offset = reminderMinutes.find((minutes) => remainingMinutes <= minutes);
  if (!offset || historyKeys.has(`todo:${todo.id}:due:${dueToken}:before:${offset}`)) return null;
  return {
    eventKey: `todo:${todo.id}:due:${dueToken}:before:${offset}`,
    title: '待办即将到期',
    body: `「${todo.title}」${relativeTime(todo.due, now.getTime())}`,
    sendPhone: false,
    todoId: todo.id,
    todoTitle: todo.title,
    urgency: offset <= 60 ? 'urgent' : 'scheduled',
  };
}

/** 计算本次应触发的提醒；纯函数，便于验证规则而不发送通知。 */
function collectNotifications({ todos, settings, history, automaticDates = [], now = new Date() }) {
  const notify = settings.notify || {};
  if (isWithinQuietHours(notify.quietHours, now)) return [];

  const historyKeys = new Set(history.map((item) => item.eventKey));
  const today = localDateKey(now);
  const maxDaily = Number.isInteger(notify.maxDailyNotifications) && notify.maxDailyNotifications > 0
    ? notify.maxDailyNotifications
    : 5;
  // Agent 的主动消息有自己的频控；不能占用待办的提醒额度，否则旧消息会静默吞掉新的超期任务。
  const sentToday = history.filter((item) => (
    localDateKey(item.sentAt) === today
    && !String(item.eventKey || '').startsWith('agent-suggestion:')
  )).length;
  const available = Math.max(0, maxDaily - sentToday);

  const reminders = [];
  const reminderMinutes = normaliseReminderMinutes(notify.reminderMinutes);
  for (const todo of todos) {
    const notification = eligibleDueNotification(todo, reminderMinutes, historyKeys, now);
    if (notification) reminders.push(notification);
  }

  const date = localDateKey(now);
  const monthDay = date.slice(5);
  const dateCandidates = [
    ...automaticDates.map((item) => ({ ...item, source: 'automatic' })),
    ...(Array.isArray(notify.importantDates) ? notify.importantDates : [])
      .filter((item) => item?.date === monthDay)
      .map((item) => ({ ...item, source: 'personal' })),
  ];
  for (const importantDate of dateCandidates) {
    if (!importantDate?.id || !importantDate?.title) continue;
    const eventKey = `important-date:${importantDate.source}:${importantDate.id}:${date}`;
    if (!historyKeys.has(eventKey)) {
      reminders.push({
        eventKey,
        title: importantDate.source === 'personal' ? '今天是你的重要日期' : '今天是特别的日子',
        body: `今天是「${importantDate.title}」。`,
        sendPhone: false,
      });
    }
  }

  // 超期提醒对每个待办只发送一次，优先级高于日常上限，不能因白天已收到其他消息而消失。
  const overdue = reminders.filter((item) => item.urgency === 'overdue');
  const regular = reminders.filter((item) => item.urgency !== 'overdue');
  return [...overdue, ...regular.slice(0, available)];
}

async function getAutomaticDates(now) {
  const date = localDateKey(now);
  const dates = OBSERVANCE_DATES
    .filter((item) => item.date === date.slice(5))
    .map(({ id, title }) => ({ id, title }));
  try {
    const calendar = await holidays.getHolidays(now.getFullYear(), (url) => fetch(url));
    const holiday = calendar[date];
    if (holiday?.isOffDay) dates.push({ id: `holiday-${date}`, title: holiday.name });
  } catch (error) {
    console.warn('[notifier] 节假日数据不可用，仅使用内置日期:', error.message);
  }
  return dates;
}

/** 发送一条系统通知 */
function showSystemNotification(title, body) {
  try {
    if (!Notification) return false;
    if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return false;
    const notification = new Notification({
      title,
      body,
      // macOS 播放系统提示音；其他平台会安全地忽略该选项。
      sound: 'Glass',
    });
    notification.show();
    return true;
  } catch (error) {
    console.error('[notifier] 系统通知失败:', error.message);
    return false;
  }
}

/** 发送 ntfy 手机推送 */
async function sendNtfy(settings, title, message) {
  const { ntfyUrl, ntfyTopic } = settings.notify || {};
  if (!ntfyUrl || !ntfyTopic) {
    console.log('[notifier] ntfy 未配置，跳过手机推送');
    return;
  }
  try {
    const url = `${ntfyUrl.replace(/\/+$/, '')}/${encodeURIComponent(ntfyTopic)}`;
    const response = await fetch(url, {
      method: 'POST',
      body: `${title}\n\n${message}`,
      headers: { Title: 'Workbench', Priority: '5', Tags: 'warning' },
    });
    if (!response.ok) console.error(`[notifier] ntfy 推送失败 (${response.status})`);
  } catch (error) {
    console.error('[notifier] ntfy 推送出错:', error.message);
  }
}

/** 发送 Bark 推送（iOS 专用，走 APNs 通道） */
async function sendBark(settings, title, message) {
  const { barkUrl } = settings.notify || {};
  if (!barkUrl) {
    console.log('[notifier] Bark 未配置，跳过手机推送');
    return;
  }
  try {
    const url = `${barkUrl.replace(/\/+$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) console.error(`[notifier] Bark 推送失败 (${response.status})`);
  } catch (error) {
    console.error('[notifier] Bark 推送出错:', error.message);
  }
}

/** 根据配置的推送渠道发送手机推送 */
function sendPhonePush(settings, title, message) {
  const channel = settings.notify?.channel || 'ntfy';
  if (channel === 'bark') return sendBark(settings, title, message);
  if (channel === 'ntfy') return sendNtfy(settings, title, message);
  return undefined;
}

function saveHistory(notification, now) {
  store.updateModule('notificationHistory', (current) => [
    { id: store.newId(), eventKey: notification.eventKey, title: notification.title, body: notification.body, sentAt: now.toISOString() },
    ...current,
  ].slice(0, MAX_HISTORY_ITEMS));
}

/** 读取最新设置后检查一次待办、自动日期与发送上限。 */
async function checkTodos() {
  const settings = store.getSettings();
  const now = new Date();
  const notifications = collectNotifications({
    todos: store.getModule('todos'),
    settings,
    history: store.getModule('notificationHistory'),
    automaticDates: await getAutomaticDates(now),
    now,
  });
  for (const notification of notifications) {
    showSystemNotification(notification.title, notification.body);
    if (notification.sendPhone) void sendPhonePush(settings, notification.title, notification.body);
    saveHistory(notification, now);
  }
  if (notifications.length) {
    try {
      onNotifications(notifications);
    } catch (error) {
      console.error('[notifier] 通知后处理失败:', error.message);
    }
  }
  return notifications;
}

function startNotifier(options = {}) {
  stopNotifier();
  onNotifications = typeof options.onNotifications === 'function' ? options.onNotifications : () => {};
  void checkTodos();
  checkTimer = setInterval(() => { void checkTodos(); }, 60_000);
  console.log('[notifier] 通知定时器已启动（间隔 60 秒）');
}

function stopNotifier() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function checkNow() {
  return checkTodos();
}

module.exports = {
  startNotifier,
  stopNotifier,
  checkNow,
  sendNtfy,
  sendBark,
  sendPhonePush,
  relativeTime,
  isWithinQuietHours,
  collectNotifications,
  getAutomaticDates,
};

if (process.env.WORKBENCH_NOTIFIER_SELF_TEST === '1') {
  const now = new Date('2026-05-20T09:30:00');
  const settings = {
    notify: {
      reminderMinutes: [1440, 60],
      quietHours: { start: '22:00', end: '08:00' },
      maxDailyNotifications: 5,
      importantDates: [],
    },
  };
  const todos = [{ id: 'due-soon', title: '准备礼物', due: '2026-05-20T10:00:00', done: false }];
  const notifications = collectNotifications({ todos, settings, history: [], automaticDates: [{ id: 'may-20', title: '5·20' }], now });
  if (notifications.length !== 2 || !notifications.some((item) => item.eventKey.includes('before:60')) || !notifications.some((item) => item.eventKey.includes('important-date'))) {
    throw new Error('notifier rule self-test failed');
  }
  const alreadyReminded = [{ eventKey: `todo:due-soon:due:${new Date(todos[0].due).toISOString()}:before:60`, sentAt: now.toISOString() }];
  if (collectNotifications({ todos, settings, history: alreadyReminded, now }).some((item) => item.eventKey.startsWith('todo:'))) {
    throw new Error('notifier duplicate-offset self-test failed');
  }
  if (!isWithinQuietHours(settings.notify.quietHours, new Date('2026-05-20T23:00:00'))) {
    throw new Error('notifier quiet-hours self-test failed');
  }
  const personalDateNotifications = collectNotifications({
    todos: [{ ...todos[0], personalDateId: 'birthday' }],
    settings: { ...settings, notify: { ...settings.notify, importantDates: [{ id: 'birthday', title: '我的生日', date: '05-20' }] } },
    history: [],
    now,
  });
  if (personalDateNotifications.length !== 1 || personalDateNotifications[0].title !== '今天是你的重要日期') {
    throw new Error('personal date should not send a todo reminder');
  }
  const overdueAtCap = collectNotifications({
    todos: [{ id: 'overdue', title: '处理账单', due: '2026-05-20T08:00:00', done: false }],
    settings,
    history: Array.from({ length: 5 }, (_, index) => ({ eventKey: `todo:other:${index}`, sentAt: now.toISOString() })),
    now,
  });
  if (overdueAtCap.length !== 1 || overdueAtCap[0].urgency !== 'overdue') {
    throw new Error('notifier overdue-priority self-test failed');
  }
  console.log('notifier self-test ok');
}
