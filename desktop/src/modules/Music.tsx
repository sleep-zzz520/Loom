import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AudioLines, Bookmark, BookmarkPlus, Captions, ChevronLeft, ChevronRight, CircleAlert, CircleUserRound, Disc3, Heart, ListMusic, LogIn, LogOut, Pause, Play, RefreshCw, Search, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { AgentMusicCommand, MusicLibrary, MusicLyricLine, MusicPlaylist, MusicTrack } from '../types';
import { activeLyricLineIndex } from './musicLyrics';
import { playbackProgress, playbackWindow, upcomingTracks } from './musicPlaybackState';
import { resolveMusicShortcut } from './musicShortcuts';
import { fallbackMusicThemeHue, themeHueFromPixels } from './musicTheme';

const FEATURED_MOODS = [
  { title: '晨间精选', query: '轻音乐', visual: 'dawn' },
  { title: '人声里的故事', query: '华语民谣', visual: 'voice' },
  { title: '夜色慢放', query: '夜曲', visual: 'night' },
  { title: '耳机漫游', query: '旅行', visual: 'roam' },
] as const;

const EMPTY_MUSIC_LIBRARY: MusicLibrary = {
  account: null,
  playlists: [],
  tracksByPlaylist: {},
  selectedPlaylistId: null,
  syncedAt: null,
};

