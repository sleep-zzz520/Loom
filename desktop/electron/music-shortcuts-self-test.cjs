const assert = require('node:assert/strict');

(async () => {
  const { resolveMusicShortcut } = await import('../src/modules/musicShortcuts.ts');

  assert.equal(resolveMusicShortcut(' '), 'toggle');
  assert.equal(resolveMusicShortcut('ArrowLeft'), 'seek-backward');
  assert.equal(resolveMusicShortcut('ArrowRight'), 'seek-forward');
  assert.equal(resolveMusicShortcut('ArrowLeft', true), 'previous');
  assert.equal(resolveMusicShortcut('ArrowRight', true), 'next');
  assert.equal(resolveMusicShortcut('ArrowRight', false, true), null);
  assert.equal(resolveMusicShortcut('Enter'), null);
  console.log('music shortcuts self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
