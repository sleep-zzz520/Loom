export type MusicShortcutAction = 'toggle' | 'seek-backward' | 'seek-forward' | 'previous' | 'next';

export function resolveMusicShortcut(key: string, shiftKey = false, isEditable = false): MusicShortcutAction | null {
  if (isEditable) return null;
  if (key === ' ' || key === 'Space' || key === 'Spacebar') return 'toggle';
  if (key === 'ArrowLeft') return shiftKey ? 'previous' : 'seek-backward';
  if (key === 'ArrowRight') return shiftKey ? 'next' : 'seek-forward';
  return null;
}
