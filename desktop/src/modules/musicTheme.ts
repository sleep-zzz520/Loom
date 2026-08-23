const FALLBACK_HUES = [218, 274, 22, 142, 344, 190];

export function fallbackMusicThemeHue(trackId: number) {
  return FALLBACK_HUES[Math.abs(trackId) % FALLBACK_HUES.length];
}

export function hueFromRgb(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.02) return null;

  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue *= 60;
  return Math.round(hue < 0 ? hue + 360 : hue);
}

export function themeHueFromPixels(pixels: ArrayLike<number>, fallbackHue: number) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;

  for (let index = 0; index + 3 < pixels.length; index += 16) {
    const alpha = pixels[index + 3];
    const brightness = pixels[index] + pixels[index + 1] + pixels[index + 2];
    if (alpha < 180 || brightness < 45 || brightness > 715) continue;
    red += pixels[index];
    green += pixels[index + 1];
    blue += pixels[index + 2];
    samples += 1;
  }

  if (!samples) return fallbackHue;
  return hueFromRgb(red / samples, green / samples, blue / samples) ?? fallbackHue;
}
