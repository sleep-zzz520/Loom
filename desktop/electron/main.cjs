const { app, BrowserWindow, dialog, ipcMain, net, safeStorage } = require('electron');
const path = require('node:path');
const store = require('./store.cjs');
const workspace = require('./workspace.cjs');
const agent = require('./agent.cjs');
const agentState = require('./agent-state.cjs');
const notifier = require('./notifier.cjs');
const proactive = require('./proactive.cjs');
const holidays = require('./holidays.cjs');
const library = require('./library.cjs');
const music = require('./music.cjs');
const musicService = require('./music-service.cjs');
const mail = require('./mail.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;
let musicServiceStatus = musicService.getStatus();
// ponytail: 队列仅保留在当前应用进程；需要跨重启续播时再持久化最近一次 Agent 音乐会话。
const agentMusicState = agent.createMusicState();

function getMusicSettings() {
  const settings = store.getSettings();
  if (!musicServiceStatus.embedded || !musicService.shouldEmbed(settings.netease?.apiBase)) return settings;
  return {
    ...settings,
    netease: {
      ...settings.netease,
      apiBase: musicServiceStatus.base,
    },
  };
}

function getMusicServiceStatus() {
  const settings = store.getSettings();
  if (!musicServiceStatus.embedded || musicService.shouldEmbed(settings.netease?.apiBase)) return musicServiceStatus;
  return {
    ready: true,
    embedded: false,
    base: settings.netease.apiBase,
    error: '',
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Loom',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`[main] did-fail-load ${code}: ${description}`);
  });
  // 渲染器控制台日志在开发终端已关闭时会写入失效管道并触发 EPIPE；不把诊断输出绑定到主进程稳定性。
  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

function openAgentWindow(messageId = '') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
  const sendOpenEvent = () => mainWindow?.webContents.send('agent:open', String(messageId || ''));
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', sendOpenEvent);
  else sendOpenEvent();
}

function wakeProactive(source, detail = '') {
  proactive.wake({ source, detail });
}

function notifyAgentStateChanged() {
  mainWindow?.webContents.send('agent:state-updated');
}

