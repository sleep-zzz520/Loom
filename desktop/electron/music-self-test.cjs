const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const music = require('./music.cjs');

void (async () => {
  const settings = { netease: { apiBase: 'http://127.0.0.1:3000/' } };
  assert.equal(music.buildUrl(settings, '/search', { keywords: '海阔天空', type: 1 }).includes('keywords=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA'), true);
  assert.equal(music.normalisePlaylist({ id: 66, name: '自建歌单', subscribed: false }, 99).isMine, true);
  assert.equal(music.normalisePlaylist({ id: 67, name: '收藏歌单', subscribed: true }, 99).isMine, false);
  assert.deepEqual(music.tracksFromSearch({ result: { songs: [{ id: 1, name: '自检歌曲', ar: [{ name: '自检歌手' }], al: { name: '自检专辑', picUrl: 'https://example.com/cover.jpg' }, dt: 180000 }] } }), [{ id: 1, title: '自检歌曲', artists: '自检歌手', album: '自检专辑', coverUrl: 'https://example.com/cover.jpg', durationMs: 180000 }]);
  assert.deepEqual(music.hotTermsFromResponse({ data: [{ searchWord: '热门歌曲' }, { searchWord: '热门歌手' }] }), ['热门歌曲', '热门歌手']);
  assert.deepEqual(music.parseLyrics('[ar:自检歌手]\n[00:01.20]第一句\n[00:02.00][00:03.50]重复的副歌\n[00:03.50]重复的副歌'), [
    { atMs: 1200, text: '第一句' },
    { atMs: 2000, text: '重复的副歌' },
    { atMs: 3500, text: '重复的副歌' },
  ]);
  const seen = [];
  const fetcher = async (url) => {
    seen.push(url);
    if (url.includes('/search?')) return { ok: true, json: async () => ({ code: 200, result: { songs: [{ id: 2, name: '搜索歌曲', artists: [{ name: '搜索歌手' }], album: { name: '搜索专辑' } }] } }) };
    if (url.includes('/song/detail?')) return { ok: true, json: async () => ({ code: 200, songs: [{ id: 2, name: '搜索歌曲', ar: [{ name: '搜索歌手' }], al: { name: '搜索专辑', picUrl: 'https://example.com/search-cover.jpg' } }] }) };
    if (url.includes('/lyric?')) return { ok: true, json: async () => ({ code: 200, lrc: { lyric: '[00:01.00]测试歌词' } }) };
    if (url.includes('/song/url/v1')) return { ok: true, json: async () => ({ code: 200, data: [{ url: null }] }) };
    return { ok: true, json: async () => ({ code: 200, data: [{ url: 'https://example.com/audio.mp3' }] }) };
  };
  const searchTracks = await music.search('搜索歌曲', settings, { fetcher });
  assert.equal(searchTracks[0].artists, '搜索歌手');
  assert.equal(searchTracks[0].coverUrl, 'https://example.com/search-cover.jpg');
  assert.equal(seen[1].includes('/song/detail?ids=2'), true);
  assert.deepEqual(await music.lyrics(1, settings, { fetcher }), [{ atMs: 1000, text: '测试歌词' }]);
  assert.equal(await music.playbackUrl(1, settings, { fetcher }), 'https://example.com/audio.mp3');
  assert.equal(seen.length, 5);
  const details = await music.trackDetails(3, settings, { fetcher: async () => ({ ok: true, json: async () => ({ code: 200, songs: [{ id: 3, name: '详情歌曲', ar: [{ name: '详情歌手' }], al: { name: '详情专辑', picUrl: 'https://example.com/detail-cover.jpg' } }] }) }) });
  assert.equal(details.coverUrl, 'https://example.com/detail-cover.jpg');
  await assert.rejects(() => music.search('离线服务', settings, { fetcher: async () => { throw new Error('socket closed'); } }), /无法连接音乐服务/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-music-self-test-'));
  try {
    music.init(tempDir);
    let storedLibrary = music.emptyLibrary();
    let qrChecks = 0;
    let playlistTrackFetches = 0;
    const accountFetcher = async (url, init) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:3000\//);
      if (url.includes('/login/qr/key')) return { ok: true, json: async () => ({ code: 200, data: { unikey: 'qr-key' } }) };
      if (url.includes('/login/qr/create')) return { ok: true, json: async () => ({ code: 200, data: { qrimg: 'cXJpbWc=' } }) };
      if (url.includes('/login/qr/check')) {
        qrChecks += 1;
        return qrChecks === 1
          ? { ok: true, json: async () => ({ code: 801 }) }
          : { ok: true, json: async () => ({ code: 803, cookie: 'MUSIC_U=test-cookie; Max-Age=3600; Path=/;MUSIC_A=test-anonymous' }) };
      }
      assert.equal(init?.headers?.Cookie, 'MUSIC_U=test-cookie; MUSIC_A=test-anonymous');
      if (url.includes('/login/status')) return { ok: true, json: async () => ({ code: 200, data: { profile: { userId: 99, nickname: '自检用户', avatarUrl: 'https://example.com/avatar.jpg' } } }) };
      if (url.includes('/user/playlist')) return { ok: true, json: async () => ({ code: 200, playlist: [{ id: 88, name: '我的收藏', trackCount: 2, userId: 99, creator: { userId: 99, nickname: '自检用户' } }] }) };
      if (url.includes('/song/url/v1')) return { ok: true, json: async () => ({ code: 200, data: [{ url: 'https://example.com/full-audio.mp3' }] }) };
      if (url.includes('/playlist/track/all')) {
        playlistTrackFetches += 1;
        return {
          ok: true,
          json: async () => ({
            code: 200,
            songs: [
              { id: 7, name: '账号歌曲', ar: [{ name: '账号歌手' }], al: { name: '账号专辑' }, dt: 210000 },
              ...(playlistTrackFetches > 1 ? [{ id: 8, name: '新增歌曲', ar: [{ name: '新增歌手' }], al: { name: '新增专辑' }, dt: 180000 }] : []),
            ],
          }),
        };
      }
      if (url.includes('/playlist/tracks')) return { ok: true, json: async () => ({ code: 200, body: { code: 200 } }) };
      throw new Error(`unexpected URL: ${url}`);
    };
    const storage = {
      getModule: () => storedLibrary,
      setModule: (_name, value) => { storedLibrary = value; return value; },
    };
    const qr = await music.startQrLogin(settings, { fetcher: accountFetcher });
    assert.equal(qr.key, 'qr-key');
    assert.equal(qr.qrImage, 'data:image/png;base64,cXJpbWc=');
    assert.equal((await music.checkQrLogin(qr.key, settings, storage, { fetcher: accountFetcher })).status, 'waiting-scan');
    const authorized = await music.checkQrLogin(qr.key, settings, storage, { fetcher: accountFetcher });
    assert.equal(authorized.status, 'authorized');
    assert.equal(authorized.library.account.nickname, '自检用户');
    assert.equal(authorized.library.playlists[0].name, '我的收藏');
    assert.equal(await music.playbackUrl(7, settings, { fetcher: accountFetcher }), 'https://example.com/full-audio.mp3');
    const playlist = await music.syncPlaylistTracks(88, settings, storage, { fetcher: accountFetcher });
    assert.equal(playlist.tracks[0].title, '账号歌曲');
    assert.equal(playlist.library.playlists[0].trackCount, 2);
    assert.equal(storedLibrary.tracksByPlaylist['88'][0].artists, '账号歌手');
    assert.equal((await music.accountState(storage)).playlists[0].trackCount, 2);
    const refreshedAccount = await music.syncAccount(settings, storage, { fetcher: accountFetcher });
    assert.deepEqual(refreshedAccount.tracksByPlaylist, {});
    const refreshedPlaylist = await music.syncPlaylistTracks(88, settings, storage, { fetcher: accountFetcher });
    assert.equal(refreshedPlaylist.tracks.length, 2);
    assert.equal(refreshedPlaylist.tracks[1].title, '新增歌曲');
    const added = await music.addToPlaylist(88, 7, settings, storage, { fetcher: accountFetcher });
    assert.equal(added.playlist.id, 88);
    const removed = await music.removeFromPlaylist(88, 7, settings, storage, { fetcher: accountFetcher });
    assert.equal(removed.library.selectedPlaylistId, 88);
    await music.logout(settings, storage, { fetcher: accountFetcher });
    assert.equal(storedLibrary.account, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('music self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
