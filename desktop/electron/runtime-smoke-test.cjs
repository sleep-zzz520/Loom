const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { app, safeStorage } = require('electron');

// Exercise the real main process, preload and built React UI without opening
// the user's data directory or connecting to their configured accounts.
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-runtime-'));
app.setPath('userData', testDirectory);
app.setPath('sessionData', testDirectory);
fs.writeFileSync(path.join(testDirectory, 'workbench-data.json'), JSON.stringify({
  settings: { agent: { proactiveEnabled: false, emailMonitorEnabled: false } },
}));

const failures = [];
const keepOpen = process.argv.includes('--keep-open');
const deadline = setTimeout(() => {
  console.error('runtime smoke test timed out');
  app.exit(1);
}, 45000);

async function run(win) {
  const contents = win.webContents;
  contents.on('preload-error', (_event, _file, error) => failures.push(`preload: ${error.message}`));
  contents.on('render-process-gone', (_event, details) => failures.push(`renderer: ${details.reason}`));
  await once(contents, 'did-finish-load');
  console.log('[runtime] renderer loaded');
  const evaluate = (fn) => contents.executeJavaScript(`(${fn.toString()})()`);

  await evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (window.workbench && document.querySelector('.sidebar')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('React sidebar or preload bridge did not initialize');
  });
  assert.equal(contents.getURL(), process.env.VITE_DEV_SERVER_URL || 'loom://app/index.html');
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);

  // Hidden file inputs must not enlarge the viewport and create outer scrollbars.
  await evaluate(async () => {
    [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '设置').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '个人资料').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.profile-avatar-input')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Profile settings did not render');
  });
  for (const width of [960, 1280]) {
    win.setContentSize(width, 740);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const layout = await evaluate(() => {
      const root = document.documentElement;
      const content = document.querySelector('.content');
      content.scrollTop = content.scrollHeight;
      return {
        outerOverflow: root.scrollWidth > root.clientWidth || root.scrollHeight > root.clientHeight,
        contentOverflowX: content.scrollWidth > content.clientWidth,
        canScroll: content.scrollTop > 0,
        fileInputHidden: document.querySelector('.profile-avatar-input').getClientRects().length === 0,
      };
    });
    assert.deepEqual(layout, { outerOverflow: false, contentOverflowX: false, canScroll: true, fileInputHidden: true }, `Profile layout at ${width}px`);
  }
  console.log('[runtime] profile has no outer scrollbars; content scrolling preserved');

  const initial = await evaluate(async () => ({
    title: document.title,
    nodeAvailable: typeof window.require !== 'undefined',
    service: await window.workbench.music.serviceStatus(),
    updates: await window.workbench.updates.status(),
    mail: await window.workbench.mail.account(),
    todos: await window.workbench.workspace.todos.list(),
  }));
  assert.match(initial.title, /Loom/);
  assert.equal(initial.nodeAvailable, false);
  assert.equal(initial.service.ready, true);
  assert.equal(initial.service.embedded, true);
  assert.equal(initial.updates.state, 'unavailable');
  assert.equal(initial.todos.length, 0);
  assert.equal((await fetch(initial.service.base, { signal: AbortSignal.timeout(5000) })).status, 200);
  assert.equal((await fetch(`${initial.service.base}/cloud`, { signal: AbortSignal.timeout(5000) })).status, 404);
  console.log('[runtime] renderer, IPC and HTTP service passed');

  await evaluate(async () => {
    await window.workbench.workspace.todos.create({ title: '升级验证：中文待办' });
    await window.workbench.workspace.notes.save({ title: '升级验证笔记', content: '中文数据可保存' });
    const button = [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '待办');
    if (!button) throw new Error('Todo navigation button missing');
    button.click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.body.innerText.includes('升级验证：中文待办')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Saved todo did not render through IPC');
  });

  console.log('[runtime] todo and note rendered; checking safeStorage');
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'OS credential encryption unavailable');
  console.log('[runtime] safeStorage available; saving synthetic credential');
  await evaluate(async () => {
    const result = await window.workbench.data.setSettings({
      agent: { apiBase: 'https://example.invalid/v1', apiKey: 'loom-runtime-test-only', model: 'test' },
    });
    if (result.agent.apiKey !== '') throw new Error('Credential leaked to renderer');
  });
  console.log('[runtime] synthetic credential saved');
  const store = require('./store.cjs');
  const secrets = require('./secrets.cjs');
  const saved = JSON.parse(fs.readFileSync(path.join(testDirectory, 'workbench-data.json'), 'utf8'));
  assert.match(saved.settings.agent.apiKey, /^safe-storage:v1:/);
  assert.equal(secrets.withDecryptedAgentApiKey(store.getSettings()).agent.apiKey, 'loom-runtime-test-only');
  assert.equal(JSON.stringify(saved).includes('loom-runtime-test-only'), false);
  assert.equal(saved.modules.todos[0].title, '升级验证：中文待办');
  assert.equal(saved.modules.notes[0].title, '升级验证笔记');
  store.setSettings({ agent: { apiBase: '', apiKey: '', model: '' } });

  const reloaded = once(contents, 'did-finish-load');
  contents.reload();
  await reloaded;
  const persisted = await evaluate(async () => ({
    todos: await window.workbench.workspace.todos.list(),
    notes: await window.workbench.workspace.notes.list(),
  }));
  assert.equal(persisted.todos[0].title, '升级验证：中文待办');
  assert.equal(persisted.notes[0].title, '升级验证笔记');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({
    result: 'runtime smoke test ok',
    electron: process.versions.electron,
    node: process.versions.node,
    renderer: contents.getURL(),
    checks: ['React rendering', 'sandboxed preload', 'IPC CRUD', 'disk persistence',
      'real safeStorage encryption', 'embedded HTTP service', 'cloud route blocked', 'update status'],
    testDirectory,
  }));
  clearTimeout(deadline);
  if (!keepOpen) app.quit();
}

app.once('browser-window-created', (_event, win) => {
  run(win).catch((error) => {
    clearTimeout(deadline);
    console.error(error);
    app.exit(1);
  });
});

require('./main.cjs');
