const http = require('node:http');
const path = require('node:path');
const security = require('./security.cjs');

const DEFAULT_BASE = 'http://127.0.0.1:3000';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

const MUSIC_ROUTE_MODULES = [
  ['login_status', '/login/status'],
  ['user_account', '/user/account'],
  ['user_playlist', '/user/playlist'],
  ['song_detail', '/song/detail'],
  ['playlist_track_all', '/playlist/track/all'],
  ['playlist_detail', '/playlist/detail'],
  ['login_qr_key', '/login/qr/key'],
  ['login_qr_create', '/login/qr/create'],
  ['login_qr_check', '/login/qr/check'],
  ['playlist_tracks', '/playlist/tracks'],
  ['logout', '/logout'],
  ['search', '/search'],
  ['search_hot_detail', '/search/hot/detail'],
  ['lyric', '/lyric'],
  ['song_url_v1', '/song/url/v1'],
  ['song_url', '/song/url'],
];

let server = null;
let status = {
  ready: false,
  embedded: true,
  base: DEFAULT_BASE,
  error: '内置音乐服务正在启动',
};

function normaliseBase(value) {
  const raw = String(value || '').trim();
  return raw ? security.normaliseServiceEndpoint(raw) : '';
}

function musicModuleDefinitions() {
  const serverPath = require.resolve('NeteaseCloudMusicApi/server');
  const modulesDirectory = path.join(path.dirname(serverPath), 'module');
  return MUSIC_ROUTE_MODULES.map(([name, route]) => ({
    identifier: name,
    route,
    module: require(path.join(modulesDirectory, `${name}.js`)),
  }));
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

function probeExistingService(base = DEFAULT_BASE) {
  const target = `${normaliseBase(base) || DEFAULT_BASE}/`;
  return new Promise((resolve) => {
    const request = http.get(target, { timeout: 1500 }, (response) => {
      response.resume();
      resolve(true);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
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
    // 只加载 Loom 实际调用的模块，避免把第三方包的文件上传、云盘等整套路由暴露在本机端口。
    const { serveNcmApi } = require('NeteaseCloudMusicApi/server');
    const app = await serveNcmApi({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      checkVersion: false,
      moduleDefs: musicModuleDefinitions(),
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
  } catch (error) {
    if (candidate && !candidate.listening) candidate.close();
    if (error?.code === 'EADDRINUSE' && await probeExistingService(DEFAULT_BASE)) {
      status = {
        ready: true,
        embedded: true,
        base: DEFAULT_BASE,
        error: '',
      };
      return { ...status };
    }
    const detail = error?.code === 'EADDRINUSE'
      ? `${DEFAULT_BASE} 端口已被占用`
      : String(error?.message || error || '未知错误');
    status = {
      ready: false,
      embedded: true,
      base: DEFAULT_BASE,
      error: `内置音乐服务启动失败：${detail}`,
    };
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
  MUSIC_ROUTE_MODULES,
  normaliseBase,
  musicModuleDefinitions,
  shouldEmbed,
  probeExistingService,
  start,
  getStatus,
  stop,
};

if (process.env.WORKBENCH_MUSIC_SERVICE_SELF_TEST === '1') {
  const assert = require('node:assert/strict');
  void (async () => {
    assert.equal(normaliseBase('http://127.0.0.1:3000/'), DEFAULT_BASE);
    assert.equal(shouldEmbed(''), true);
    assert.equal(shouldEmbed(DEFAULT_BASE), true);
    assert.equal(shouldEmbed('https://music.example.test'), false);
    const definitions = musicModuleDefinitions();
    assert.equal(definitions.length, MUSIC_ROUTE_MODULES.length);
    assert.ok(definitions.some((definition) => definition.route === '/song/url/v1'));
    assert.equal(definitions.some((definition) => definition.route === '/cloud'), false);
    assert.equal(Object.keys(require.cache).some((file) => file.includes(`${path.sep}music-metadata${path.sep}`)), false);

    const probeServer = http.createServer((_request, response) => response.writeHead(204).end());
    probeServer.listen({ host: DEFAULT_HOST, port: 0 });
    await waitForListening(probeServer);
    const port = probeServer.address().port;
    assert.equal(await probeExistingService(`http://${DEFAULT_HOST}:${port}`), true);
    await new Promise((resolve) => probeServer.close(resolve));
    assert.equal(await probeExistingService(`http://${DEFAULT_HOST}:${port}`), false);

    const result = await start({ netease: { apiBase: 'https://music.example.test' } });
    assert.equal(result.embedded, false);
    assert.equal(result.base, 'https://music.example.test');
    console.log('music service self-test ok');
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
