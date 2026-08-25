import type { MusicLyricLine } from '../types';

export function activeLyricLineIndex(lines: MusicLyricLine[], currentTime: number) {
  const currentMs = Math.max(0, Number.isFinite(currentTime) ? currentTime * 1000 : 0);
  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].atMs > currentMs) break;
    activeIndex = index;
  }
  return activeIndex;
}
