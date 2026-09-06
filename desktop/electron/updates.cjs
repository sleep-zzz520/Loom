const fs = require('node:fs');
const path = require('node:path');

const STATUS_STATES = new Set([
  'unavailable',
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'installing',
  'up-to-date',
  'error',
]);

function safeText(value, maxLength = 600) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function releaseNotes(value) {
  if (Array.isArray(value)) return safeText(value.map((item) => item?.note || item?.version || '').join(' '));
  return safeText(value);
}

function updateConfigExists(resourcesPath) {
  return Boolean(resourcesPath) && fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
}

function createUpdateService({
  app,
  autoUpdater: suppliedUpdater,
  emitStatus = () => undefined,
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  hasUpdateConfig = updateConfigExists,
} = {}) {
  if (!app || typeof app.getVersion !== 'function') throw new Error('更新服务需要 Electron app 实例');

  let updater = suppliedUpdater || null;
  let initialized = false;
  let checking = false;
  let status = {
    state: 'unavailable',
    currentVersion: safeText(app.getVersion(), 80) || '0.0.0',
    availableVersion: null,
    releaseNotes: '',
    releaseDate: null,
    downloadPercent: null,
    message: '应用内更新尚未初始化。',
    canCheck: false,
    canDownload: false,
    canInstall: false,
  };

  function snapshot() {
    return { ...status };
  }

  function publish(next) {
    status = {
      ...status,
      ...next,
      currentVersion: safeText(app.getVersion(), 80) || status.currentVersion,
    };
    if (!STATUS_STATES.has(status.state)) status.state = 'error';
    emitStatus(snapshot());
    return snapshot();
  }

  function unavailable(message) {
    initialized = true;
    return publish({
      state: 'unavailable',
      availableVersion: null,
      releaseNotes: '',
      releaseDate: null,
      downloadPercent: null,
      message,
      canCheck: false,
      canDownload: false,
      canInstall: false,
    });
  }

  function failure(error) {
    checking = false;
    return publish({
      state: 'error',
      downloadPercent: null,
      message: `更新失败：${safeText(error?.message || error, 180) || '未知错误'}`,
      canCheck: true,
      canDownload: false,
      canInstall: false,
    });
  }

  function attachEvents() {
    updater.on('checking-for-update', () => {
      publish({
        state: 'checking',
        message: '正在检查新版本…',
        canCheck: true,
        canDownload: false,
        canInstall: false,
      });
    });
    updater.on('update-available', (info = {}) => {
      checking = false;
      publish({
        state: 'available',
        availableVersion: safeText(info.version, 80) || null,
        releaseNotes: releaseNotes(info.releaseNotes),
        releaseDate: safeText(info.releaseDate, 80) || null,
        downloadPercent: null,
        message: `发现新版本${info.version ? ` ${safeText(info.version, 80)}` : ''}。下载后由你决定何时重启安装。`,
        canCheck: true,
        canDownload: true,
        canInstall: false,
      });
    });
    updater.on('update-not-available', () => {
      checking = false;
      publish({
        state: 'up-to-date',
        availableVersion: null,
        releaseNotes: '',
        releaseDate: null,
        downloadPercent: null,
        message: '已经是最新版本。',
        canCheck: true,
        canDownload: false,
        canInstall: false,
      });
    });
    updater.on('download-progress', (progress = {}) => {
      const percent = Number(progress.percent);
      publish({
        state: 'downloading',
        downloadPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : null,
        message: '正在下载更新…',
        canCheck: true,
        canDownload: false,
        canInstall: false,
      });
    });
    updater.on('update-downloaded', (info = {}) => {
      checking = false;
      publish({
        state: 'downloaded',
        availableVersion: safeText(info.version, 80) || status.availableVersion,
        releaseNotes: releaseNotes(info.releaseNotes) || status.releaseNotes,
        releaseDate: safeText(info.releaseDate, 80) || status.releaseDate,
        downloadPercent: 100,
        message: '新版本已准备好。点击“重启并更新”后安装。',
        canCheck: true,
        canDownload: false,
        canInstall: true,
      });
    });
    updater.on('error', failure);
  }

  function initialize() {
    if (initialized) return snapshot();
    if (platform === 'darwin') return unavailable('macOS 版采用手动更新。请从 GitHub Releases 下载新版，退出 Loom 后替换应用程序中的旧版本。');
    if (platform !== 'win32') return unavailable('当前平台不提供应用内更新。');
    if (!app.isPackaged) return unavailable('开发模式不检查更新；请从已安装的 Loom 中验证。');
    if (!hasUpdateConfig(resourcesPath)) return unavailable('当前安装包尚未接入正式更新渠道；请下载已配置更新渠道的 Windows 安装包。');

    try {
      updater = updater || require('electron-updater').autoUpdater;
      if (!updater || typeof updater.checkForUpdates !== 'function') throw new Error('更新组件不可用');
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      attachEvents();
      initialized = true;
      return publish({
        state: 'idle',
        message: '可以检查新版本。',
        canCheck: true,
        canDownload: false,
        canInstall: false,
      });
    } catch (error) {
      return unavailable(`应用内更新不可用：${safeText(error?.message || error, 180) || '更新组件加载失败'}`);
    }
  }

  async function check() {
    initialize();
    if (!status.canCheck || checking) return snapshot();
    checking = true;
    publish({
      state: 'checking',
      message: '正在检查新版本…',
      canCheck: true,
      canDownload: false,
      canInstall: false,
    });
    try {
      await updater.checkForUpdates();
      return snapshot();
    } catch (error) {
      return failure(error);
    } finally {
      checking = false;
    }
  }

  async function download() {
    initialize();
    if (status.state !== 'available' || !status.canDownload || typeof updater?.downloadUpdate !== 'function') return snapshot();
    publish({
      state: 'downloading',
      downloadPercent: 0,
      message: '正在下载更新…',
      canCheck: true,
      canDownload: false,
      canInstall: false,
    });
    try {
      await updater.downloadUpdate();
      return snapshot();
    } catch (error) {
      return failure(error);
    }
  }

  function install() {
    initialize();
    if (status.state !== 'downloaded' || !status.canInstall || typeof updater?.quitAndInstall !== 'function') return snapshot();
    publish({
      state: 'installing',
      message: '正在重启并安装更新…',
      canCheck: false,
      canDownload: false,
      canInstall: false,
    });
    try {
      updater.quitAndInstall();
    } catch (error) {
      return failure(error);
    }
    return snapshot();
  }

  return {
    initialize,
    status: () => snapshot(),
    check,
    download,
    install,
  };
}

module.exports = {
  createUpdateService,
  releaseNotes,
  safeText,
  updateConfigExists,
};
