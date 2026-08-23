const DEFAULT_BASE = 'http://127.0.0.1:3000';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

let server = null;
let status = {
  ready: false,
  embedded: true,
  base: DEFAULT_BASE,
  error: '内置音乐服务正在启动',
};

function normaliseBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function shouldEmbed(value) {
  const base = normaliseBase(value);
  return !base || base === DEFAULT_BASE;
}

function waitForListening(candidate) {
  if (candidate?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onListening = () => {
      candidate.removeListener('error', onError);
      resolve();
    };
    const onError = (error) => {
      candidate.removeListener('listening', onListening);
      reject(error);
    };
    candidate.once('listening', onListening);
    candidate.once('error', onError);
  });
}

async function start(settings = {}) {
  if (server?.listening) return { ...status };
  const configuredBase = normaliseBase(settings?.netease?.apiBase);
  if (!shouldEmbed(configuredBase)) {
    status = {
      ready: true,
      embedded: false,
      base: configuredBase,
      error: '',
    };
    return { ...status };
  }

  let candidate = null;
  try {
    // The package exposes the Express server factory through main.js; requiring app.js would start a second unmanaged server.
    const api = require('NeteaseCloudMusicApi');
    const app = await api.serveNcmApi({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      checkVersion: false,
    });
    candidate = app?.server;
    if (!candidate) throw new Error('音乐服务没有返回可管理的服务器实例');
    await waitForListening(candidate);
    server = candidate;
    status = {
      ready: true,
      embedded: true,
      base: DEFAULT_BASE,
      error: '',
    };
    console.log(`[music-service] 内置音乐服务已启动：${DEFAULT_BASE}`);
  } catch (error) {
    if (candidate && !candidate.listening) candidate.close();
    const detail = error?.code === 'EADDRINUSE'
      ? `${DEFAULT_BASE} 端口已被占用`
      : String(error?.message || error || '未知错误');
    status = {
      ready: false,
      embedded: true,
      base: DEFAULT_BASE,
      error: `内置音乐服务启动失败：${detail}`,
    };
    console.error(`[music-service] ${status.error}`);
  }
  return { ...status };
}

function getStatus() {
  return { ...status };
}

function stop() {
  const current = server;
  server = null;
  if (!current) return Promise.resolve();
  return new Promise((resolve) => {
    current.close(() => resolve());
  });
}

module.exports = {
  DEFAULT_BASE,
  normaliseBase,
  shouldEmbed,
  start,
  getStatus,
  stop,
};

if (process.env.WORKBENCH_MUSIC_SERVICE_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  assert.equal(normaliseBase('http://127.0.0.1:3000/'), DEFAULT_BASE);
  assert.equal(shouldEmbed(''), true);
  assert.equal(shouldEmbed(DEFAULT_BASE), true);
  assert.equal(shouldEmbed('http://music.example.test'), false);
  void start({ netease: { apiBase: 'http://music.example.test' } }).then((result) => {
    assert.equal(result.embedded, false);
    assert.equal(result.base, 'http://music.example.test');
    console.log('music service self-test ok');
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
