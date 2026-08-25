const assert = require('node:assert/strict');
const { createMusicState, executeMusicTool, isMusicPreferenceQuestion, preloadMusicPreferenceContext, runAgent } = require('./agent.cjs');

void (async () => {
  const track = {
    id: 42,
    title: '自检歌曲',
    artists: '自检歌手',
    album: '自检专辑',
    coverUrl: null,
    durationMs: 180000,
  };
  const secondTrack = {
    id: 43,
    title: '第二首自检歌曲',
    artists: '另一位自检歌手',
    album: '第二张自检专辑',
    coverUrl: null,
    durationMs: 210000,
  };
  let library = {
    account: { userId: 7, nickname: '自检听众', signature: '测试签名' },
    playlists: [
      { id: 100, name: '我的常听', trackCount: 1, isMine: true, subscribed: false },
      { id: 101, name: '待同步歌单', trackCount: 1, isMine: true, subscribed: false },
    ],
    tracksByPlaylist: { 100: [track] },
    selectedPlaylistId: 100,
    syncedAt: '2026-08-24T00:00:00.000Z',
  };
  const calls = [];
  const musicApi = {
    search: async (query) => {
      calls.push(`search:${query}`);
      return [track];
    },
    playbackUrl: async (id) => {
      calls.push(`play:${id}`);
      return 'https://example.com/self-test.mp3';
    },
    accountState: async () => {
      calls.push('library');
      return library;
    },
    syncAccount: async () => {
      calls.push('sync-account');
      return library;
    },
    syncPlaylistTracks: async (id) => {
      calls.push(`sync-playlist:${id}`);
      const tracks = id === 101 ? [secondTrack] : [];
      library = { ...library, tracksByPlaylist: { ...library.tracksByPlaylist, [String(id)]: tracks } };
      return { tracks, library };
    },
  };
  const state = createMusicState();
  const search = await executeMusicTool('search_music', { query: '自检' }, {}, state, musicApi);
  assert.deepEqual(search.command, { type: 'show-results', query: '自检', tracks: [track] });
  assert.equal(state.byId.get(42)?.title, '自检歌曲');

  const play = await executeMusicTool('play_music', { id: 42 }, {}, state, musicApi);
  assert.deepEqual(play.command, {
    type: 'play',
    query: '自检',
    tracks: [track],
    track,
    source: 'https://example.com/self-test.mp3',
  });
  assert.deepEqual(calls, ['search:自检', 'play:42']);

  const playByIndex = await executeMusicTool('play_music', { index: 1 }, {}, state, musicApi);
  assert.equal(playByIndex.command.track.id, 42);

  const unknown = await executeMusicTool('play_music', { id: 99 }, {}, state, musicApi);
  assert.match(unknown.toolResult.error, /请先通过 search_music/);

  const musicLibrary = await executeMusicTool('get_music_library', {}, {}, state, musicApi, {});
  assert.equal(musicLibrary.toolResult.account.nickname, '自检听众');
  assert.equal(musicLibrary.toolResult.playlists.find((playlist) => playlist.id === 100)?.cachedTrackCount, 1);

  const cachedPlaylist = await executeMusicTool('get_music_playlist', { playlistId: 100 }, {}, state, musicApi, {});
  assert.equal(cachedPlaylist.toolResult.playlist.name, '我的常听');
  assert.deepEqual(cachedPlaylist.toolResult.tracks, [{ id: 42, title: '自检歌曲', artists: '自检歌手', album: '自检专辑' }]);
  assert.equal(calls.includes('sync-playlist:100'), false);

  const syncedPlaylist = await executeMusicTool('get_music_playlist', { playlistId: 101 }, {}, state, musicApi, {});
  assert.equal(syncedPlaylist.toolResult.tracks[0].id, 43);
  assert.equal(calls.includes('sync-playlist:101'), true);

  library = { ...library, tracksByPlaylist: { ...library.tracksByPlaylist, 101: [] } };
  const proactivePlaylist = await executeMusicTool('get_music_playlist', { playlistId: 101 }, {}, state, musicApi, {}, { allowSync: false });
  assert.match(proactivePlaylist.toolResult.error, /后台主动检查/);

  assert.equal(isMusicPreferenceQuestion('你知道我喜欢听什么音乐吗'), true);
  assert.equal(isMusicPreferenceQuestion('帮我搜索一首歌'), false);
  const preferenceContext = await preloadMusicPreferenceContext('你知道我喜欢听什么音乐吗', {}, musicApi, {});
  assert.equal(preferenceContext.status, 'ready');
  assert.equal(preferenceContext.samples[0].playlist.id, 100);
  assert.equal(preferenceContext.samples[0].tracks[0].artists, '自检歌手');
  assert.equal(calls.includes('sync-account'), true);

  const originalFetch = global.fetch;
  const encoder = new TextEncoder();
  let systemPrompt = '';
  global.fetch = async (_url, request) => {
    systemPrompt = JSON.parse(request.body).messages[0].content;
    let sent = false;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"已基于歌单分析。"}}]}\n\ndata: [DONE]\n\n') };
          },
        }),
      },
    };
  };
  try {
    const reply = await runAgent(
      [{ role: 'user', content: '你知道我喜欢听什么音乐吗' }],
      { agent: { apiBase: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' }, profile: {}, notify: {} },
      () => {},
      { musicApi, musicStorage: {} },
    );
    assert.equal(reply.content, '已基于歌单分析。');
    assert.match(systemPrompt, /本轮音乐偏好预读取/);
    assert.match(systemPrompt, /自检歌曲/);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('agent music self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
