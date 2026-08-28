import type { MusicTrack } from '../types';

export function playbackWindow(playableDuration: number, catalogDurationMs: number | null) {
  const playableSeconds = Number.isFinite(playableDuration) && playableDuration > 0 ? Math.floor(playableDuration) : 0;
  const catalogSeconds = Number.isFinite(catalogDurationMs) && Number(catalogDurationMs) > 0
    ? Math.floor(Number(catalogDurationMs) / 1000)
    : 0;
  return {
    playableSeconds,
    catalogSeconds,
    isPreview: playableSeconds > 0 && catalogSeconds > playableSeconds + 2,
  };
}

/** 供播放进度视觉层使用的 0-1 安全比例。 */
export function playbackProgress(currentTime: number, playableSeconds: number) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(playableSeconds) || playableSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, currentTime / playableSeconds));
}

/** 将当前曲目移出“接下来播放”，并按循环播放顺序排列剩余曲目。 */
export function upcomingTracks(tracks: MusicTrack[], currentTrackId: number | undefined) {
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  if (currentIndex < 0) return tracks.slice();
  return [...tracks.slice(currentIndex + 1), ...tracks.slice(0, currentIndex)];
}
