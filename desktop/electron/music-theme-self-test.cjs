const assert = require('node:assert/strict');

(async () => {
  const { fallbackMusicThemeHue, hueFromRgb, themeHueFromPixels } = await import('../src/modules/musicTheme.ts');

  assert.equal(hueFromRgb(255, 0, 0), 0);
  assert.equal(hueFromRgb(128, 128, 128), null);
  assert.equal(themeHueFromPixels([55, 115, 210, 255, 55, 115, 210, 255], 22), 217);
  assert.equal(themeHueFromPixels([0, 0, 0, 0], 22), 22);
  assert.equal(fallbackMusicThemeHue(1), 274);
  assert.equal(fallbackMusicThemeHue(-1), 274);
  console.log('music theme self-test ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
