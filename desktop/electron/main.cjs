const { app, BrowserWindow, dialog, ipcMain, net } = require('electron');
const path = require('node:path');
const store = require('./store.cjs');
const workspace = require('./workspace.cjs');
const agent = require('./agent.cjs');
const notifier = require('./notifier.cjs');
const proactive = require('./proactive.cjs');
const holidays = require('./holidays.cjs');
const library = require('./library.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: '个人工作台',
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
  win.webContents.on('console-message', (details) => {
    console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

function openAgentWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
  const sendOpenEvent = () => mainWindow?.webContents.send('agent:open');
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', sendOpenEvent);
  else sendOpenEvent();
}

function wakeProactive(source, detail = '') {
  proactive.wake({ source, detail });
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: '个人工作台',
    version: app.getVersion(),
    platform: process.platform,
  }));
  ipcMain.handle('data:get', () => store.getData());
  ipcMain.handle('data:get-settings', () => store.getSettings());
  ipcMain.handle('data:set-settings', (_event, patch) => store.setSettings(patch));
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
    return todos;
  });
  ipcMain.handle('workspace:update-todo', (_event, id, patch) => {
    const todos = workspace.updateTodo(id, patch);
    wakeProactive('todo:updated', todos?.find((todo) => todo.id === id)?.title || id);
    return todos;
  });
  ipcMain.handle('workspace:remove-todo', (_event, id) => {
    const todos = workspace.removeTodo(id);
    wakeProactive('todo:removed', id);
    return todos;
  });
  ipcMain.handle('workspace:remember-personal-date', (_event, id) => {
    const result = workspace.rememberPersonalDate(id);
    wakeProactive('todo:remembered-date', result?.personalDate?.title || id);
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
  ipcMain.handle('agent:status', () => agent.getStatus(store.getSettings()));
  ipcMain.handle('agent:chat', (event, messages) =>
    agent.runAgent(messages, store.getSettings(), (delta) => {
      event.sender.send('agent:stream', delta);
    })
  );
  ipcMain.handle('agent:confirm-proposal', (_event, proposal) => agent.confirmProposal(proposal));
  ipcMain.handle('agent:get-suggestions', () => proactive.listSuggestions());
  ipcMain.handle('agent:get-suggestion-history', () => proactive.listSuggestionHistory());
  ipcMain.handle('agent:update-suggestion', (_event, id, patch) => proactive.updateSuggestion(id, patch));
  ipcMain.handle('agent:check-proactive', (_event, force = false) => proactive.checkNow({ force: Boolean(force) }));

  ipcMain.handle('notify:check-todos', () => {
    return notifier.checkNow();
  });
  ipcMain.handle('notify:send-ntfy', (_event, title, message) =>
    notifier.sendPhonePush(store.getSettings(), title, message)
  );
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  library.init(app.getPath('userData'));
  registerIpc();
  createWindow();

  // 启动通知定时器（窗口就绪后）
  notifier.startNotifier();
  proactive.start({
    onUpdated: () => mainWindow?.webContents.send('agent:proactive-updated'),
    onOpenAgent: openAgentWindow,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  proactive.stop();
  notifier.stopNotifier();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