function notifyProactiveAlert(alert) {
  if (!alert || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('agent:proactive-alert', alert);
}

function notifyAgentAboutTodoReminders(notifications) {
  notifications
    .filter((notification) => notification?.todoId && ['urgent', 'overdue'].includes(notification.urgency))
    .forEach((notification) => proactive.notifyTodoReminder(notification));
}

function publicSettings(settings) {
  return {
    ...settings,
    email: {
      ...settings.email,
      pass: '',
    },
  };
}

function publicData() {
  const data = store.getData();
  return {
    ...data,
    settings: publicSettings(data.settings),
  };
}

function withoutEmailPassword(patch) {
  if (!patch || typeof patch !== 'object' || !patch.email || typeof patch.email !== 'object') return patch;
  const { pass: _password, ...email } = patch.email;
  return { ...patch, email };
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: 'Loom',
    version: app.getVersion(),
    platform: process.platform,
  }));
  ipcMain.handle('data:get', () => publicData());
  ipcMain.handle('data:get-settings', () => publicSettings(store.getSettings()));
  ipcMain.handle('data:set-settings', (_event, patch) => {
    const settings = store.setSettings(withoutEmailPassword(patch));
    if (patch?.agent && Object.hasOwn(patch.agent, 'emailMonitorEnabled')) void proactive.checkInbox();
    return publicSettings(settings);
  });
  ipcMain.handle('data:get-module', (_event, name) => store.getModule(name));
  ipcMain.handle('data:set-module', (_event, name, items) => {
    const result = store.setModule(name, items);
    if (!String(name || '').startsWith('agent')) wakeProactive(`module:${name}`);
    return result;
  });
  ipcMain.handle('library:import-file', async (_event, categoryId = '') => {
    const result = await dialog.showOpenDialog({
      title: '导入资料文件',
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    const imported = library.importFile(result.filePaths[0], categoryId);
    wakeProactive('library:imported', imported?.item?.name);
    return imported;
  });
  ipcMain.handle('library:create-document', (_event, categoryId = '') => {
    const created = library.createDocument(categoryId);
    wakeProactive('library:created', created?.item?.name);
    return created;
  });
  ipcMain.handle('library:update-item', (_event, id, patch) => {
    const updated = library.updateItem(id, patch);
    wakeProactive('library:updated', updated?.item?.name || id);
    return updated;
  });
  ipcMain.handle('library:remove-item', (_event, id) => {
    const items = library.removeItem(id);
    wakeProactive('library:removed', id);
    return items;
  });
  ipcMain.handle('library:preview-file', (_event, id) => library.previewFile(id));

  ipcMain.handle('workspace:snapshot', () => workspace.snapshot());
  ipcMain.handle('workspace:list-todos', () => workspace.listTodos());
  ipcMain.handle('workspace:create-todo', (_event, input) => {
    const todos = workspace.createTodo(input);
    wakeProactive('todo:created', todos?.[0]?.title);
    notifyAgentStateChanged();
    return todos;
  });
  ipcMain.handle('workspace:update-todo', (_event, id, patch) => {
    const todos = workspace.updateTodo(id, patch);
    wakeProactive('todo:updated', todos?.find((todo) => todo.id === id)?.title || id);
    notifyAgentStateChanged();
    return todos;
  });
  ipcMain.handle('workspace:remove-todo', (_event, id) => {
    const todos = workspace.removeTodo(id);
    wakeProactive('todo:removed', id);
    notifyAgentStateChanged();
    return todos;
  });
  ipcMain.handle('workspace:remember-personal-date', (_event, id) => {
    const result = workspace.rememberPersonalDate(id);
    wakeProactive('todo:remembered-date', result?.personalDate?.title || id);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('workspace:list-notes', () => workspace.listNotes());
  ipcMain.handle('workspace:save-note', (_event, input) => {
    const notes = workspace.saveNote(input);
    wakeProactive('note:saved', notes?.[0]?.title);
    return notes;
  });
  ipcMain.handle('workspace:remove-note', (_event, id) => {
    const notes = workspace.removeNote(id);
    wakeProactive('note:removed', id);
    return notes;
  });
  ipcMain.handle('calendar:get-holidays', (_event, year) =>
    holidays.getHolidays(year, (url) => net.fetch(url))
  );
  ipcMain.handle('music:service-status', () => getMusicServiceStatus());
  ipcMain.handle('music:search', (_event, query) => music.search(query, getMusicSettings()));
  ipcMain.handle('music:hot-search', () => music.hotSearch(getMusicSettings()));
  ipcMain.handle('music:track-details', (_event, id) => music.trackDetails(id, getMusicSettings()));
  ipcMain.handle('music:lyrics', (_event, id) => music.lyrics(id, getMusicSettings()));
  ipcMain.handle('music:playback-url', (_event, id) => music.playbackUrl(id, getMusicSettings()));
  ipcMain.handle('music:account-state', () => music.accountState(store));
  ipcMain.handle('music:qr-start', () => music.startQrLogin(getMusicSettings()));
  ipcMain.handle('music:qr-check', (_event, key) => music.checkQrLogin(key, getMusicSettings(), store));
  ipcMain.handle('music:sync-account', () => music.syncAccount(getMusicSettings(), store));
  ipcMain.handle('music:sync-playlist', (_event, id) => music.syncPlaylistTracks(id, getMusicSettings(), store));
  ipcMain.handle('music:add-to-playlist', (_event, playlistId, trackId) => music.addToPlaylist(playlistId, trackId, getMusicSettings(), store));
  ipcMain.handle('music:remove-from-playlist', (_event, playlistId, trackId) => music.removeFromPlaylist(playlistId, trackId, getMusicSettings(), store));
  ipcMain.handle('music:logout', () => music.logout(getMusicSettings(), store));
  ipcMain.handle('mail:account', () => mail.account());
  ipcMain.handle('mail:save-account', (_event, input) => {
    const saved = mail.saveAccount(input);
    void proactive.checkInbox();
    return saved;
  });
  ipcMain.handle('mail:verify', (_event, input) => mail.verifyConnection(input));
  ipcMain.handle('mail:list', (_event, folder, limit) => mail.listMailbox(folder, limit));
  ipcMain.handle('mail:get-message', (_event, folder, uid) => mail.getMessage(folder, uid));
  ipcMain.handle('mail:mark-read', (_event, folder, uid) => mail.markRead(folder, uid));
  ipcMain.handle('mail:send', (_event, input) => mail.sendMessage(input));
  ipcMain.handle('agent:status', () => agent.getStatus(store.getSettings()));
  ipcMain.handle('agent:chat', (event, messages) =>
    agent.runAgent(messages, store.getSettings(), (delta) => {
      event.sender.send('agent:stream', delta);
    }, {
      onMusicCommand: (command) => event.sender.send('agent:music-command', command),
      musicState: agentMusicState,
    })
  );
  ipcMain.handle('agent:confirm-proposal', async (_event, proposal) => {
    const musicProposal = agent.normaliseMusicProposal(proposal);
    const emailProposal = agent.normaliseEmailProposal(proposal);
    const result = musicProposal
      ? await (musicProposal.kind === 'add_music_to_playlist'
        ? music.addToPlaylist(musicProposal.playlistId, musicProposal.trackId, getMusicSettings(), store)
        : music.removeFromPlaylist(musicProposal.playlistId, musicProposal.trackId, getMusicSettings(), store))
      : emailProposal
        ? await mail.sendMessage(emailProposal)
      : agent.confirmProposal(proposal);
    notifyAgentStateChanged();
    if (emailProposal) {
      const accepted = result.accepted?.join('、') || emailProposal.to;
      const rejected = result.rejected?.length ? `；未被发件服务器接受：${result.rejected.join('、')}` : '';
      const deliveryNotice = result.dsnSupported
        ? '已请求失败或延迟的投递回执。'
        : '发件服务器不支持下游投递回执。';
      return { content: `邮件“${emailProposal.subject}”已交给发件服务器，已接受收件人：${accepted}${rejected}。${deliveryNotice}对方邮箱何时入箱仍取决于后续投递。` };
    }
    if (!musicProposal) return result;
    const actionText = musicProposal.kind === 'add_music_to_playlist'
      ? `已将“${musicProposal.trackTitle}”添加到「${result.playlist.name}」`
      : `已将“${musicProposal.trackTitle}”从「${result.playlist.name}」移除`;
    return { content: `${actionText}，已同步到网易云音乐。` };
  });
  ipcMain.handle('agent:get-suggestions', () => proactive.listSuggestions());
  ipcMain.handle('agent:get-suggestion-history', () => proactive.listSuggestionHistory());
  ipcMain.handle('agent:get-messages', () => proactive.listDirectMessages());
  ipcMain.handle('agent:mark-message-read', (_event, id, conversationId) => {
    const result = proactive.markDirectMessageRead(id, conversationId);
    mainWindow?.webContents.send('agent:proactive-updated');
    return result;
  });
  ipcMain.handle('agent:update-suggestion', (_event, id, patch) => {
    const result = proactive.updateSuggestion(id, patch);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:link-suggestion-goal', (_event, id, goalId) => {
    const result = proactive.linkSuggestionToGoal(id, goalId);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:check-proactive', (_event, force = false) => proactive.checkNow({ force: Boolean(force) }));
  ipcMain.handle('agent:get-goals', (_event, includeArchived = false) => agentState.listGoals({ includeArchived: Boolean(includeArchived) }));
  ipcMain.handle('agent:create-goal', (_event, input) => {
    const result = agentState.createGoal(input);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:update-goal', (_event, id, patch) => {
    const result = agentState.updateGoal(id, patch);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:add-goal-action', (_event, input) => {
    const result = agentState.addGoalAction(input);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:update-goal-action', (_event, id, patch) => {
    const result = agentState.updateGoalAction(id, patch);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:get-memories', (_event, includeArchived = false) => agentState.listMemories({ includeArchived: Boolean(includeArchived) }));
  ipcMain.handle('agent:review-memory', (_event, id, decision) => {
    const result = agentState.reviewMemory(id, decision);
    notifyAgentStateChanged();
    return result;
  });
  ipcMain.handle('agent:get-skills', (_event, includeArchived = false) => agentState.listSkills({ includeArchived: Boolean(includeArchived) }));
  ipcMain.handle('agent:review-skill', (_event, id, decision) => {
    const result = agentState.reviewSkill(id, decision);
    notifyAgentStateChanged();
    return result;
  });

  ipcMain.handle('notify:check-todos', () => {
    return notifier.checkNow();
  });
  ipcMain.handle('notify:send-ntfy', (_event, title, message) =>
    notifier.sendPhonePush(store.getSettings(), title, message)
  );
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  mail.init({ safeStorage });
  music.init(app.getPath('userData'));
  library.init(app.getPath('userData'));
  void (async () => {
    musicServiceStatus = await musicService.start(store.getSettings());
    registerIpc();
    createWindow();

    proactive.start({
      onUpdated: () => mainWindow?.webContents.send('agent:proactive-updated'),
      onOpenAgent: (messageId) => openAgentWindow(messageId),
      onAlert: notifyProactiveAlert,
    });
    // 启动通知定时器（窗口就绪后）。关键待办提醒同时进入 Agent 消息流。
    notifier.startNotifier({ onNotifications: notifyAgentAboutTodoReminders });
  })();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  proactive.stop();
  notifier.stopNotifier();
  void musicService.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
