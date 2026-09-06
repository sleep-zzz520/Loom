const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateService, releaseNotes } = require('./updates.cjs');

class FakeUpdater extends EventEmitter {
  async checkForUpdates() {
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.2.0', releaseNotes: '<b>歌单封面修复</b>' });
  }

  async downloadUpdate() {
    this.emit('download-progress', { percent: 42.4 });
    this.emit('update-downloaded', { version: '0.2.0' });
  }

  quitAndInstall() {
    this.installCalled = true;
  }
}

async function run() {
  const updater = new FakeUpdater();
  const events = [];
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '0.1.0' },
    autoUpdater: updater,
    emitStatus: (status) => events.push(status),
    platform: 'win32',
    hasUpdateConfig: () => true,
  });

  assert.equal(service.initialize().state, 'idle');
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await service.check()).state, 'available');
  assert.equal(service.status().availableVersion, '0.2.0');
  assert.equal(service.status().releaseNotes, '歌单封面修复');
  assert.equal((await service.download()).state, 'downloaded');
  assert.equal(service.status().downloadPercent, 100);
  assert.equal(service.install().state, 'installing');
  assert.equal(updater.installCalled, true);
  assert.equal(events.some((status) => status.state === 'downloading' && status.downloadPercent === 42), true);

  const development = createUpdateService({
    app: { isPackaged: false, getVersion: () => '0.1.0' },
    autoUpdater: new FakeUpdater(),
    platform: 'win32',
  });
  assert.equal(development.initialize().state, 'unavailable');
  assert.match(development.status().message, /开发模式/);
  assert.equal(releaseNotes('<p>安全\u0000更新</p>'), '安全 更新');

  for (const platform of ['darwin', 'linux']) {
    const blockedUpdater = new FakeUpdater();
    blockedUpdater.checkForUpdates = () => assert.fail('禁用平台不得检查更新');
    blockedUpdater.downloadUpdate = () => assert.fail('禁用平台不得下载更新');
    blockedUpdater.quitAndInstall = () => assert.fail('禁用平台不得安装更新');
    const blocked = createUpdateService({
      app: { isPackaged: true, getVersion: () => '0.1.0' },
      platform,
      autoUpdater: blockedUpdater,
      hasUpdateConfig: () => true,
    });
    assert.equal(blocked.initialize().state, 'unavailable');
    if (platform === 'darwin') assert.match(blocked.status().message, /手动更新/);
    assert.equal((await blocked.check()).canCheck, false);
    assert.equal((await blocked.download()).canDownload, false);
    assert.equal(blocked.install().canInstall, false);
    assert.equal(blockedUpdater.eventNames().length, 0);
  }
  const noFeed = createUpdateService({
    app: { isPackaged: true, getVersion: () => '0.1.0' },
    platform: 'win32', hasUpdateConfig: () => false,
  });
  assert.equal(noFeed.initialize().canCheck, false);
  console.log('updates self-test ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
