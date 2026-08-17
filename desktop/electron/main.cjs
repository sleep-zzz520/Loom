const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('node:path');
const store = require('./store.cjs');
const workspace = require('./workspace.cjs');
const agent = require('./agent.cjs');
const notifier = require('./notifier.cjs');
const holidays = require('./holidays.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

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
  ipcMain.handle('data:set-module', (_event, name, items) => store.setModule(name, items));

  ipcMain.handle('workspace:snapshot', () => workspace.snapshot());
  ipcMain.handle('workspace:list-todos', () => workspace.listTodos());
  ipcMain.handle('workspace:create-todo', (_event, input) => workspace.createTodo(input));
  ipcMain.handle('workspace:update-todo', (_event, id, patch) => workspace.updateTodo(id, patch));
  ipcMain.handle('workspace:remove-todo', (_event, id) => workspace.removeTodo(id));
  ipcMain.handle('workspace:list-notes', () => workspace.listNotes());
  ipcMain.handle('workspace:save-note', (_event, input) => workspace.saveNote(input));
  ipcMain.handle('workspace:remove-note', (_event, id) => workspace.removeNote(id));
  ipcMain.handle('calendar:get-holidays', (_event, year) =>
    holidays.getHolidays(year, (url) => net.fetch(url))
  );
  ipcMain.handle('agent:chat', (_event, messages) =>
    agent.runAgent(messages, store.getSettings())
  );

  ipcMain.handle('notify:check-todos', () => {
    notifier.checkNow(store.getSettings());
  });
  ipcMain.handle('notify:send-ntfy', (_event, title, message) =>
    notifier.sendPhonePush(store.getSettings(), title, message)
  );
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  registerIpc();
  createWindow();

  // 启动通知定时器（窗口就绪后）
  notifier.startNotifier(store.getSettings());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
