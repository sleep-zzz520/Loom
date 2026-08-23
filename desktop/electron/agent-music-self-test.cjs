const assert = require('node:assert/strict');
const { createMusicState, executeMusicTool } = require('./agent.cjs');

void (async () => {
  const track = {
    id: 42,
    title: '自检歌曲',
    artists: '自检歌手',
    album: '自检专辑',
    coverUrl: null,
    durationMs: 180000,
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
  console.log('agent music self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