function formatSeconds(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function progressStyle(currentTime: number, playableSeconds: number): CSSProperties {
  const progress = playbackProgress(currentTime, playableSeconds);
  return {
    '--music-progress': `${progress * 100}%`,
    '--music-progress-ratio': String(progress),
  } as CSSProperties;
}

function formatDuration(durationMs: number | null) {
  return durationMs ? formatSeconds(durationMs / 1000) : '--:--';
}

function PlayingWave() {
  return <span className="music-playing-wave" aria-label="正在播放"><i /><i /><i /></span>;
}

function ownPlaylists(library: MusicLibrary) {
  return library.playlists.filter((playlist) => playlist.isMine || playlist.creatorId === library.account?.userId);
}

function likedPlaylist(library: MusicLibrary) {
  const accountName = library.account?.nickname || '';
  const playlists = ownPlaylists(library);
  return playlists.find((playlist) => accountName && playlist.name === `${accountName}喜欢的音乐`)
    || playlists.find((playlist) => /喜欢的音乐$/.test(playlist.name))
    || null;
}

type PlaylistActionKind = 'collect' | 'like';
type PlaylistActionVisualState = { collected: boolean; liked: boolean };
type PlaylistActionError = { trackId: number; action: PlaylistActionKind; message: string };

export default function Music({
  agentCommand,
  onAgentCommandHandled,
  onOpenSettings,
}: {
  agentCommand: AgentMusicCommand | null;
  onAgentCommandHandled: () => void;
  onOpenSettings: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const musicNavRef = useRef<HTMLElement>(null);
  const lyricListRef = useRef<HTMLDivElement>(null);
  const nowPlayingProgressRef = useRef<HTMLSpanElement>(null);
  const compactProgressRef = useRef<HTMLSpanElement>(null);
  const lyricCache = useRef(new Map<number, MusicLyricLine[]>());
  const handledAgentCommands = useRef(new WeakSet<AgentMusicCommand>());
  const [query, setQuery] = useState('');
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<MusicTrack[]>([]);
  const moodTracks = useRef(new Map<string, MusicTrack[]>());
  const moodPreviewHydrating = useRef(new Set<string>());
  const [moodPreviews, setMoodPreviews] = useState<Record<string, MusicTrack>>({});
  const [moodLoadingTitle, setMoodLoadingTitle] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [serviceBase, setServiceBase] = useState('');
  const [serviceReady, setServiceReady] = useState(true);
  const [error, setError] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [library, setLibrary] = useState<MusicLibrary>(EMPTY_MUSIC_LIBRARY);
  const [accountLoading, setAccountLoading] = useState(false);
  const [playlistLoadingId, setPlaylistLoadingId] = useState<number | null>(null);
  const [activePlaylistId, setActivePlaylistId] = useState<number | null>(null);
  const [loginKey, setLoginKey] = useState('');
  const [qrImage, setQrImage] = useState('');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'waiting-scan' | 'waiting-confirm' | 'expired' | 'authorized'>('idle');
  const loginPolling = useRef(false);
  const [themeHue, setThemeHue] = useState(218);
  const [view, setView] = useState<'discover' | 'search' | 'library' | 'player' | 'lyrics'>('discover');
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyrics, setLyrics] = useState<MusicLyricLine[]>([]);
  const [lyricsStatus, setLyricsStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'failed'>('idle');
  const [musicNavIndicator, setMusicNavIndicator] = useState({ left: 0, width: 0, ready: false });
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<MusicTrack | null>(null);
  const [playlistMutation, setPlaylistMutation] = useState<{ playlistId: number; trackId: number } | null>(null);
  const [playlistActionStates, setPlaylistActionStates] = useState<Record<number, PlaylistActionVisualState>>({});
  const [playlistActionError, setPlaylistActionError] = useState<PlaylistActionError | null>(null);
  const activeLyricIndex = useMemo(() => activeLyricLineIndex(lyrics, currentTime), [lyrics, currentTime]);
  const ownedPlaylists = ownPlaylists(library);
  const favoritePlaylist = likedPlaylist(library);

  useEffect(() => {
    if (!playlistActionError) return;
    const timeout = window.setTimeout(() => setPlaylistActionError(null), 4800);
    return () => window.clearTimeout(timeout);
  }, [playlistActionError]);

  function trackIsInPlaylist(trackId: number, playlistId: number) {
    return (library.tracksByPlaylist[String(playlistId)] ?? []).some((track) => track.id === trackId);
  }

  function isTrackCollected(trackId: number) {
    return Boolean(playlistActionStates[trackId]?.collected)
      || ownedPlaylists.some((playlist) => trackIsInPlaylist(trackId, playlist.id));
  }

  function isTrackLiked(trackId: number) {
    return Boolean(playlistActionStates[trackId]?.liked)
      || Boolean(favoritePlaylist && trackIsInPlaylist(trackId, favoritePlaylist.id));
  }

  function showPlaylistActionError(trackId: number, action: PlaylistActionKind, message: string) {
    setPlaylistActionError({
      trackId,
      action,
      message: message.trim() || '添加到歌单失败，请稍后重试。',
    });
  }

  function hasPlaylistActionError(trackId: number, action: PlaylistActionKind) {
    return playlistActionError?.trackId === trackId && playlistActionError.action === action;
  }

  function updateProgressVisual(current: number, playableSeconds: number) {
    const progress = playbackProgress(current, playableSeconds);
    const percent = `${progress * 100}%`;
    for (const control of [nowPlayingProgressRef.current, compactProgressRef.current]) {
      if (!control) continue;
      control.style.setProperty('--music-progress', percent);
      control.style.setProperty('--music-progress-ratio', String(progress));
    }
  }

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus();
  }, [isSearchOpen]);

  useLayoutEffect(() => {
    const nav = musicNavRef.current;
    if (!nav) return;

    const updateIndicator = () => {
      const activeButton = nav.querySelector<HTMLButtonElement>('button.is-active');
      if (!activeButton) {
        setMusicNavIndicator((current) => current.ready ? { ...current, ready: false } : current);
        return;
      }
      const navRect = nav.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      const left = buttonRect.left - navRect.left - nav.clientLeft;
      const width = buttonRect.width;
      setMusicNavIndicator((current) => (
        current.ready && Math.abs(current.left - left) < 0.5 && Math.abs(current.width - width) < 0.5
          ? current
          : { left, width, ready: true }
      ));
    };

    const frame = window.requestAnimationFrame(updateIndicator);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateIndicator);
    observer?.observe(nav);
    window.addEventListener('resize', updateIndicator);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', updateIndicator);
    };
  }, [view]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const tick = () => {
      const playableSeconds = playbackWindow(audio.duration, currentTrack?.durationMs ?? null).playableSeconds;
      updateProgressVisual(audio.currentTime, playableSeconds);
      if (!audio.paused) frame = window.requestAnimationFrame(tick);
    };

    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [currentTrack?.durationMs, duration, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = isMuted;
  }, [isMuted, volume]);

  function hydrateMoodPreview(mood: typeof FEATURED_MOODS[number], tracks: MusicTrack[], retried = false) {
    const first = tracks[0];
    if (!first || first.coverUrl || moodPreviewHydrating.current.has(mood.title)) return;
    moodPreviewHydrating.current.add(mood.title);
    void window.workbench.music.trackDetails(first.id)
      .then((details) => {
        if (!details?.coverUrl) return;
        const hydrated = { ...first, ...details, coverUrl: details.coverUrl };
        const cached = moodTracks.current.get(mood.title);
        const source = cached?.[0]?.id === first.id ? cached : tracks;
        const next = [hydrated, ...source.slice(1)];
        moodTracks.current.set(mood.title, next);
        setMoodPreviews((previews) => ({ ...previews, [mood.title]: hydrated }));
      })
      .catch(() => {
        if (!retried) window.setTimeout(() => hydrateMoodPreview(mood, tracks, true), 900);
      })
      .finally(() => moodPreviewHydrating.current.delete(mood.title));
  }

  async function loadMoodTracks(mood: typeof FEATURED_MOODS[number]) {
    const cached = moodTracks.current.get(mood.title);
    if (cached) {
      hydrateMoodPreview(mood, cached);
      return cached;
    }
    const tracks = await window.workbench.music.search(mood.query);
    const first = tracks[0];
    moodTracks.current.set(mood.title, tracks);
    if (first) hydrateMoodPreview(mood, tracks);
    return tracks;
  }

  useEffect(() => {
    window.workbench.music.serviceStatus().then((status) => {
      setServiceBase(status.base || '');
      setServiceReady(status.ready);
      if (!status.ready) {
        setLibraryError(status.error || '音乐服务尚未就绪，请稍后重试。');
      }
    }).catch(() => {
      setServiceReady(false);
      setLibraryError('音乐服务尚未就绪，请稍后重试。');
    });
    window.workbench.music.accountState().then((next) => {
      setLibrary(next);
      const playlistId = next.selectedPlaylistId;
      const cachedTracks = playlistId ? next.tracksByPlaylist[String(playlistId)] : null;
      if (playlistId && cachedTracks?.length) {
        setActivePlaylistId(playlistId);
        setResults(cachedTracks);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!serviceReady || !serviceBase) return;
    let cancelled = false;
    FEATURED_MOODS.forEach((mood) => {
      void loadMoodTracks(mood)
        .then((tracks) => {
          if (cancelled || !tracks[0]) return;
          setMoodPreviews((previews) => ({
            ...previews,
            [mood.title]: previews[mood.title]?.coverUrl ? previews[mood.title] : tracks[0],
          }));
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [serviceBase, serviceReady]);

  useEffect(() => {
    if (!loginKey) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || loginPolling.current) return;
      loginPolling.current = true;
      try {
        const result = await window.workbench.music.checkQrLogin(loginKey);
        if (cancelled) return;
        if (result.status === 'waiting-scan' || result.status === 'waiting-confirm') {
          setLoginStatus(result.status);
          return;
        }
        if (result.status === 'authorized') {
          const next = result.library || EMPTY_MUSIC_LIBRARY;
          setLibrary(next);
          setLoginStatus('authorized');
          setLoginKey('');
          setQrImage('');
          const playlistId = next.selectedPlaylistId || next.playlists[0]?.id;
          if (playlistId) void loadPlaylist(playlistId, next);
          return;
        }
        setLoginStatus('expired');
        setLoginKey('');
        setLibraryError(result.message);
      } catch (err) {
        if (!cancelled) {
          setLoginKey('');
          setQrImage('');
          setLoginStatus('idle');
          setLibraryError(err instanceof Error ? err.message : '二维码登录失败，请稍后重试。');
        }
      } finally {
        loginPolling.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loginKey]);

  useEffect(() => {
    const fallbackHue = fallbackMusicThemeHue(currentTrack?.id ?? 0);
    if (!currentTrack?.coverUrl) {
      setThemeHue(fallbackHue);
      return;
    }

    let cancelled = false;
    const cover = new Image();
    cover.crossOrigin = 'anonymous';
    cover.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(cover, 0, 0, canvas.width, canvas.height);
        const hue = themeHueFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, fallbackHue);
        if (!cancelled) setThemeHue(hue);
      } catch {
        if (!cancelled) setThemeHue(fallbackHue);
      }
    };
    cover.onerror = () => {
      if (!cancelled) setThemeHue(fallbackHue);
    };
    cover.src = currentTrack.coverUrl;
    return () => { cancelled = true; };
  }, [currentTrack?.coverUrl, currentTrack?.id]);

  useEffect(() => {
    const trackId = currentTrack?.id;
    if (!trackId) {
      setLyrics([]);
      setLyricsStatus('idle');
      return;
    }
    const cached = lyricCache.current.get(trackId);
    if (cached) {
      setLyrics(cached);
      setLyricsStatus(cached.length ? 'ready' : 'empty');
      return;
    }

    let cancelled = false;
    setLyrics([]);
    setLyricsStatus('loading');
    window.workbench.music.lyrics(trackId)
      .then((lines) => {
        if (cancelled) return;
        lyricCache.current.set(trackId, lines);
        setLyrics(lines);
        setLyricsStatus(lines.length ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) setLyricsStatus('failed');
      });
    return () => { cancelled = true; };
  }, [currentTrack?.id]);

  useEffect(() => {
    if (activeLyricIndex < 0) return;
    lyricListRef.current?.querySelector<HTMLElement>('[data-active-lyric="true"]')
      ?.scrollIntoView({ block: 'center', behavior: isPlaying ? 'smooth' : 'auto' });
  }, [activeLyricIndex, currentTrack?.id, isPlaying]);

  async function search(input = query) {
    const keywords = input.trim();
    if (!keywords || loading) return;
    setQuery(keywords);
    setActivePlaylistId(null);
    setView('search');
    setLoading(true);
    setError('');
    try {
      setResults(await window.workbench.music.search(keywords));
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : '搜索失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  async function startAccountLogin() {
    if (!serviceReady) {
      setLibraryError('音乐服务尚未就绪，请稍后重试。');
      return;
    }
    if (!serviceBase.trim()) {
      setLibraryError('请先设置音乐服务地址。');
      onOpenSettings();
      return;
    }
    setView('library');
    setAccountLoading(true);
    setLibraryError('');
    try {
      const qr = await window.workbench.music.startQrLogin();
      setLoginKey(qr.key);
      setQrImage(qr.qrImage);
      setLoginStatus('waiting-scan');
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : '获取登录二维码失败，请检查音乐服务。');
    } finally {
      setAccountLoading(false);
    }
  }

  async function syncAccount() {
    setView('library');
    setAccountLoading(true);
    setLibraryError('');
    try {
      const next = await window.workbench.music.syncAccount();
      setLibrary(next);
      const playlistId = next.selectedPlaylistId || next.playlists[0]?.id;
      if (playlistId) await loadPlaylist(playlistId, next);
      else {
        setActivePlaylistId(null);
        setResults([]);
      }
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : '同步账号信息失败，请稍后重试。');
    } finally {
      setAccountLoading(false);
    }
  }

  async function loadPlaylist(id: number, sourceLibrary = library) {
    const playlistId = Number(id);
    if (!Number.isFinite(playlistId) || playlistLoadingId === playlistId) return;
    setPlaylistLoadingId(playlistId);
    setLibraryError('');
    setActivePlaylistId(playlistId);
    setView('library');
    setQuery('');
    try {
      const cachedTracks = sourceLibrary.tracksByPlaylist[String(playlistId)];
      if (cachedTracks?.length) {
        setResults(cachedTracks);
        return;
      }
      const result = await window.workbench.music.syncPlaylist(playlistId);
      setLibrary(result.library);
      setResults(result.tracks);
    } catch (err) {
      setResults([]);
      setLibraryError(err instanceof Error ? err.message : '同步歌单歌曲失败，请稍后重试。');
    } finally {
      setPlaylistLoadingId(null);
    }
  }

  async function logoutAccount() {
    setAccountLoading(true);
    setLibraryError('');
    try {
      setLibrary(await window.workbench.music.logout());
      setResults([]);
      setActivePlaylistId(null);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : '退出账号失败，请稍后重试。');
    } finally {
      setAccountLoading(false);
    }
  }

  async function startPlayback(track: MusicTrack, source: string) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = source;
    audio.volume = volume;
    audio.muted = isMuted;
    setCurrentTrack(track);
    void hydrateTrack(track);
    setCurrentTime(0);
    setDuration(0);
    updateProgressVisual(0, 0);
    await audio.play();
  }

  function hydrateTrack(track: MusicTrack) {
    if (track.coverUrl) return;
    const trackDetails = window.workbench.music.trackDetails;
    if (typeof trackDetails !== 'function') return;
    void trackDetails(track.id)
      .then((details) => {
        if (!details) return;
        setCurrentTrack((current) => current?.id === track.id ? { ...current, ...details, coverUrl: details.coverUrl || current.coverUrl } : current);
      })
      .catch(() => {
        // 封面补全失败时保持当前可播放状态和低饱和唱片降级样式。
      });
  }

  async function play(track: MusicTrack, toggle = true) {
    if (loadingTrackId === track.id) return false;
    if (currentTrack?.id === track.id && audioRef.current?.src) {
      try {
        if (audioRef.current.paused) await audioRef.current.play();
        else if (toggle) audioRef.current.pause();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : '这首歌暂时无法播放。');
        return false;
      }
    }
    setLoadingTrackId(track.id);
    setError('');
    try {
      const source = await window.workbench.music.playbackUrl(track.id);
      await startPlayback(track, source);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '这首歌暂时无法播放。');
      return false;
    } finally {
      setLoadingTrackId(null);
    }
  }

  async function startMood(mood: typeof FEATURED_MOODS[number]) {
    if (loading || moodLoadingTitle) return;
    setMoodLoadingTitle(mood.title);
    setQuery(mood.query);
    setActivePlaylistId(null);
    setView('search');
    setLoading(true);
    setError('');
    try {
      const tracks = await loadMoodTracks(mood);
      if (tracks[0]) setMoodPreviews((previews) => ({ ...previews, [mood.title]: previews[mood.title]?.coverUrl ? previews[mood.title] : tracks[0] }));
      setResults(tracks);
      if (tracks[0] && await play(tracks[0], false)) setView('player');
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : '暂时无法准备这组音乐。');
    } finally {
      setLoading(false);
      setMoodLoadingTitle(null);
    }
  }

  useEffect(() => {
    if (!agentCommand || handledAgentCommands.current.has(agentCommand)) return;
    handledAgentCommands.current.add(agentCommand);
    setQuery(agentCommand.query);
    setResults(agentCommand.tracks);
    setActivePlaylistId(null);
    setView(agentCommand.type === 'play' ? 'player' : 'search');
    setQueueOpen(false);
    setError('');
    if (agentCommand.type === 'play') {
      void startPlayback(agentCommand.track, agentCommand.source)
        .catch((err) => setError(err instanceof Error ? err.message : '这首歌暂时无法播放。'));
    }
    onAgentCommandHandled();
  }, [agentCommand]);

  function playRelative(offset: number) {
    if (!results.length || loadingTrackId !== null) return false;
    const currentIndex = currentTrack ? results.findIndex((track) => track.id === currentTrack.id) : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + offset + results.length) % results.length;
    void play(results[nextIndex]);
    return true;
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return false;
    if (audio.paused) void audio.play().catch(() => setError('浏览器阻止了播放，请再试一次。'));
    else audio.pause();
    return true;
  }

  function changeVolume(value: number) {
    if (!Number.isFinite(value)) return;
    const nextVolume = Math.min(1, Math.max(0, value));
    setVolume(nextVolume);
    setIsMuted(false);
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
      audioRef.current.muted = false;
    }
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) audioRef.current.muted = nextMuted;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void search();
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !Number.isFinite(value)) return false;
    const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const nextTime = max > 0 ? Math.min(Math.max(value, 0), max) : Math.max(value, 0);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    updateProgressVisual(nextTime, playbackWindow(max, currentTrack.durationMs).playableSeconds);
    return true;
  }

  function seekRelative(offset: number) {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return false;
    const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    if (!Number.isFinite(max) || max <= 0) return false;
    return seek(audio.currentTime + offset);
  }

  function openPlaylistPicker(track: MusicTrack) {
    if (!library.account) {
      showPlaylistActionError(track.id, 'collect', '请先登录网易云音乐。');
      setView('library');
      return;
    }
    if (!ownedPlaylists.length) {
      showPlaylistActionError(track.id, 'collect', '没有可写入的个人歌单。');
      setView('library');
      return;
    }
    setPlaylistActionError(null);
    setPlaylistPickerTrack(track);
  }

  async function addTrackToPlaylist(track: MusicTrack, playlist: MusicPlaylist, action: PlaylistActionKind = 'collect') {
    if (playlistMutation) return;
    setPlaylistMutation({ playlistId: playlist.id, trackId: track.id });
    setPlaylistActionError(null);
    try {
      const result = await window.workbench.music.addToPlaylist(playlist.id, track.id);
      setLibrary(result.library);
      if (activePlaylistId === playlist.id) setResults(result.tracks);
      setPlaylistActionStates((current) => {
        const previous = current[track.id] || { collected: false, liked: false };
        return {
          ...current,
          [track.id]: {
            collected: true,
            liked: previous.liked || action === 'like' || playlist.id === favoritePlaylist?.id,
          },
        };
      });
      setPlaylistPickerTrack(null);
    } catch (err) {
      showPlaylistActionError(track.id, action, err instanceof Error ? err.message : '添加到歌单失败，请稍后重试。');
    } finally {
      setPlaylistMutation(null);
    }
  }

  function renderTrackActions(track: MusicTrack) {
    const pending = playlistMutation?.trackId === track.id;
    const collected = isTrackCollected(track.id);
    const liked = isTrackLiked(track.id);
    return (
      <div className="music-track-actions">
        <button
          type="button"
          className={`music-track-collect${hasPlaylistActionError(track.id, 'collect') ? ' is-error' : ''}`}
          onClick={() => openPlaylistPicker(track)}
          disabled={Boolean(playlistMutation)}
          aria-label={collected ? `已收藏${track.title}，打开歌单选择` : `收藏${track.title}到歌单`}
          aria-pressed={collected}
        >
          {pending ? <RefreshCw size={15} className="is-spinning" /> : collected ? <Bookmark size={16} fill="currentColor" /> : <BookmarkPlus size={16} />}
        </button>
        <button
          type="button"
          className={`music-track-like${hasPlaylistActionError(track.id, 'like') ? ' is-error' : ''}`}
          onClick={() => favoritePlaylist && void addTrackToPlaylist(track, favoritePlaylist, 'like')}
          disabled={!favoritePlaylist || Boolean(playlistMutation)}
          aria-label={favoritePlaylist ? `喜欢并添加到「${favoritePlaylist.name}」歌单` : '未找到喜欢的音乐歌单'}
          aria-pressed={liked}
        >
          {pending ? <RefreshCw size={15} className="is-spinning" /> : <Heart size={16} fill={liked ? 'currentColor' : 'none'} />}
        </button>
      </div>
    );
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
    }

    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const action = resolveMusicShortcut(event.key, event.shiftKey, isEditableTarget(event.target));
      if (!action) return;

      const handled = action === 'toggle'
        ? togglePlayback()
        : action === 'seek-backward'
          ? seekRelative(-5)
          : action === 'seek-forward'
            ? seekRelative(5)
            : playRelative(action === 'previous' ? -1 : 1);
      if (handled) event.preventDefault();
    }

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [currentTrack, duration, loadingTrackId, results]);

  function renderTrackRow(track: MusicTrack, context: 'default' | 'library' | 'queue' = 'default', index?: number) {
    const active = currentTrack?.id === track.id;
    const trackLabel = `${track.title} · ${track.artists}${track.album ? ` · ${track.album}` : ''}`;
    const rowStyle = context === 'queue'
      ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 64px', minHeight: 72, height: 72 }
      : undefined;
    return (
      <div key={track.id} className={`music-track-row has-cover${active ? ' is-active' : ''}`} style={rowStyle}>
        <button type="button" className="music-track-main" onClick={() => void play(track)} disabled={loadingTrackId === track.id} title={trackLabel}>
          {context === 'library' && <span className="music-track-index" aria-hidden="true">{String((index ?? 0) + 1).padStart(2, '0')}</span>}
          <span className="music-track-art" aria-hidden="true">
            {track.coverUrl
              ? <img className="music-track-cover" src={track.coverUrl} alt="" />
              : <span className="music-track-cover music-track-cover-placeholder"><AudioLines size={16} /></span>}
            <span className="music-track-play">{loadingTrackId === track.id ? '…' : active ? <PlayingWave /> : <Play size={20} fill="currentColor" />}</span>
          </span>
          <span className="music-track-copy"><strong>{track.title}</strong><small>{track.artists}{track.album ? ` · ${track.album}` : ''}</small></span>
          <time>{formatDuration(track.durationMs)}</time>
        </button>
        {renderTrackActions(track)}
      </div>
    );
  }

  function renderLyricsPanel({ standalone = false } = {}) {
    return (
      <section className={`music-now-page-lyrics${standalone ? ' is-standalone' : ''}`} aria-label="歌词">
        {!standalone && <header className="music-now-page-lyrics-head">
          <span>歌词</span>
          {lyricsStatus === 'loading' && <small>正在加载</small>}
          {lyricsStatus === 'ready' && <small>{lyrics.length} 行</small>}
        </header>}
        <div ref={lyricListRef} className="music-now-page-lyrics-list" role="region" aria-label="同步歌词" tabIndex={0}>
          {lyricsStatus === 'loading' && <div className="music-now-page-lyrics-loading" aria-label="正在加载歌词"><i /><i /><i /></div>}
          {lyricsStatus === 'ready' && lyrics.map((line, index) => (
            <p key={`${line.atMs}-${index}`} className={index === activeLyricIndex ? 'is-active' : ''} data-active-lyric={index === activeLyricIndex || undefined} aria-current={index === activeLyricIndex ? 'true' : undefined}>{line.text}</p>
          ))}
          {lyricsStatus === 'empty' && <p className="music-now-page-lyrics-message">暂未收录同步歌词。</p>}
          {lyricsStatus === 'failed' && <p className="music-now-page-lyrics-message">歌词暂时不可用。</p>}
        </div>
      </section>
    );
  }

  function renderQueuePanel(queue: MusicTrack[]) {
    return (
      <aside id="music-now-page-queue" className={`music-now-page-queue${queue.length > 7 ? ' has-long-queue' : ''}`} aria-label="播放队列">
        <header className="music-now-page-queue-head"><span>接下来播放</span><div><small>{queue.length} 首</small><button type="button" onClick={() => setQueueOpen(false)} aria-label="关闭播放队列"><X size={15} /></button></div></header>
        {queue.length ? <div className="music-track-list music-now-page-queue-list" role="region" aria-label={`接下来播放，共 ${queue.length} 首`} tabIndex={0}>{queue.map((track) => renderTrackRow(track, 'queue'))}</div> : <p>队列里没有更多歌曲。</p>}
      </aside>
    );
  }

  function renderDetailHeader(page: 'player' | 'lyrics', queue: MusicTrack[]) {
    const isLyricsPage = page === 'lyrics';
    return (
      <header className="music-now-page-header">
        <button type="button" className="music-now-page-back" onClick={() => { setQueueOpen(false); setView(isLyricsPage ? 'player' : 'discover'); }}><ChevronLeft size={17} />{isLyricsPage ? '返回封面' : '返回发现'}</button>
        <span>{isLyricsPage ? '歌词' : '播放详情'}</span>
        <div className="music-now-page-header-actions">
          <button type="button" className="music-now-page-view-switch" onClick={() => { setQueueOpen(false); setView(isLyricsPage ? 'player' : 'lyrics'); }} aria-label={isLyricsPage ? '打开封面播放页' : '打开歌词页'}>{isLyricsPage ? <Disc3 size={15} /> : <Captions size={15} />}{isLyricsPage ? '封面' : '歌词'}</button>
          <button type="button" className="music-now-page-queue-trigger" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="music-now-page-queue" aria-label={queueOpen ? '收起播放队列' : `打开播放队列，共 ${queue.length} 首`}><ListMusic size={15} /></button>
        </div>
      </header>
    );
  }

  function closeLoginModal() {
    setLoginKey('');
    setQrImage('');
    setLoginStatus('idle');
  }

  function renderMusicNav() {
    const navStyle = {
      '--music-nav-indicator-left': `${musicNavIndicator.left}px`,
      '--music-nav-indicator-width': `${musicNavIndicator.width}px`,
    } as CSSProperties;
    return (
      <nav ref={musicNavRef} className={`music-local-nav${musicNavIndicator.ready ? ' is-ready' : ''}`} style={navStyle} aria-label="音乐导航">
        <span className="music-local-nav-indicator" aria-hidden="true" />
        <button type="button" className={view === 'discover' ? 'is-active' : ''} onClick={() => { setQueueOpen(false); setView('discover'); }}>发现</button>
        <button type="button" className={view === 'library' ? 'is-active' : ''} onClick={() => { setQueueOpen(false); setView('library'); }}>我的音乐</button>
      </nav>
    );
  }

  function renderTopBar() {
    return (
      <header className="music-topbar">
        <div className="music-topbar-heading">
          <div className={`music-search-control${isSearchOpen ? ' is-open' : ''}`}>
            <button type="button" className="music-search-trigger" onClick={() => setSearchOpen(true)} aria-label="打开搜索" aria-expanded={isSearchOpen} title="搜索歌曲">
              <Search size={16} aria-hidden="true" />
            </button>
            {isSearchOpen && (
              <form id="music-search-form" className="music-topbar-search" onSubmit={submit}>
                <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} onBlur={() => setSearchOpen(false)} placeholder="搜索歌曲" aria-label="搜索歌曲" maxLength={80} />
              </form>
            )}
          </div>
          {renderMusicNav()}
        </div>
      </header>
    );
  }

  function renderDiscover() {
    const hour = new Date().getHours();
    const greeting = hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    const featuredPlaylist = library.playlists.find((playlist) => playlist.id === library.selectedPlaylistId) || library.playlists[0];
    const showServiceFallback = !serviceReady && !currentTrack && !featuredPlaylist;
    const featuredCoverUrl = currentTrack?.coverUrl || featuredPlaylist?.coverUrl?.replace(/^http:/, 'https:') || '';
    const featuredTitle = currentTrack?.title || featuredPlaylist?.name || (showServiceFallback ? '音乐暂未就绪' : '开始一段音乐');
    const featuredMeta = currentTrack?.artists || (featuredPlaylist ? `${featuredPlaylist.trackCount} 首歌曲` : showServiceFallback ? '检查服务后，再从一首歌开始。' : '搜索一首歌开始试听');
    const featuredKicker = currentTrack ? (isPlaying ? '正在播放' : '已暂停') : showServiceFallback ? '音乐服务未就绪' : '继续听';
    const featuredActionLabel = currentTrack ? '打开播放器' : featuredPlaylist ? '打开歌单' : showServiceFallback ? '检查服务' : '开始搜索';
    const quickPlaylists = library.playlists
      .filter((playlist) => playlist.id !== featuredPlaylist?.id)
      .slice(0, featuredPlaylist ? 4 : 6);

    function openFeatured() {
      if (showServiceFallback) {
        onOpenSettings();
      } else if (currentTrack) {
        setView('player');
      } else if (featuredPlaylist) {
        void loadPlaylist(featuredPlaylist.id);
      } else {
        setSearchOpen(true);
      }
    }

    return (
      <div className="music-discover-view">
        <section className="music-discover-heading">
          <h1>{greeting}</h1>
        </section>

        <section className="music-featured-card" aria-labelledby="music-featured-title">
          <div className="music-featured-copy">
            <span className="music-featured-kicker">{featuredKicker}</span>
            <h2 id="music-featured-title">{featuredTitle}</h2>
            <p>{featuredMeta}</p>
            <button type="button" className="music-featured-action" onClick={openFeatured} disabled={Boolean(featuredPlaylist && playlistLoadingId === featuredPlaylist.id)}>
              <Play size={14} fill="currentColor" aria-hidden="true" />
              {featuredActionLabel}
            </button>
          </div>
          <div className="music-featured-art" aria-hidden="true">
            {featuredCoverUrl ? <img src={featuredCoverUrl} alt="" /> : <span><AudioLines size={34} /></span>}
          </div>
        </section>

        {quickPlaylists.length > 0 && (
          <section className="music-quick-section" aria-labelledby="music-quick-title">
            <header className="music-shelf-heading"><h2 id="music-quick-title">{featuredPlaylist ? '更多歌单' : '快速开始'}</h2><button type="button" className="music-section-link" onClick={() => setView('library')}>查看全部 <ChevronRight size={15} aria-hidden="true" /></button></header>
            <div className={`music-quick-grid${featuredPlaylist ? ' has-featured' : ''}`}>
              {quickPlaylists.map((playlist) => (
                <button key={playlist.id} type="button" className="music-quick-card" onClick={() => void loadPlaylist(playlist.id)} disabled={playlistLoadingId === playlist.id}>
                  {playlist.coverUrl ? <img src={playlist.coverUrl.replace(/^http:/, 'https:')} alt={`${playlist.name}封面`} /> : <span className="music-quick-cover" aria-hidden="true"><ListMusic size={18} /></span>}
                  <span className="music-quick-copy"><strong>{playlist.name}</strong></span>
                  <span className="music-quick-play" aria-hidden="true">{playlistLoadingId === playlist.id ? <RefreshCw size={14} className="is-spinning" /> : <Play size={13} fill="currentColor" />}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="music-mood-section" aria-labelledby="music-mood-title">
          <header className="music-shelf-heading music-mood-heading"><h2 id="music-mood-title">换个心情</h2><button type="button" className="music-section-link" onClick={() => void startMood(FEATURED_MOODS[Math.floor(Math.random() * FEATURED_MOODS.length)])} disabled={loading || Boolean(moodLoadingTitle)}>随便听听 <ChevronRight size={15} aria-hidden="true" /></button></header>
          <div className="music-feature-grid music-discover-feature-grid">
            {FEATURED_MOODS.map((mood) => {
              const preview = moodPreviews[mood.title];
              const isMoodLoading = moodLoadingTitle === mood.title;
              return (
                <button key={mood.title} type="button" className={`music-feature-card music-feature-card-${mood.visual}`} onClick={() => void startMood(mood)} disabled={loading || Boolean(moodLoadingTitle)} aria-label={`播放${mood.title}${preview ? `，${preview.title}` : ''}`}>
                  <span className={`music-feature-art${preview?.coverUrl ? ' has-cover' : ''}`}>
                    {preview?.coverUrl && <img src={preview.coverUrl.replace(/^http:/, 'https:')} alt={`${preview.title}封面`} />}
                    <span /><i /><b /><strong className="music-feature-action" aria-hidden="true">{isMoodLoading ? <RefreshCw size={13} className="is-spinning" /> : <Play size={13} fill="currentColor" />}</strong>
                  </span>
                  <span className="music-feature-copy"><strong>{mood.title}</strong>{preview && <small>{preview.title}</small>}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderSearchResults() {
    return (
      <div className="music-subpage music-search-view">
        <header className="music-subpage-heading">
          <div><button type="button" className="music-back-link" onClick={() => setView('discover')}><ChevronLeft size={15} />返回发现</button></div>
          {results.length > 0 && <span className="music-subpage-count">{results.length} 首</span>}
        </header>
        {error && <div className="music-service-alert is-error" role="alert"><span>{error}</span><button type="button" className="text-btn" onClick={onOpenSettings}>检查服务</button></div>}
        {loading && <div className="music-results-panel music-results-loading" aria-label="正在搜索">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="music-skeleton-row"><span /><i /><b /><em /></div>)}</div>}
        {!loading && results.length === 0 && <div className="music-results-panel music-results-empty-state"><span className="music-empty-disc" aria-hidden="true"><AudioLines size={24} /></span><strong>还没有搜索结果</strong><span>换个关键词试试，或回到发现页听一张精选唱片。</span><button type="button" className="text-btn" onClick={() => setView('discover')}>返回发现</button></div>}
        {!loading && results.length > 0 && <section className="music-results-panel music-track-list music-search-results-list" aria-live="polite">{results.map((track) => renderTrackRow(track))}</section>}
      </div>
    );
  }

  function renderAccountPanel() {
    const account = library.account;
    if (!account) return null;
    return (
      <div className="music-library-account-inline">
        <div className="music-account-identity">
          {account.avatarUrl
            ? <img src={account.avatarUrl} alt="" />
            : <span className="music-account-avatar-placeholder" aria-hidden="true"><CircleUserRound size={18} /></span>}
          <span><strong>{account.nickname}</strong><small>我的歌单 · {library.playlists.length}</small></span>
        </div>
        <div className="music-account-actions">
          <button type="button" className="music-account-action" onClick={() => void syncAccount()} disabled={accountLoading || Boolean(loginKey)}><RefreshCw size={14} className={accountLoading ? 'is-spinning' : ''} />{accountLoading ? '同步中' : '同步歌单'}</button>
          <button type="button" className="music-account-action is-quiet" onClick={() => void logoutAccount()} disabled={accountLoading}><LogOut size={14} />退出</button>
        </div>
      </div>
    );
  }

  function renderLibrary() {
    const selectedPlaylist = library.playlists.find((playlist) => playlist.id === activePlaylistId);
    return (
      <div className="music-subpage music-library-view">
        {libraryError && <div className="music-service-alert is-error" role="alert"><span>{libraryError}</span>{!serviceReady && <button type="button" className="text-btn" onClick={onOpenSettings}>检查服务</button>}</div>}
        {library.account ? (
          <div className="music-library-layout">
            <aside className="music-library-playlists" aria-label="我的歌单">
              {renderAccountPanel()}
              <div className="music-library-playlist-list" role="region" aria-label="歌单列表" tabIndex={0}>
                {library.playlists.length ? library.playlists.map((playlist) => (
                  <button key={playlist.id} type="button" className={`music-library-playlist${activePlaylistId === playlist.id ? ' is-active' : ''}`} onClick={() => void loadPlaylist(playlist.id)} disabled={playlistLoadingId === playlist.id} aria-current={activePlaylistId === playlist.id ? 'true' : undefined} title={playlist.name}>
                    {playlist.coverUrl ? <img src={playlist.coverUrl} alt="" /> : <span className="music-playlist-cover"><ListMusic size={15} /></span>}
                    <span><strong>{playlist.name}</strong><small>{playlist.trackCount} 首{playlist.isMine ? ' · 我的' : ''}</small></span>
                    {playlistLoadingId === playlist.id ? <RefreshCw size={14} className="is-spinning" aria-label="同步中" /> : <ChevronRight size={14} aria-hidden="true" />}
                  </button>
                )) : <p className="music-library-column-empty">还没有歌单。</p>}
              </div>
            </aside>
            <section className="music-library-tracks" aria-live="polite">
              <div className="music-library-column-heading"><strong>{selectedPlaylist?.name || '选择一个歌单'}</strong>{selectedPlaylist && <small>{selectedPlaylist.trackCount} 首</small>}</div>
              {!activePlaylistId && <div className="music-library-empty"><AudioLines size={23} /><strong>选择左侧歌单</strong><span>歌曲列表会在这里显示。</span></div>}
              {activePlaylistId && playlistLoadingId === activePlaylistId && <div className="music-results-loading">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="music-skeleton-row"><span /><i /><b /><em /></div>)}</div>}
              {activePlaylistId && playlistLoadingId !== activePlaylistId && !results.length && <div className="music-library-empty"><AudioLines size={23} /><strong>这个歌单还没有歌曲</strong><span>可以点击上方“同步歌单”重新拉取。</span></div>}
              {activePlaylistId && playlistLoadingId !== activePlaylistId && results.length > 0 && <div className="music-track-list music-library-track-list">{results.map((track, index) => renderTrackRow(track, 'library', index))}</div>}
            </section>
          </div>
        ) : (
          <div className="music-library-login-empty"><span className="music-empty-disc" aria-hidden="true"><LogIn size={26} /></span><div><strong>登录后管理你的音乐</strong><button type="button" className="text-btn" onClick={() => void startAccountLogin()}>扫码登录网易云音乐</button></div></div>
        )}
      </div>
    );
  }

  function renderNowPlaying() {
    const queue = upcomingTracks(results, currentTrack?.id);
    const preview = playbackWindow(duration, currentTrack?.durationMs ?? null);
    const currentTrackId = currentTrack?.id ?? null;
    const collected = currentTrackId !== null && isTrackCollected(currentTrackId);
    const liked = currentTrackId !== null && isTrackLiked(currentTrackId);
    return (
      <div className="music-now-page music-player-page" aria-label="播放详情">
        {renderDetailHeader('player', queue)}
        {currentTrack ? (
          <div className={`music-now-page-layout${queueOpen ? ' is-queue-open' : ''}`}>
            <section className="music-now-page-focus">
              <div className={`music-now-page-art${isPlaying ? ' is-playing' : ''}`}>
                <span className="music-stage-vinyl" aria-hidden="true" />
                {currentTrack.coverUrl
                  ? <img className="music-stage-art" src={currentTrack.coverUrl} alt="" />
                  : <span className="music-stage-art music-stage-placeholder" aria-hidden="true"><AudioLines size={48} /></span>}
              </div>
              <div className="music-now-page-state">
                <span className="music-now-page-status">{isPlaying ? <PlayingWave /> : <AudioLines size={15} />}{isPlaying ? '正在播放' : '已暂停'}</span>
                {preview.isPreview && <span className="music-now-page-preview" title={`当前音源仅可试听 ${formatSeconds(preview.playableSeconds)}，原曲时长 ${formatSeconds(preview.catalogSeconds)}`}>试听片段 · {formatSeconds(preview.playableSeconds)}</span>}
              </div>
              <h2>{currentTrack.title}</h2>
              <p>{currentTrack.artists}{currentTrack.album ? ` · ${currentTrack.album}` : ''}</p>
              <div className="music-now-page-controls">
                <button type="button" className="music-now-page-step" onClick={() => playRelative(-1)} disabled={!results.length} aria-label="上一首"><SkipBack size={18} fill="currentColor" /></button>
                <button type="button" className="music-now-page-toggle" onClick={togglePlayback} aria-label={isPlaying ? '暂停播放' : '播放'}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
                <button type="button" className="music-now-page-step" onClick={() => playRelative(1)} disabled={!results.length} aria-label="下一首"><SkipForward size={18} fill="currentColor" /></button>
              </div>
              <div className="music-now-page-actions">
                <button type="button" className={`music-now-page-add${hasPlaylistActionError(currentTrack.id, 'collect') ? ' is-error' : ''}`} onClick={() => openPlaylistPicker(currentTrack)} disabled={Boolean(playlistMutation)} aria-label={collected ? '已收藏，打开歌单选择' : '收藏到歌单'} aria-pressed={collected}>{collected ? <Bookmark size={16} fill="currentColor" /> : <BookmarkPlus size={16} />}</button>
                <button type="button" className={`music-now-page-like${hasPlaylistActionError(currentTrack.id, 'like') ? ' is-error' : ''}`} onClick={() => favoritePlaylist && void addTrackToPlaylist(currentTrack, favoritePlaylist, 'like')} disabled={!favoritePlaylist || Boolean(playlistMutation)} aria-label={favoritePlaylist ? `喜欢并添加到「${favoritePlaylist.name}」歌单` : '未找到喜欢的音乐歌单'} aria-pressed={liked}><Heart size={15} fill={liked ? 'currentColor' : 'none'} /></button>
              </div>
              <div className="music-now-page-progress"><time>{formatSeconds(currentTime)}</time><span ref={nowPlayingProgressRef} className="music-progress-control" style={progressStyle(currentTime, preview.playableSeconds)}><i aria-hidden="true" /><input type="range" min="0" max={preview.playableSeconds} value={Math.min(currentTime, preview.playableSeconds)} onChange={(event) => seek(Number(event.target.value))} disabled={!preview.playableSeconds} aria-label={preview.isPreview ? `试听进度，当前试听最长 ${formatSeconds(preview.playableSeconds)}，原曲时长 ${formatSeconds(preview.catalogSeconds)}` : '播放进度'} /></span><time>{formatSeconds(preview.playableSeconds)}</time></div>
            </section>
            {queueOpen && renderQueuePanel(queue)}
          </div>
        ) : (
          <div className="music-now-page-empty"><span className="music-empty-disc" aria-hidden="true"><AudioLines size={28} /></span><strong>还没有正在播放的歌曲</strong><span>从发现页或我的音乐选择一首歌。</span><button type="button" className="text-btn" onClick={() => setView('discover')}>返回发现</button></div>
        )}
      </div>
    );
  }

  function renderLyricsPage() {
    const queue = upcomingTracks(results, currentTrack?.id);
    return (
      <div className="music-now-page music-lyrics-page" aria-label="歌词页面">
        {renderDetailHeader('lyrics', queue)}
        {currentTrack ? (
          <div className={`music-lyrics-page-layout${queueOpen ? ' is-queue-open' : ''}`}>
            {renderLyricsPanel({ standalone: true })}
            {queueOpen && renderQueuePanel(queue)}
          </div>
        ) : (
          <div className="music-now-page-empty"><span className="music-empty-disc" aria-hidden="true"><AudioLines size={28} /></span><strong>还没有正在播放的歌曲</strong><span>选择一首歌后可以查看同步歌词。</span><button type="button" className="text-btn" onClick={() => setView('discover')}>返回发现</button></div>
        )}
      </div>
    );
  }

  function renderLoginModal() {
    if (!qrImage) return null;
    return (
      <div className="music-login-modal-layer" role="dialog" aria-modal="true" aria-labelledby="music-login-modal-title">
        <button type="button" className="music-login-modal-backdrop" onClick={closeLoginModal} aria-label="关闭登录窗口" />
        <section className="music-login-modal">
          <header><div><span className="music-section-kicker">账号连接</span><h2 id="music-login-modal-title">扫码登录网易云音乐</h2><p>{loginStatus === 'waiting-confirm' ? '已扫码，请在手机上确认' : loginStatus === 'expired' ? '二维码已过期，请重新获取' : '使用网易云音乐 App 扫码'}</p></div><button type="button" className="music-login-close" onClick={closeLoginModal} aria-label="关闭二维码"><X size={17} /></button></header>
          <img src={qrImage} alt="网易云音乐登录二维码" />
          <span className="music-login-modal-status">{loginStatus === 'waiting-confirm' ? '等待手机确认' : loginStatus === 'expired' ? '二维码已失效' : '等待扫码'}</span>
          {loginStatus === 'expired' && <button type="button" className="text-btn" onClick={() => void startAccountLogin()}>重新获取二维码</button>}
        </section>
      </div>
    );
  }

  function renderPlaylistPicker() {
    const track = playlistPickerTrack;
    if (!track) return null;
    return (
      <div className="music-playlist-picker-layer" role="dialog" aria-modal="true" aria-labelledby="music-playlist-picker-title">
        <button type="button" className="music-playlist-picker-backdrop" onClick={() => setPlaylistPickerTrack(null)} aria-label="关闭歌单选择" />
        <section className="music-playlist-picker">
          <header>
            <div><span>收藏到歌单</span><h2 id="music-playlist-picker-title">{track.title}</h2><p>选择要收藏到的网易云个人歌单</p></div>
            <button type="button" onClick={() => setPlaylistPickerTrack(null)} aria-label="关闭歌单选择"><X size={17} /></button>
          </header>
          <div className="music-playlist-picker-list">
            {ownedPlaylists.map((playlist) => {
              const pending = playlistMutation?.playlistId === playlist.id && playlistMutation.trackId === track.id;
              return (
                <button key={playlist.id} type="button" onClick={() => void addTrackToPlaylist(track, playlist)} disabled={Boolean(playlistMutation)}>
                  {playlist.coverUrl ? <img src={playlist.coverUrl.replace(/^http:/, 'https:')} alt="" /> : <span className="music-playlist-picker-cover"><ListMusic size={16} /></span>}
                  <span><strong>{playlist.name}</strong><small>{playlist.trackCount} 首</small></span>
                  {pending ? <RefreshCw size={16} className="is-spinning" /> : <BookmarkPlus size={16} />}
                </button>
              );
            })}
          </div>
          {playlistActionError?.trackId === track.id && playlistActionError.action === 'collect' && <div className="music-playlist-picker-error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{playlistActionError.message}</span></div>}
        </section>
      </div>
    );
  }

  const compactPlayback = playbackWindow(duration, currentTrack?.durationMs ?? null);

  return (
    <section className={`module-page music-page${view === 'player' || view === 'lyrics' ? ' is-detail-view' : ''}`} style={{ '--music-theme-hue': String(themeHue) } as CSSProperties}>
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={(event) => {
          setIsPlaying(false);
          updateProgressVisual(event.currentTarget.currentTime, playbackWindow(event.currentTarget.duration, currentTrack?.durationMs ?? null).playableSeconds);
        }}
        onEnded={() => playRelative(1)}
        onTimeUpdate={(event) => {
          const nextTime = event.currentTarget.currentTime;
          setCurrentTime(nextTime);
          updateProgressVisual(nextTime, playbackWindow(event.currentTarget.duration, currentTrack?.durationMs ?? null).playableSeconds);
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
          setDuration(nextDuration);
          updateProgressVisual(event.currentTarget.currentTime, playbackWindow(nextDuration, currentTrack?.durationMs ?? null).playableSeconds);
        }}
        onError={() => setError('音频加载失败，这首歌可能受版权或服务限制。')}
      />
      <div className="music-shell">
        {renderTopBar()}
        <main className="music-view">
          {view === 'discover' && renderDiscover()}
          {view === 'search' && renderSearchResults()}
          {view === 'library' && renderLibrary()}
          {view === 'player' && renderNowPlaying()}
          {view === 'lyrics' && renderLyricsPage()}
        </main>
      </div>
      {renderLoginModal()}
      {renderPlaylistPicker()}
      {playlistActionError && (!playlistPickerTrack || playlistActionError.trackId !== playlistPickerTrack.id) && <div className="music-action-feedback" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{playlistActionError.message}</span><button type="button" onClick={() => setPlaylistActionError(null)} aria-label="关闭提示"><X size={14} /></button></div>}
      {view !== 'player' && view !== 'lyrics' && <footer className="music-player" aria-label="迷你播放器">
        <button type="button" className="music-player-track" onClick={() => { setQueueOpen(false); setView('player'); }} aria-label={currentTrack ? '点击封面打开正在播放页面' : '打开播放页面'} title={currentTrack ? '点击封面打开正在播放页面' : '打开播放页面'}>
          <span className={`music-player-disc${currentTrack?.coverUrl ? ' has-cover' : ''}`} aria-hidden="true">
            {currentTrack?.coverUrl ? <img src={currentTrack.coverUrl} alt="" /> : <span className="music-player-disc-core"><AudioLines size={17} /></span>}
          </span>
          {currentTrack && <div><strong>{currentTrack.title}</strong><small>{currentTrack.artists}{compactPlayback.isPreview && <em className="music-player-preview">试听</em>}</small></div>}
        </button>
        <div className="music-player-center">
          <div className="music-player-controls">
            <button type="button" className="music-player-step" onClick={() => playRelative(-1)} disabled={!results.length} aria-label="上一首"><SkipBack size={16} fill="currentColor" /></button>
            <button type="button" className="music-player-toggle" onClick={togglePlayback} disabled={!currentTrack} aria-label={isPlaying ? '暂停播放' : '播放'}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button type="button" className="music-player-step" onClick={() => playRelative(1)} disabled={!results.length} aria-label="下一首"><SkipForward size={16} fill="currentColor" /></button>
          </div>
          <div className="music-progress"><time>{formatSeconds(currentTime)}</time><span ref={compactProgressRef} className="music-progress-control" style={progressStyle(currentTime, compactPlayback.playableSeconds)}><i aria-hidden="true" /><input type="range" min="0" max={compactPlayback.playableSeconds} value={Math.min(currentTime, compactPlayback.playableSeconds)} onChange={(event) => seek(Number(event.target.value))} disabled={!currentTrack || !compactPlayback.playableSeconds} aria-label={compactPlayback.isPreview ? `试听进度，最长 ${formatSeconds(compactPlayback.playableSeconds)}` : '播放进度'} /></span><time>{formatSeconds(compactPlayback.playableSeconds)}</time></div>
        </div>
        <div className="music-player-meta">
          <div className="music-player-audio-actions">
            <div className="music-player-collection-actions">
              <button type="button" className={`music-player-collect${currentTrack && hasPlaylistActionError(currentTrack.id, 'collect') ? ' is-error' : ''}`} onClick={() => currentTrack && openPlaylistPicker(currentTrack)} disabled={!currentTrack || Boolean(playlistMutation)} aria-label={currentTrack && isTrackCollected(currentTrack.id) ? '已收藏，打开歌单选择' : '收藏到歌单'} aria-pressed={currentTrack ? isTrackCollected(currentTrack.id) : false}>{currentTrack && isTrackCollected(currentTrack.id) ? <Bookmark size={17} fill="currentColor" /> : <BookmarkPlus size={17} />}</button>
              <button type="button" className={`music-player-like${currentTrack && hasPlaylistActionError(currentTrack.id, 'like') ? ' is-error' : ''}`} onClick={() => favoritePlaylist && currentTrack && void addTrackToPlaylist(currentTrack, favoritePlaylist, 'like')} disabled={!currentTrack || !favoritePlaylist || Boolean(playlistMutation)} aria-label={favoritePlaylist ? `喜欢并添加到「${favoritePlaylist.name}」歌单` : '未找到喜欢的音乐歌单'} aria-pressed={currentTrack ? isTrackLiked(currentTrack.id) : false}><Heart size={15} fill={currentTrack && isTrackLiked(currentTrack.id) ? 'currentColor' : 'none'} /></button>
            </div>
            <button type="button" className="music-player-volume-toggle" onClick={toggleMute} aria-label={isMuted || volume === 0 ? '打开声音' : '静音'}>{isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
            <label className="music-player-volume-slider">
              <span className="sr-only">音量</span>
              <input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label={`音量 ${Math.round((isMuted ? 0 : volume) * 100)}%`} style={{ '--music-volume': `${(isMuted ? 0 : volume) * 100}%` } as CSSProperties} />
            </label>
            <button type="button" className="music-player-queue-link" onClick={() => { setQueueOpen(true); setView('player'); }} aria-label={results.length ? `打开播放队列，共 ${results.length} 首` : '打开播放队列'}><ListMusic size={17} /></button>
          </div>
        </div>
      </footer>}
    </section>
  );
}
