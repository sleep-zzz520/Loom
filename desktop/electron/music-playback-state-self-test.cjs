const assert = require('node:assert/strict');

(async () => {
  const { playbackProgress, playbackWindow, upcomingTracks } = await import('../src/modules/musicPlaybackState.ts');
  const tracks = [1, 2, 3].map((id) => ({ id, title: `歌曲 ${id}`, artists: '自检歌手', album: '', coverUrl: null, durationMs: 240000 }));

  assert.deepEqual(playbackWindow(30.8, 257000), { playableSeconds: 30, catalogSeconds: 257, isPreview: true });
  assert.deepEqual(playbackWindow(257.9, 257000), { playableSeconds: 257, catalogSeconds: 257, isPreview: false });
  assert.deepEqual(playbackWindow(Number.POSITIVE_INFINITY, 257000), { playableSeconds: 0, catalogSeconds: 257, isPreview: false });
  assert.equal(playbackProgress(4.5, 30), 0.15);
  assert.equal(playbackProgress(-2, 30), 0);
  assert.equal(playbackProgress(32, 30), 1);
  assert.equal(playbackProgress(1, 0), 0);
  assert.deepEqual(upcomingTracks(tracks, 2).map((track) => track.id), [3, 1]);
  assert.deepEqual(upcomingTracks(tracks, 99).map((track) => track.id), [1, 2, 3]);
  console.log('music playback state self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
