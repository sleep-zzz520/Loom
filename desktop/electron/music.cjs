const fs = require('node:fs');
const path = require('node:path');
const secrets = require('./secrets.cjs');
const security = require('./security.cjs');

function safeText(value, limit = 300) {
  return String(value || '').trim().slice(0, limit);
}

const COOKIE_ATTRIBUTES = new Set(['domain', 'expires', 'httponly', 'max-age', 'partitioned', 'path', 'priority', 'samesite', 'secure']);

let sessionFile = '';

function init(userDataDir) {
  sessionFile = path.join(userDataDir, 'music-session.json');
}

function emptyLibrary() {
  return {
    account: null,
    playlists: [],
    tracksByPlaylist: {},
    selectedPlaylistId: null,
    syncedAt: null,
  };
}

function readSession() {
  if (!sessionFile || !fs.existsSync(sessionFile)) return '';
  try {
    const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const cookie = saved?.cookie;
    // 旧版本的明文会在启动时迁移；安全存储不可用时不再继续使用它。
    if (cookie && !secrets.isEncrypted(cookie) && !secrets.canEncrypt()) return '';
    return normaliseCookie(secrets.decrypt(cookie, '音乐账号登录凭据'));
  } catch {
    return '';
  }
}

function saveSession(cookie) {
  const value = normaliseCookie(cookie);
  if (!value) throw new Error('音乐账号登录凭据为空');
  if (!sessionFile) throw new Error('音乐账号存储尚未初始化');
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  const tempFile = `${sessionFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ cookie: secrets.encrypt(value, '音乐账号登录凭据') }, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempFile, sessionFile);
  try {
    fs.chmodSync(sessionFile, 0o600);
  } catch {
    // 部分平台不支持权限位，仍保留主进程隔离和文件不经 IPC 暴露的边界。
  }
}

function clearSession() {
  if (!sessionFile || !fs.existsSync(sessionFile)) return;
  fs.unlinkSync(sessionFile);
}

function migrateSession() {
  if (!sessionFile || !fs.existsSync(sessionFile) || !secrets.canEncrypt()) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (!saved?.cookie || secrets.isEncrypted(saved.cookie)) return false;
    saveSession(saved.cookie);
    return true;
  } catch {
    return false;
  }
}

function buildUrl(settings, pathname, params = {}) {
  const base = security.requireServiceEndpoint(safeText(settings?.netease?.apiBase, 500), '音乐服务地址');
  const url = new URL(`${base}/${String(pathname || '').replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request(settings, pathname, params, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('当前环境不支持访问音乐服务');
  let response;
  try {
    const requestInit = options.cookie ? { headers: { Cookie: options.cookie } } : undefined;
    response = await fetcher(buildUrl(settings, pathname, params), requestInit);
  } catch {
    throw new Error('无法连接音乐服务，请确认服务地址正确且服务正在运行');
  }
  if (!response?.ok) throw new Error(`音乐服务请求失败${response?.status ? ` (${response.status})` : ''}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('音乐服务返回了无法识别的数据');
  }
  const responseCode = Number(payload?.code);
  if (responseCode >= 400 && !options.allowCodes?.includes(responseCode)) {
    throw new Error(safeText(payload.message || payload.msg, 160) || '音乐服务暂时不可用');
  }
  return payload || {};
}

function normaliseTrack(song) {
  const id = Number(song?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const artists = Array.isArray(song.ar) ? song.ar : Array.isArray(song.artists) ? song.artists : [];
  const album = song.al || song.album || {};
  return {
    id,
    title: safeText(song.name || song.title, 180) || '未知歌曲',
    artists: artists.map((artist) => safeText(artist?.name, 80)).filter(Boolean).join(' / ') || safeText(song.artists, 180) || '未知艺人',
    album: safeText(typeof album === 'string' ? album : album.name, 180),
    coverUrl: safeText(album.picUrl || song.picUrl || song.coverUrl, 800) || null,
    durationMs: Number.isFinite(Number(song.dt || song.duration || song.durationMs)) ? Number(song.dt || song.duration || song.durationMs) : null,
  };
}

function tracksFromSearch(payload) {
  const songs = Array.isArray(payload?.result?.songs) ? payload.result.songs : [];
  return songs.map(normaliseTrack).filter(Boolean);
}

function hotTermsFromResponse(payload) {
  const terms = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.result?.hots) ? payload.result.hots : [];
  return terms.map((item) => safeText(item?.searchWord || item?.first || item, 80)).filter(Boolean).slice(0, 10);
}

function parseLyrics(value) {
  const lines = [];
  const timestampPattern = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;
  safeText(value, 60000).split(/\r?\n/).forEach((rawLine) => {
    const timestamps = [...rawLine.matchAll(timestampPattern)];
    const text = rawLine.replace(timestampPattern, '').trim();
    if (!text || !timestamps.length) return;
    timestamps.forEach((timestamp) => {
      const minutes = Number(timestamp[1]);
      const seconds = Number(timestamp[2]);
      const atMs = Math.round((minutes * 60 + seconds) * 1000);
      if (Number.isFinite(atMs) && atMs >= 0) lines.push({ atMs, text: safeText(text, 500) });
    });
  });
  const seen = new Set();
  return lines
    .sort((left, right) => left.atMs - right.atMs)
    .filter((line) => {
      const key = `${line.atMs}\u0000${line.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 600);
}

function normaliseCookie(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .filter(([key]) => !COOKIE_ATTRIBUTES.has(String(key).toLowerCase()))
      .map(([key, item]) => `${safeText(key, 120)}=${safeText(item, 2000)}`)
      .filter((item) => !item.startsWith('='))
      .join('; ');
  }
  const cookies = new Map();
  const sources = Array.isArray(value) ? value : [value];
  sources.forEach((source) => {
    safeText(source, 20000).split(';').forEach((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return;
      const key = part.slice(0, separator).trim();
      if (!key || COOKIE_ATTRIBUTES.has(key.toLowerCase())) return;
      cookies.set(key, part.slice(separator + 1).trim());
    });
  });
  return [...cookies.entries()].map(([key, item]) => `${key}=${item}`).join('; ');
}

function normaliseAccount(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const profile = data.profile || payload?.profile || {};
  const account = data.account || payload?.account || {};
  const userId = Number(profile.userId || profile.user_id || account.id || account.userId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const level = Number(profile.level || data.level);
  const vipType = Number(profile.vipType || profile.viptype || data.vipType);
  return {
    userId,
    nickname: safeText(profile.nickname || profile.name || account.nickname, 120) || '网易云音乐用户',
    avatarUrl: safeText(profile.avatarUrl || profile.avatarImgIdStr || profile.avatar, 1000) || null,
    signature: safeText(profile.signature, 240),
    level: Number.isFinite(level) && level > 0 ? level : null,
    vipType: Number.isFinite(vipType) && vipType > 0 ? vipType : null,
  };
}

function normalisePlaylist(playlist, accountUserId = null) {
  const id = Number(playlist?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const creator = playlist.creator || playlist.creatorInfo || { userId: playlist.creatorId, id: playlist.creatorId, nickname: playlist.creatorName, name: playlist.creatorName };
  const ownerId = Number(playlist.userId || creator.userId || creator.id || playlist.creatorId);
  const creatorId = Number(creator.userId || creator.id || playlist.creatorId);
  return {
    id,
    name: safeText(playlist.name, 180) || '未命名歌单',
    coverUrl: safeText(playlist.coverImgUrl || playlist.picUrl || playlist.coverUrl, 1000) || null,
    trackCount: Number.isFinite(Number(playlist.trackCount)) ? Number(playlist.trackCount) : 0,
    creatorName: safeText(creator.nickname || creator.name, 120),
    creatorId: Number.isFinite(creatorId) && creatorId > 0 ? creatorId : null,
    isMine: Boolean(playlist.isMine)
      || (Number.isFinite(accountUserId) && accountUserId > 0 && (ownerId === accountUserId || creatorId === accountUserId))
      // 网易云“我的歌单”接口把收藏歌单标为 subscribed；缺少 creator 字段时，未收藏的条目仍属于当前账号。
      || playlist.subscribed === false,
    subscribed: Boolean(playlist.subscribed),
  };
}

function normaliseLibrary(value) {
  const base = emptyLibrary();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const account = normaliseAccount({ profile: value.account }) || null;
  const playlists = Array.isArray(value.playlists)
    ? value.playlists.map((playlist) => normalisePlaylist(playlist, account?.userId)).filter(Boolean)
    : [];
  const rawTracksByPlaylist = value.tracksByPlaylist && typeof value.tracksByPlaylist === 'object' ? value.tracksByPlaylist : {};
  const tracksByPlaylist = Object.fromEntries(Object.entries(rawTracksByPlaylist).map(([id, tracks]) => [
    id,
    Array.isArray(tracks) ? tracks.map(normaliseTrack).filter(Boolean) : [],
  ]));
  return {
    account,
    playlists,
    tracksByPlaylist,
    selectedPlaylistId: Number.isFinite(Number(value.selectedPlaylistId)) ? Number(value.selectedPlaylistId) : null,
    syncedAt: safeText(value.syncedAt, 80) || null,
  };
}

function readLibrary(storage) {
  return normaliseLibrary(storage?.getModule?.('music'));
}

function writeLibrary(storage, library) {
  const next = normaliseLibrary(library);
  if (typeof storage?.setModule === 'function') storage.setModule('music', next);
  return next;
}

function qrImageData(value) {
  const image = safeText(value, 200000);
  if (!image) return '';
  return image.startsWith('data:image/') ? image : `data:image/png;base64,${image}`;
}

async function fetchAccount(settings, cookie, options = {}) {
  const requestOptions = { ...options, cookie };
  const status = await request(settings, '/login/status', { timestamp: Date.now() }, requestOptions);
  let account = normaliseAccount(status);
  if (!account) {
    const fallback = await request(settings, '/user/account', {}, requestOptions);
    account = normaliseAccount(fallback);
  }
  if (!account) throw new Error('音乐账号登录状态已失效，请重新扫码登录');
  return account;
}

async function fetchPlaylists(settings, userId, cookie, options = {}) {
  const payload = await request(settings, '/user/playlist', {
    uid: userId,
    limit: 1000,
    offset: 0,
    timestamp: Date.now(),
  }, { ...options, cookie });
  const playlists = Array.isArray(payload?.playlist) ? payload.playlist : Array.isArray(payload?.data?.playlist) ? payload.data.playlist : [];
  const seen = new Set();
  return playlists.map((playlist) => normalisePlaylist(playlist, userId)).filter((playlist) => {
    if (!playlist || seen.has(playlist.id)) return false;
    seen.add(playlist.id);
    return true;
  });
}

async function fetchSongDetails(settings, ids, cookie, options = {}) {
  const tracks = [];
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    const payload = await request(settings, '/song/detail', { ids: chunk.join(',') }, { ...options, cookie });
    const songs = Array.isArray(payload?.songs) ? payload.songs : [];
    tracks.push(...songs.map(normaliseTrack).filter(Boolean));
  }
  return tracks;
}

async function fetchPlaylistTracks(settings, playlistId, cookie, options = {}) {
  const id = Number(playlistId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('歌单标识无效');
  const limit = 1000;
  const maxTracks = 10000;
  const tracks = [];
  let requestFailed = false;
  try {
    for (let offset = 0; offset < maxTracks; offset += limit) {
      const payload = await request(settings, '/playlist/track/all', {
        id,
        limit,
        offset,
        timestamp: Date.now(),
      }, { ...options, cookie });
      const songs = Array.isArray(payload?.songs) ? payload.songs : Array.isArray(payload?.data?.songs) ? payload.data.songs : [];
      const page = songs.map(normaliseTrack).filter(Boolean);
      tracks.push(...page);
      if (songs.length < limit || page.length === 0) break;
    }
  } catch {
    requestFailed = true;
  }
  if (!requestFailed && tracks.length) return tracks;

  const detail = await request(settings, '/playlist/detail', { id, timestamp: Date.now() }, { ...options, cookie });
  const trackIds = Array.isArray(detail?.playlist?.trackIds)
    ? detail.playlist.trackIds.map((track) => Number(track?.id)).filter((trackId) => Number.isFinite(trackId) && trackId > 0).slice(0, maxTracks)
    : [];
  return trackIds.length ? fetchSongDetails(settings, trackIds, cookie, options) : tracks;
}

async function accountState(storage) {
  return readLibrary(storage);
}

async function startQrLogin(settings, options = {}) {
  const keyPayload = await request(settings, '/login/qr/key', { timestamp: Date.now() }, options);
  const key = safeText(keyPayload?.data?.unikey || keyPayload?.data?.key || keyPayload?.unikey || keyPayload?.key, 200);
  if (!key) throw new Error('音乐服务没有返回二维码登录标识');
  const qrPayload = await request(settings, '/login/qr/create', { key, qrimg: true, timestamp: Date.now() }, options);
  const qrImage = qrImageData(qrPayload?.data?.qrimg || qrPayload?.qrimg);
  if (!qrImage) throw new Error('音乐服务没有返回二维码图片，请更新兼容服务');
  return {
    key,
    qrImage,
    qrUrl: safeText(qrPayload?.data?.qrurl || qrPayload?.qrurl, 1000) || null,
    expiresAt: Date.now() + 180000,
  };
}

async function checkQrLogin(key, settings, storage, options = {}) {
  const loginKey = safeText(key, 200);
  if (!loginKey) throw new Error('二维码登录标识无效');
  const payload = await request(settings, '/login/qr/check', {
    key: loginKey,
    timestamp: Date.now(),
  }, { ...options, allowCodes: [800, 801, 802, 803] });
  const code = Number(payload?.code);
  if (code === 801) return { status: 'waiting-scan', message: '等待扫码' };
  if (code === 802) return { status: 'waiting-confirm', message: '已扫码，请在手机上确认' };
  if (code === 800) return { status: 'expired', message: '二维码已过期，请重新获取' };
  if (code !== 803) return { status: 'error', message: safeText(payload?.message || payload?.msg, 160) || '二维码登录状态未知' };

  const cookie = normaliseCookie(payload?.cookie || payload?.data?.cookie);
  if (!cookie) throw new Error('登录成功但音乐服务没有返回会话凭据');
  saveSession(cookie);
  const account = await fetchAccount(settings, cookie, options);
  const library = await syncAccount(settings, storage, { ...options, cookie, account });
  return { status: 'authorized', message: '登录成功', account, library };
}

async function syncAccount(settings, storage, options = {}) {
  const cookie = safeText(options.cookie, 20000) || readSession();
  if (!cookie) throw new Error('请先扫码登录网易云音乐');
  const account = options.account || await fetchAccount(settings, cookie, options);
  const playlists = await fetchPlaylists(settings, account.userId, cookie, options);
  const previous = readLibrary(storage);
  const playlistIds = new Set(playlists.map((playlist) => String(playlist.id)));
  // 歌单目录同步后，旧曲目缓存不再可靠；下一次打开歌单必须重新拉取，避免只更新总数而继续展示旧列表。
  const tracksByPlaylist = {};
  const selectedPlaylistId = playlistIds.has(String(previous.selectedPlaylistId))
    ? previous.selectedPlaylistId
    : playlists[0]?.id || null;
  const now = new Date().toISOString();
  return writeLibrary(storage, {
    account: { ...account, loggedInAt: previous.account?.loggedInAt || now, syncedAt: now },
    playlists,
    tracksByPlaylist,
    selectedPlaylistId,
    syncedAt: now,
  });
}

async function syncPlaylistTracks(playlistId, settings, storage, options = {}) {
  const cookie = safeText(options.cookie, 20000) || readSession();
  if (!cookie) throw new Error('请先扫码登录网易云音乐');
  const tracks = await fetchPlaylistTracks(settings, playlistId, cookie, options);
  const previous = readLibrary(storage);
  const id = Number(playlistId);
  const library = writeLibrary(storage, {
    ...previous,
    tracksByPlaylist: { ...previous.tracksByPlaylist, [String(id)]: tracks },
    selectedPlaylistId: id,
    syncedAt: new Date().toISOString(),
  });
  return { tracks, library };
}

function isOwnedPlaylist(playlist, account) {
  return Boolean(playlist?.isMine)
    || (Number.isFinite(Number(playlist?.creatorId)) && Number(playlist.creatorId) === Number(account?.userId));
}

async function mutatePlaylistTracks(playlistId, trackId, operation, settings, storage, options = {}) {
  const id = Number(playlistId);
  const songId = Number(trackId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('歌单标识无效');
  if (!Number.isFinite(songId) || songId <= 0) throw new Error('歌曲标识无效');
  if (!['add', 'del'].includes(operation)) throw new Error('歌单操作无效');

  const cookie = safeText(options.cookie, 20000) || readSession();
  if (!cookie) throw new Error('请先扫码登录网易云音乐');

  // 先刷新目录，避免用本地过期的歌单权限去写入第三方账号。
  const libraryBefore = await syncAccount(settings, storage, { ...options, cookie });
  const playlist = libraryBefore.playlists.find((item) => Number(item.id) === id);
  if (!playlist) throw new Error('未找到该歌单，请先同步网易云歌单');
  if (!isOwnedPlaylist(playlist, libraryBefore.account)) throw new Error('只能修改你自己创建的歌单');

  await request(settings, '/playlist/tracks', {
    op: operation,
    pid: id,
    tracks: songId,
    timestamp: Date.now(),
  }, { ...options, cookie });

  // 写入成功后立刻重新拉取，缓存不会把“已同步”误报为仅本地更新。
  await syncAccount(settings, storage, { ...options, cookie });
  const refreshed = await syncPlaylistTracks(id, settings, storage, { ...options, cookie });
  const updatedPlaylist = refreshed.library.playlists.find((item) => Number(item.id) === id) || playlist;
  return { playlist: updatedPlaylist, tracks: refreshed.tracks, library: refreshed.library };
}

function addToPlaylist(playlistId, trackId, settings, storage, options = {}) {
  return mutatePlaylistTracks(playlistId, trackId, 'add', settings, storage, options);
}

function removeFromPlaylist(playlistId, trackId, settings, storage, options = {}) {
  return mutatePlaylistTracks(playlistId, trackId, 'del', settings, storage, options);
}

async function logout(settings, storage, options = {}) {
  const cookie = readSession();
  if (cookie) {
    try {
      await request(settings, '/logout', {}, { ...options, cookie });
    } catch {
      // 即使服务已离线，也要清掉本地会话，避免页面继续显示旧账号。
    }
  }
  clearSession();
  return writeLibrary(storage, emptyLibrary());
}

function playbackUrlFromResponse(payload) {
  const value = safeText(payload?.data?.[0]?.url, 1200);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

async function search(query, settings, options = {}) {
  const keywords = safeText(query, 80);
  if (!keywords) return [];
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
  const payload = await request(settings, '/search', { keywords, type: 1, limit }, options);
  const tracks = tracksFromSearch(payload);
  const missingCoverIds = tracks.filter((track) => !track.coverUrl).map((track) => track.id);
  if (!missingCoverIds.length) return tracks;
  try {
    const details = await request(settings, '/song/detail', { ids: missingCoverIds.join(',') }, options);
    const coverUrls = new Map(
      (Array.isArray(details?.songs) ? details.songs : [])
        .map(normaliseTrack)
        .filter(Boolean)
        .filter((track) => track.coverUrl)
        .map((track) => [track.id, track.coverUrl])
    );
    return tracks.map((track) => coverUrls.has(track.id) ? { ...track, coverUrl: coverUrls.get(track.id) } : track);
  } catch {
    // 详情补全失败不能使原本可用的搜索结果不可用，保留列表的无封面降级状态。
    return tracks;
  }
}

async function hotSearch(settings, options = {}) {
  const payload = await request(settings, '/search/hot/detail', {}, options);
  return hotTermsFromResponse(payload);
}

async function trackDetails(id, settings, options = {}) {
  const trackId = Number(id);
  if (!Number.isFinite(trackId) || trackId <= 0) throw new Error('歌曲标识无效');
  const payload = await request(settings, '/song/detail', { ids: trackId }, options);
  const songs = Array.isArray(payload?.songs) ? payload.songs : [];
  return normaliseTrack(songs[0]) || null;
}

async function lyrics(id, settings, options = {}) {
  const trackId = Number(id);
  if (!Number.isFinite(trackId) || trackId <= 0) throw new Error('歌曲标识无效');
  const payload = await request(settings, '/lyric', { id: trackId }, options);
  return parseLyrics(payload?.lrc?.lyric);
}

async function playbackUrl(id, settings, options = {}) {
  const trackId = Number(id);
  if (!Number.isFinite(trackId) || trackId <= 0) throw new Error('歌曲标识无效');
  // 播放地址也必须带上扫码登录后的会话；否则服务会按匿名账号返回试听音频。
  const cookie = safeText(options.cookie, 20000) || readSession();
  const requestOptions = cookie ? { ...options, cookie } : options;
  let firstError;
  try {
    const modern = await request(settings, '/song/url/v1', { id: trackId, level: 'standard' }, requestOptions);
    const modernUrl = playbackUrlFromResponse(modern);
    if (modernUrl) return modernUrl;
  } catch (error) {
    firstError = error;
  }
  try {
    const legacy = await request(settings, '/song/url', { id: trackId, br: 128000 }, requestOptions);
    const legacyUrl = playbackUrlFromResponse(legacy);
    if (legacyUrl) return legacyUrl;
  } catch (error) {
    throw firstError || error;
  }
  throw new Error('这首歌暂时没有可播放的音频，可能受版权或登录状态限制');
}

module.exports = {
  init,
  emptyLibrary,
  buildUrl,
  clearSession,
  migrateSession,
  normaliseTrack,
  normaliseAccount,
  normalisePlaylist,
  tracksFromSearch,
  hotTermsFromResponse,
  parseLyrics,
  playbackUrlFromResponse,
  accountState,
  startQrLogin,
  checkQrLogin,
  syncAccount,
  syncPlaylistTracks,
  addToPlaylist,
  removeFromPlaylist,
  logout,
  search,
  hotSearch,
  trackDetails,
  lyrics,
  playbackUrl,
};
