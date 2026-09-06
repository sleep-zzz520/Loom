const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'loom';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

function normaliseDevOrigin(devServerUrl = '') {
  try {
    return new URL(String(devServerUrl || '')).origin;
  } catch {
    return '';
  }
}

function isTrustedRendererUrl(value, devServerUrl = '') {
  try {
    const url = new URL(String(value || ''));
    const devOrigin = normaliseDevOrigin(devServerUrl);
    if (devOrigin) return url.origin === devOrigin;
    return url.protocol === `${APP_SCHEME}:` && url.hostname === APP_HOST;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:') return true;
    return url.protocol === 'mailto:' && Boolean(url.pathname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost'
    || host === '[::1]'
    || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function normaliseServiceEndpoint(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || (url.protocol === 'http:' && !isLoopbackHost(url.hostname))
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return '';
  }
}

function serviceOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function hasServiceOriginChanged(previousValue, nextValue) {
  const nextOrigin = serviceOrigin(nextValue);
  return Boolean(nextOrigin && nextOrigin !== serviceOrigin(previousValue));
}

function requireServiceEndpoint(value, label = '服务地址') {
  const endpoint = normaliseServiceEndpoint(value);
  if (!endpoint) {
    throw new Error(`${label}无效：远程服务必须使用 HTTPS；仅本机 localhost、127.0.0.1 或 [::1] 可使用 HTTP`);
  }
  return endpoint;
}

function resolveAppAssetPath(requestUrl, distDir) {
  try {
    const url = new URL(String(requestUrl || ''));
    if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST) return null;
    const pathname = decodeURIComponent(url.pathname || '/');
    if (pathname.includes('\0')) return null;
    const relativePath = pathname.replace(/^[/\\]+/, '') || 'index.html';
    const root = path.resolve(distDir);
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  }]);
}

function registerAppProtocol(protocol, net, distDir) {
  protocol.handle(APP_SCHEME, (request) => {
    const assetPath = resolveAppAssetPath(request.url, distDir);
    if (!assetPath) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

function lockDownSession(session) {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function installRendererGuards(webContents, { devServerUrl = '', openExternal = () => undefined } = {}) {
  const allowRendererUrl = (url) => isTrustedRendererUrl(url, devServerUrl);
  const blockUnexpectedNavigation = (event, url) => {
    if (!allowRendererUrl(url)) event.preventDefault();
  };

  webContents.on('will-navigate', blockUnexpectedNavigation);
  webContents.on('will-redirect', blockUnexpectedNavigation);
  webContents.on('will-attach-webview', (event) => event.preventDefault());
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      setImmediate(() => {
        Promise.resolve(openExternal(url)).catch(() => {});
      });
    }
    return { action: 'deny' };
  });
}

function assertTrustedIpcSender(event, expectedWebContents, devServerUrl = '') {
  const frame = event?.senderFrame;
  if (
    !expectedWebContents
    || event?.sender !== expectedWebContents
    || frame !== expectedWebContents.mainFrame
    || !isTrustedRendererUrl(frame?.url, devServerUrl)
  ) {
    throw new Error('已拒绝来自非受信任页面的请求');
  }
}

module.exports = {
  APP_SCHEME,
  APP_ORIGIN,
  APP_ENTRY_URL,
  normaliseDevOrigin,
  isTrustedRendererUrl,
  isSafeExternalUrl,
  isLoopbackHost,
  normaliseServiceEndpoint,
  serviceOrigin,
  hasServiceOriginChanged,
  requireServiceEndpoint,
  resolveAppAssetPath,
  registerAppScheme,
  registerAppProtocol,
  lockDownSession,
  installRendererGuards,
  assertTrustedIpcSender,
};

if (process.env.WORKBENCH_SECURITY_SELF_TEST === '1') {
  const assert = require('node:assert/strict');

  assert.equal(isTrustedRendererUrl('loom://app/index.html'), true);
  assert.equal(isTrustedRendererUrl('loom://attacker/index.html'), false);
  assert.equal(isTrustedRendererUrl('file:///etc/passwd'), false);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', 'http://127.0.0.1:5174'), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174.attacker.test/', 'http://127.0.0.1:5174'), false);
  assert.equal(isSafeExternalUrl('https://example.com/path'), true);
  assert.equal(isSafeExternalUrl('mailto:hello@example.com'), true);
  assert.equal(isSafeExternalUrl('http://example.com'), false);
  assert.equal(isSafeExternalUrl('file:///Applications/Calculator.app'), false);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('127.0.0.1.attacker.test'), false);
  assert.equal(normaliseServiceEndpoint('https://API.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(normaliseServiceEndpoint('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(normaliseServiceEndpoint('http://agent.example.com/v1'), '');
  assert.equal(normaliseServiceEndpoint('https://api.example.com/v1?token=unsafe'), '');
  assert.equal(serviceOrigin('https://api.example.com/v1'), 'https://api.example.com');
  assert.equal(hasServiceOriginChanged('https://api.example.com/v1', 'https://api.example.com/v2'), false);
  assert.equal(hasServiceOriginChanged('https://api.example.com/v1', 'https://attacker.example/v1'), true);
  const testDist = path.resolve(require('node:os').tmpdir(), 'loom-dist');
  assert.equal(resolveAppAssetPath('loom://app/assets/app.js', testDist), path.join(testDist, 'assets', 'app.js'));
  assert.equal(resolveAppAssetPath('loom://app/%2e%2e%2fsecret.txt', testDist), null);
  assert.equal(resolveAppAssetPath('loom://attacker/index.html', testDist), null);

  const sessionHandlers = {};
  lockDownSession({
    setPermissionCheckHandler(handler) { sessionHandlers.check = handler; },
    setPermissionRequestHandler(handler) { sessionHandlers.request = handler; },
  });
  assert.equal(sessionHandlers.check(), false);
  let permissionGranted = true;
  sessionHandlers.request(null, 'media', (granted) => { permissionGranted = granted; });
  assert.equal(permissionGranted, false);

  const handlers = {};
  let opened = '';
  const fakeContents = {
    mainFrame: { url: APP_ENTRY_URL },
    on(name, handler) { handlers[name] = handler; },
    setWindowOpenHandler(handler) { handlers.windowOpen = handler; },
  };
  installRendererGuards(fakeContents, { openExternal: (url) => { opened = url; } });
  const blocked = { prevented: false, preventDefault() { this.prevented = true; } };
  handlers['will-navigate'](blocked, 'https://attacker.test');
  assert.equal(blocked.prevented, true);
  assert.deepEqual(handlers.windowOpen({ url: 'https://example.com' }), { action: 'deny' });
  setImmediate(() => {
    assert.equal(opened, 'https://example.com');
    assert.deepEqual(handlers.windowOpen({ url: 'file:///tmp/unsafe' }), { action: 'deny' });
    const event = { sender: fakeContents, senderFrame: fakeContents.mainFrame };
    assert.doesNotThrow(() => assertTrustedIpcSender(event, fakeContents));
    assert.throws(() => assertTrustedIpcSender({ sender: fakeContents, senderFrame: { url: 'https://attacker.test' } }, fakeContents), /非受信任/);
    console.log('security self-test ok');
  });
}
