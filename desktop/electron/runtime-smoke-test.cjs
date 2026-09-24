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
  const evaluate = (fn, ...args) => contents.executeJavaScript(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`);

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

  await evaluate(async () => {
    [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '周回顾').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.weekly-page .weekly-empty')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const page = document.querySelector('.weekly-page');
    if (!page || page.querySelectorAll('.weekly-section').length !== 4 || page.querySelector('.weekly-summary')
      || page.querySelectorAll('.weekly-empty').length !== 4
      || !page.querySelector('.weekly-plan-action')) {
      throw new Error('Empty weekly review should retain four brief placeholders and next-week planning');
    }
    page.querySelector('.weekly-plan-action').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.weekly-plan-dialog')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!document.querySelector('.weekly-plan-dialog')) throw new Error('Next-week planning did not open');
    document.querySelector('.weekly-plan-close').click();
  });
  const overdueAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  require('./store.cjs').setModule('todos', ['待处理事项一', '待处理事项二'].map((title, index) => ({
    id: `weekly-${index}`, title, priority: 'medium', start: null, end: null,
    due: overdueAt, done: false, repeat: 'none', repeatUntil: null,
    color: null, personalDateId: null, recurrenceId: null, createdAt: overdueAt,
  })));
  await evaluate(async () => {
    document.querySelector('.weekly-refresh').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelectorAll('.weekly-overdue .weekly-item-list button').length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const page = document.querySelector('.weekly-page');
    if (page.querySelectorAll('.weekly-overdue .weekly-item-list button').length !== 2
      || page.querySelectorAll('.weekly-section').length !== 4
      || page.querySelectorAll('.weekly-empty').length !== 3 || page.querySelector('.weekly-summary')) {
      throw new Error('Weekly review should show overdue records with placeholders for empty sections');
    }
  });
  if (process.env.LOOM_CAPTURE_WEEKLY === '1') {
    win.setContentSize(1440, 876);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const screenshotPath = path.join(testDirectory, 'weekly-review.png');
    fs.writeFileSync(screenshotPath, (await contents.capturePage()).toPNG());
    console.log(`[runtime] Weekly review screenshot: ${screenshotPath}`);
  }
  require('./store.cjs').setModule('todos', []);
  await evaluate(async () => {
    [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '今日').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.today-page')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Today page did not return after weekly review');
  });
  console.log('[runtime] weekly review keeps brief placeholders and planning available');

  // Settings should replace the app sidebar and keep its categories in one rail.
  await evaluate(async () => {
    [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '设置').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.profile-avatar-input') && document.querySelector('.app-shell--settings')
        && !document.querySelector('.sidebar') && document.querySelector('.settings-back')
        && document.querySelectorAll('.settings-category-sidebar .settings-category-group').length === 2) {
        if (document.querySelector('.settings-eyebrow')) throw new Error('Settings eyebrow is still visible');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Standalone profile settings did not render');
  });
  for (const width of [960, 1280]) {
    win.setContentSize(width, 740);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const layout = await evaluate(() => {
      const root = document.documentElement;
      const content = document.querySelector('.content');
      const section = document.querySelector('.settings-section');
      const sidebar = document.querySelector('.settings-category-sidebar');
      section.scrollTop = section.scrollHeight;
      return {
        outerOverflow: root.scrollWidth > root.clientWidth || root.scrollHeight > root.clientHeight,
        contentOverflowX: content.scrollWidth > content.clientWidth,
        canScroll: section.scrollTop > 0,
        fileInputHidden: document.querySelector('.profile-avatar-input').getClientRects().length === 0,
        sidebarLeft: sidebar.getBoundingClientRect().left,
        contentRightGap: root.clientWidth - section.getBoundingClientRect().right,
      };
    });
    assert.deepEqual({ outerOverflow: layout.outerOverflow, contentOverflowX: layout.contentOverflowX,
      canScroll: layout.canScroll, fileInputHidden: layout.fileInputHidden },
    { outerOverflow: false, contentOverflowX: false, canScroll: true, fileInputHidden: true }, `Profile layout at ${width}px`);
    assert.ok(layout.sidebarLeft <= 50 && layout.contentRightGap <= 80,
      `Settings should use the available width at ${width}px: ${JSON.stringify(layout)}`);
  }
  console.log('[runtime] profile has no outer scrollbars; content scrolling preserved');
  if (process.env.LOOM_CAPTURE_SETTINGS === '1') {
    win.setContentSize(1440, 876);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const profilePosition = await evaluate(() => {
      const section = document.querySelector('.settings-section');
      section.scrollTop = 0;
      return { scrollTop: section.scrollTop, headerTop: section.querySelector('.settings-page-header').getBoundingClientRect().top };
    });
    assert.ok(profilePosition.headerTop >= 0, `Profile header should be visible: ${JSON.stringify(profilePosition)}`);
    const screenshotPath = path.join(testDirectory, 'profile-settings.png');
    fs.writeFileSync(screenshotPath, (await contents.capturePage()).toPNG());
    console.log(`[runtime] Profile settings screenshot: ${screenshotPath}`);
  }

  await evaluate(async () => {
    const nameInput = document.querySelector('.settings-profile-fields input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(nameInput, 'Runtime profile');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (document.querySelector('.settings-save-state.saving')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    document.querySelector('.settings-back').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.today-page') && document.querySelector('.sidebar')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!document.querySelector('.today-page') || (await window.workbench.data.getSettings()).profile.name !== 'Runtime profile') {
      throw new Error('Settings back did not save changes and restore the previous page');
    }
    [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '设置').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.settings-category-sidebar')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Settings did not reopen');
  });
  console.log('[runtime] settings back saved changes and restored origin');

  await evaluate(async () => {
    const section = [...document.querySelectorAll('.settings-category-sidebar button')].find((item) => item.textContent.trim() === 'GitHub');
    if (!section) throw new Error('GitHub settings category missing');
    section.click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.github-connection-intro')?.getClientRects().length
        && document.body.innerText.includes('尚未配置')) {
        const panel = document.querySelector('.settings-config-panel');
        const firstVisibleSection = panel.querySelector('.settings-subsection:not([hidden])');
        if (document.querySelector('.settings-config-picker')
          || panel.getBoundingClientRect().right > document.querySelector('.settings-section').getBoundingClientRect().right + 1) {
          throw new Error('GitHub settings retained a second navigation or overflowed the form width');
        }
        if (getComputedStyle(firstVisibleSection).borderTopWidth !== '0px') {
          throw new Error('A divider remains between the settings title and its content');
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('GitHub connection settings did not render');
  });
  console.log('[runtime] GitHub MCP settings rendered');
  if (process.env.LOOM_CAPTURE_GITHUB === '1') {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const screenshotPath = path.join(testDirectory, 'github-settings.png');
    fs.writeFileSync(screenshotPath, (await contents.capturePage()).toPNG());
    console.log(`[runtime] GitHub screenshot: ${screenshotPath}`);
  }

  await evaluate(async () => {
    const tokenInput = document.querySelector('.github-token-field input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(tokenInput, 'loom-github-ui-test-only');
    tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await window.workbench.github.status();
      if (status.tokenConfigured && tokenInput.value === '' && document.body.innerText.includes('已保存令牌')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('GitHub token was not saved and hidden in the settings UI');
  });
  console.log('[runtime] GitHub token save and hidden-state UI passed');

  for (const category of ['模型服务', 'GitHub', '音乐服务', '数据与恢复', '应用更新']) {
    await evaluate(async (category) => {
      const button = [...document.querySelectorAll('.settings-category-sidebar button')]
        .find((item) => item.textContent.trim() === category);
      button.click();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (document.querySelector('#settings-page-title')?.textContent.trim() === category) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const page = document.querySelector('.settings-section');
      if (page.querySelector('#settings-page-title')?.textContent.trim() !== category) {
        throw new Error(`${category} page did not render`);
      }
      const duplicate = [...page.querySelectorAll('h3, .settings-advanced-summary-copy strong')]
        .some((item) => item.getClientRects().length && item.textContent.trim() === category);
      if (duplicate) throw new Error(`${category} title appears twice`);
      if (category === '模型服务' && page.querySelector('.settings-model-manager').getBoundingClientRect().height < 100) {
        throw new Error('Model editor lost its available height');
      }
    }, category);
    if (process.env.LOOM_CAPTURE_SETTINGS === '1') {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const screenshotPath = path.join(testDirectory, `settings-${category === '模型服务' ? 'models' : category === 'GitHub' ? 'github' : category === '音乐服务' ? 'music' : category === '数据与恢复' ? 'recovery' : 'updates'}.png`);
      fs.writeFileSync(screenshotPath, (await contents.capturePage()).toPNG());
      console.log(`[runtime] ${category} screenshot: ${screenshotPath}`);
    }
  }
  console.log('[runtime] settings category titles do not repeat');

  await evaluate(async () => {
    document.querySelector('.settings-back').click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.sidebar') && document.querySelector('.today-page')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!document.querySelector('.sidebar') || document.querySelector('.app-shell--settings')) {
      throw new Error('Settings back button did not restore the previous page');
    }
    const musicButton = [...document.querySelectorAll('.sidebar button')].find((item) => item.textContent.trim() === '音乐');
    if (!musicButton) throw new Error('Music navigation button missing');
    musicButton.click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelectorAll('.music-discover-feature-grid .music-feature-art').length === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Music discovery cards did not render');
  });
  for (const [width, height] of [[960, 740], [1280, 740], [1280, 820]]) {
    win.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const layout = await evaluate(() => {
      const arts = [...document.querySelectorAll('.music-discover-feature-grid .music-feature-art')];
      const content = document.querySelector('.content');
      const player = document.querySelector('.music-player');
      const cards = [...document.querySelectorAll('.music-discover-feature-grid .music-feature-card')];
      const moodHeading = document.querySelector('.music-mood-heading');
      const quickHeading = document.querySelector('.music-quick-section .music-shelf-heading');
      const quickCard = document.querySelector('.music-quick-grid .music-quick-card');
      const playerTop = player.getBoundingClientRect().top;
      const artBounds = arts.map((art) => art.getBoundingClientRect());
      const cardBounds = cards.map((card) => card.getBoundingClientRect());
      const copyBounds = cards.map((card) => ({
        cardBottom: card.getBoundingClientRect().bottom,
        copyBottom: card.querySelector('.music-feature-copy').getBoundingClientRect().bottom,
      }));
      return {
        artHeights: artBounds.map((art) => art.height),
        cardPositions: cardBounds.map((card) => ({ top: card.top, bottom: card.bottom, left: card.left })),
        squareArtwork: artBounds.every((art) => Math.abs(art.width - art.height) <= 1),
        oneRow: cardBounds.every((card) => Math.abs(card.top - cardBounds[0].top) <= 5),
        copyBelowArt: cards.every((card, index) => card.querySelector('.music-feature-copy').getBoundingClientRect().top >= artBounds[index].bottom),
        moodHeadingGap: cardBounds[0].top - moodHeading.getBoundingClientRect().bottom,
        quickHeadingGap: quickHeading && quickCard ? quickCard.getBoundingClientRect().top - quickHeading.getBoundingClientRect().bottom : null,
        contentOverflowX: content.scrollWidth > content.clientWidth,
        contentOverflowY: content.scrollHeight > content.clientHeight + 1,
        outerOverflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        cardsCoveredByPlayer: cards.some((card) => card.getBoundingClientRect().bottom > playerTop),
        copyEscapesCard: copyBounds.some(({ cardBottom, copyBottom }) => copyBottom > cardBottom + 1),
        copyPlayerClearance: Math.min(...copyBounds.map(({ copyBottom }) => playerTop - copyBottom)),
      };
    });
    assert.equal(layout.artHeights.length, 4, `Music artwork count at ${width}×${height}`);
    assert.equal(layout.squareArtwork, true, `Mood artwork should be square at ${width}×${height}`);
    assert.equal(layout.oneRow, true, `Mood entries should share one row at ${width}×${height}: ${JSON.stringify(layout.cardPositions)}`);
    assert.equal(layout.copyBelowArt, true, `Mood titles should sit below artwork at ${width}×${height}`);
    assert.ok(layout.moodHeadingGap >= 14 && layout.moodHeadingGap <= 24, `Mood artwork should keep the shared shelf spacing at ${width}×${height}: ${layout.moodHeadingGap}`);
    if (layout.quickHeadingGap !== null) assert.ok(Math.abs(layout.moodHeadingGap - layout.quickHeadingGap) <= 4, `Music shelves should share heading spacing at ${width}×${height}`);
    assert.equal(layout.contentOverflowX, false, `Music layout horizontal overflow at ${width}×${height}`);
    assert.equal(layout.contentOverflowY, false, `Music discovery must fit one page at ${width}×${height}`);
    assert.equal(layout.outerOverflowY, false, `Music discovery must not create document scrolling at ${width}×${height}`);
    assert.equal(layout.cardsCoveredByPlayer, false, `Music cards must stay above the player at ${width}×${height}`);
    assert.equal(layout.copyEscapesCard, false, `Music card text must stay inside its card at ${width}×${height}`);
    assert.ok(layout.copyPlayerClearance >= 12, `Music card text needs 12px of clearance above the player at ${width}×${height}`);
    assert.ok(layout.artHeights.every((artHeight) => artHeight >= 80), `Music artwork must remain legible at ${width}×${height}: ${JSON.stringify(layout.artHeights)}`);
  }
  if (process.env.LOOM_CAPTURE_MUSIC_MOOD === '1') {
    win.setContentSize(1440, 876);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const screenshotPath = path.join(testDirectory, 'music-mood.png');
    fs.writeFileSync(screenshotPath, (await contents.capturePage()).toPNG());
    console.log(`[runtime] Music mood screenshot: ${screenshotPath}`);
  }
  console.log('[runtime] music discovery stays in one page and above the fixed player');

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
      github: { enabled: true, token: 'loom-github-runtime-test-only' },
    });
    if (result.agent.apiKey !== '') throw new Error('Credential leaked to renderer');
    if (result.github.token !== '') throw new Error('GitHub token leaked to renderer');
  });
  console.log('[runtime] synthetic credential saved');
  const store = require('./store.cjs');
  const secrets = require('./secrets.cjs');
  const saved = JSON.parse(fs.readFileSync(path.join(testDirectory, 'workbench-data.json'), 'utf8'));
  assert.match(saved.settings.agent.apiKey, /^safe-storage:v1:/);
  assert.match(saved.settings.github.token, /^safe-storage:v1:/);
  assert.equal(secrets.withDecryptedAgentApiKey(store.getSettings()).agent.apiKey, 'loom-runtime-test-only');
  assert.equal(secrets.withDecryptedGithubToken(store.getSettings()).github.token, 'loom-github-runtime-test-only');
  assert.equal(JSON.stringify(saved).includes('loom-runtime-test-only'), false);
  assert.equal(JSON.stringify(saved).includes('loom-github-runtime-test-only'), false);
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
