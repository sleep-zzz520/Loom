const { Notification } = require('electron');
const store = require('./store.cjs');

let checkTimer = null;
const notifiedIds = new Set();

/** 判断一条待办是否已超期（未完成 + 截止时间已过） */
function isOverdue(todo) {
  if (todo.done || !todo.due) return false;
  return new Date(todo.due).getTime() <= Date.now();
}

/** 判断一条待办是否即将到期（未完成 + 1 小时内到期） */
function isDueSoon(todo) {
  if (todo.done || !todo.due) return false;
  const dueTime = new Date(todo.due).getTime();
  const now = Date.now();
  return dueTime > now && dueTime - now <= 3600_000;
}

/** 获取相对时间描述 */
function relativeTime(due) {
  const diff = new Date(due).getTime() - Date.now();
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

/** 发送一条系统通知 */
function showSystemNotification(title, body) {
  try {
    const notification = new Notification({ title, body });
    notification.show();
  } catch (error) {
    console.error('[notifier] 系统通知失败:', error.message);
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
      headers: {
        'Title': 'Workbench',
        'Priority': '5',
        'Tags': 'warning',
      },
    });
    if (!response.ok) {
      console.error(`[notifier] ntfy 推送失败 (${response.status})`);
    }
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
    const response = await fetch(url, {
      method: 'GET',
    });
    if (!response.ok) {
      console.error(`[notifier] Bark 推送失败 (${response.status})`);
    }
  } catch (error) {
    console.error('[notifier] Bark 推送出错:', error.message);
  }
}

/** 根据配置的推送渠道发送手机推送 */
function sendPhonePush(settings, title, message) {
  const channel = settings.notify?.channel || 'ntfy';
  if (channel === 'bark') {
    sendBark(settings, title, message);
  } else if (channel === 'ntfy') {
    sendNtfy(settings, title, message);
  }
}

/** 检查一次待办并发送通知 */
function checkTodos(settings) {
  const todos = store.getModule('todos');
  const now = Date.now();

  for (const todo of todos) {
    if (todo.done || !todo.due) continue;
    if (notifiedIds.has(todo.id)) continue;

    const dueTime = new Date(todo.due).getTime();

    // 已超期 → 系统通知 + 手机推送
    if (dueTime <= now) {
      notifiedIds.add(todo.id);
      const title = '待办已超期';
      const body = `「${todo.title}」${relativeTime(todo.due)}`;
      showSystemNotification(title, body);
      sendPhonePush(settings, title, body);
      continue;
    }

    // 即将到期（1 小时内）→ 系统通知
    if (dueTime - now <= 3600_000) {
      notifiedIds.add(todo.id);
      const title = '待办即将到期';
      const body = `「${todo.title}」${relativeTime(todo.due)}`;
      showSystemNotification(title, body);
      // 即将到期不推送手机，避免过度打扰
    }
  }
}

/** 启动定时检查 */
function startNotifier(settings) {
  stopNotifier();
  // 启动后立即检查一次
  checkTodos(settings);
  checkTimer = setInterval(() => checkTodos(settings), 60_000);
  console.log('[notifier] 通知定时器已启动（间隔 60 秒）');
}

/** 停止定时检查 */
function stopNotifier() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/** 手动触发一次检查（对外 IPC） */
function checkNow(settings) {
  checkTodos(settings);
}

module.exports = {
  startNotifier,
  stopNotifier,
  checkNow,
  sendNtfy,
  sendBark,
  sendPhonePush,
  relativeTime,
};