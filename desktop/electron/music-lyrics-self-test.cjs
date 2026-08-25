const assert = require('node:assert/strict');

void (async () => {
  const { activeLyricLineIndex } = await import('../src/modules/musicLyrics.ts');
  const lines = [{ atMs: 1000, text: '第一句' }, { atMs: 2500, text: '第二句' }, { atMs: 4000, text: '第三句' }];
  assert.equal(activeLyricLineIndex(lines, 0.5), -1);
  assert.equal(activeLyricLineIndex(lines, 1), 0);
  assert.equal(activeLyricLineIndex(lines, 3.2), 1);
  assert.equal(activeLyricLineIndex(lines, 10), 2);
  console.log('music lyrics self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
