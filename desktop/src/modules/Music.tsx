import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AudioLines, ChevronLeft, ChevronRight, CircleUserRound, ListMusic, LogIn, LogOut, Pause, Play, RefreshCw, Search, SkipBack, SkipForward, X } from 'lucide-react';
import type { AgentMusicCommand, MusicLibrary, MusicTrack } from '../types';
import { resolveMusicShortcut } from './musicShortcuts';
import { fallbackMusicThemeHue, themeHueFromPixels } from './musicTheme';

const FALLBACK_HOT_TERMS = ['周杰伦', '陈奕迅', '告五人', '林俊杰', 'Taylor Swift'];

const FEATURED_MOODS = [
  { title: '晨间精选', visual: 'dawn' },
  { title: '人声里的故事', visual: 'voice' },
  { title: '夜色慢放', visual: 'night' },
  { title: '耳机漫游', visual: 'roam' },
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

function formatDuration(durationMs: number | null) {
  return durationMs ? formatSeconds(durationMs / 1000) : '--:--';
}

function PlayingWave() {
  return <span className="music-playing-wave" aria-label="正在播放"><i /><i /><i /></span>;
}

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
  const handledAgentCommands = useRef(new WeakSet<AgentMusicCommand>());
  const [query, setQuery] = useState('');
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<MusicTrack[]>([]);
  const [hotTerms, setHotTerms] = useState(FALLBACK_HOT_TERMS);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTrackId, setLoadingTrackId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [view, setView] = useState<'discover' | 'search' | 'library' | 'player'>('discover');
  const [musicNavIndicator, setMusicNavIndicator] = useState({ left: 0, width: 0, ready: false });

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
    window.workbench.music.serviceStatus().then((status) => {
      setServiceBase(status.base || '');
      setServiceReady(status.ready);
      if (!status.ready) {
        setLibraryError(status.error || '音乐服务尚未就绪，请稍后重试。');
        return [];
      }
      return window.workbench.music.hotSearch();
    }).then((terms) => {
      if (terms.length) setHotTerms(terms);
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
    setCurrentTrack(track);
    void hydrateTrack(track);
    setCurrentTime(0);
    setDuration(0);
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

  async function play(track: MusicTrack) {
    if (loadingTrackId === track.id) return;
    if (currentTrack?.id === track.id && audioRef.current?.src) {
      if (audioRef.current.paused) await audioRef.current.play();
      else audioRef.current.pause();
      return;
    }
    setLoadingTrackId(track.id);
    setError('');
    try {
      const source = await window.workbench.music.playbackUrl(track.id);
      await startPlayback(track, source);
    } catch (err) {
      setError(err instanceof Error ? err.message : '这首歌暂时无法播放。');
    } finally {
      setLoadingTrackId(null);
    }
  }

  useEffect(() => {
    if (!agentCommand || handledAgentCommands.current.has(agentCommand)) return;
    handledAgentCommands.current.add(agentCommand);
    setQuery(agentCommand.query);
    setResults(agentCommand.tracks);
    setActivePlaylistId(null);
    setView(agentCommand.type === 'play' ? 'player' : 'search');
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
    return true;
  }

  function seekRelative(offset: number) {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return false;
    const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    if (!Number.isFinite(max) || max <= 0) return false;
    return seek(audio.currentTime + offset);
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""]'));
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

  function renderTrackRow(track: MusicTrack) {
    const active = currentTrack?.id === track.id;
    return (
      <button key={track.id} type="button" className={`music-track-row has-cover${active ? ' is-active' : ''}`} onClick={() => void play(track)} disabled={loadingTrackId === track.id}>
        <span className="music-track-play" aria-hidden="true">{loadingTrackId === track.id ? '…' : active && isPlaying ? <PlayingWave /> : <Play size={14} fill="currentColor" />}</span>
        {track.coverUrl
          ? <img className="music-track-cover" src={track.coverUrl} alt="" />
          : <span className="music-track-cover music-track-cover-placeholder" aria-hidden="true"><AudioLines size={16} /></span>}
        <span className="music-track-copy"><strong>{track.title}</strong><small>{track.artists}{track.album ? ` · ${track.album}` : ''}</small></span>
        <time>{formatDuration(track.durationMs)}</time>
      </button>
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
        <button type="button" className={view === 'discover' ? 'is-active' : ''} onClick={() => setView('discover')}>发现</button>
        <button type="button" className={view === 'library' ? 'is-active' : ''} onClick={() => setView('library')}>我的音乐</button>
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
    const featuredCoverUrl = currentTrack?.coverUrl || featuredPlaylist?.coverUrl?.replace(/^http:/, 'https:') || '';
    const featuredTitle = currentTrack?.title || featuredPlaylist?.name || '开始一段音乐';
    const featuredMeta = currentTrack?.artists || (featuredPlaylist ? `${featuredPlaylist.trackCount} 首歌曲` : '搜索一首歌开始试听');
    const featuredKicker = currentTrack ? (isPlaying ? '正在播放' : '已暂停') : '继续听';
    const featuredActionLabel = currentTrack ? '打开播放器' : featuredPlaylist ? '打开歌单' : '开始搜索';
    const quickPlaylists = library.playlists
      .filter((playlist) => playlist.id !== featuredPlaylist?.id)
      .slice(0, featuredPlaylist ? 4 : 6);

    function openFeatured() {
      if (currentTrack) {
        setView('player');
      } else if (featuredPlaylist) {
        void loadPlaylist(featuredPlaylist.id);
      } else {
        setSearchOpen(true);
      }
    }

    return (
      <div className="music-discover-view">
        {!serviceReady && <div className="music-service-alert" role="alert"><span>{libraryError || '音乐服务尚未就绪，请稍后重试。'}</span><button type="button" className="text-btn" onClick={onOpenSettings}>检查服务</button></div>}
        <section className="music-discover-heading">
          <h1>{greeting}</h1>
        </section>

        {(featuredPlaylist || currentTrack) && (
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
        )}

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
          <header className="music-shelf-heading music-mood-heading"><h2 id="music-mood-title">换个心情</h2><button type="button" className="music-section-link" onClick={() => void search(hotTerms[0] || FALLBACK_HOT_TERMS[0])} disabled={loading}>随便听听 <ChevronRight size={15} aria-hidden="true" /></button></header>
          <div className="music-feature-grid music-discover-feature-grid">
            {FEATURED_MOODS.map((mood, index) => {
              const term = hotTerms[index] || FALLBACK_HOT_TERMS[index];
              return (
                <button key={mood.title} type="button" className={`music-feature-card music-feature-card-${mood.visual}`} onClick={() => void search(term)} disabled={loading}>
                  <span className="music-feature-art" aria-hidden="true"><span /><i /><b /><strong className="music-feature-action"><Play size={13} fill="currentColor" /></strong></span>
                  <span className="music-feature-copy"><strong>{mood.title}</strong></span>
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
          <div><button type="button" className="music-back-link" onClick={() => setView('discover')}><ChevronLeft size={15} />返回发现</button><h1>{query ? `关于“${query}”` : '搜索结果'}</h1></div>
          {results.length > 0 && <span className="music-subpage-count">{results.length} 首</span>}
        </header>
        {error && <div className="music-service-alert is-error" role="alert"><span>{error}</span><button type="button" className="text-btn" onClick={onOpenSettings}>检查服务</button></div>}
        {loading && <div className="music-results-panel music-results-loading" aria-label="正在搜索">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="music-skeleton-row"><span /><i /><b /><em /></div>)}</div>}
        {!loading && results.length === 0 && <div className="music-results-panel music-results-empty-state"><span className="music-empty-disc" aria-hidden="true"><AudioLines size={24} /></span><strong>还没有搜索结果</strong><span>换个关键词试试，或回到发现页听一张精选唱片。</span><button type="button" className="text-btn" onClick={() => setView('discover')}>返回发现</button></div>}
        {!loading && results.length > 0 && <section className="music-results-panel music-search-results-list" aria-live="polite">{results.map(renderTrackRow)}</section>}
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
        <header className="music-subpage-heading music-library-heading">
          <div><h1>我的音乐</h1></div>
          <ListMusic size={20} aria-hidden="true" />
        </header>
        {libraryError && <div className="music-service-alert is-error" role="alert"><span>{libraryError}</span>{!serviceReady && <button type="button" className="text-btn" onClick={onOpenSettings}>检查服务</button>}</div>}
        {library.account ? (
          <div className="music-library-layout">
            <aside className="music-library-playlists" aria-label="我的歌单">
              {renderAccountPanel()}
              {library.playlists.length ? library.playlists.map((playlist) => (
                <button key={playlist.id} type="button" className={`music-library-playlist${activePlaylistId === playlist.id ? ' is-active' : ''}`} onClick={() => void loadPlaylist(playlist.id)} disabled={playlistLoadingId === playlist.id}>
                  {playlist.coverUrl ? <img src={playlist.coverUrl} alt="" /> : <span className="music-playlist-cover"><ListMusic size={15} /></span>}
                  <span><strong>{playlist.name}</strong><small>{playlist.trackCount} 首{playlist.isMine ? ' · 我的' : ''}</small></span>
                  {playlistLoadingId === playlist.id ? <RefreshCw size={14} className="is-spinning" aria-label="同步中" /> : <ChevronRight size={14} aria-hidden="true" />}
                </button>
              )) : <p className="music-library-column-empty">还没有歌单。</p>}
            </aside>
            <section className="music-library-tracks" aria-live="polite">
              <div className="music-library-column-heading"><strong>{selectedPlaylist?.name || '选择一个歌单'}</strong>{results.length > 0 && <small>{results.length} 首</small>}</div>
              {!activePlaylistId && <div className="music-library-empty"><AudioLines size={23} /><strong>选择左侧歌单</strong><span>歌曲列表会在这里显示。</span></div>}
              {activePlaylistId && playlistLoadingId === activePlaylistId && <div className="music-results-loading">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="music-skeleton-row"><span /><i /><b /><em /></div>)}</div>}
              {activePlaylistId && playlistLoadingId !== activePlaylistId && !results.length && <div className="music-library-empty"><AudioLines size={23} /><strong>这个歌单还没有歌曲</strong><span>可以点击上方“同步歌单”重新拉取。</span></div>}
              {activePlaylistId && playlistLoadingId !== activePlaylistId && results.length > 0 && <div className="music-library-track-list">{results.map(renderTrackRow)}</div>}
            </section>
          </div>
        ) : (
          <div className="music-library-login-empty"><span className="music-empty-disc" aria-hidden="true"><LogIn size={26} /></span><div><strong>登录后管理你的音乐</strong><button type="button" className="text-btn" onClick={() => void startAccountLogin()}>扫码登录网易云音乐</button></div></div>
        )}
      </div>
    );
  }

  function renderNowPlaying() {
    return (
      <div className="music-now-page" aria-label="正在播放">
        <header className="music-now-page-header">
          <button type="button" className="music-now-page-back" onClick={() => setView('discover')}><ChevronLeft size={17} />返回发现</button>
          <span>正在播放</span>
          <small>{results.length ? `队列 ${results.length}` : '队列'}</small>
        </header>
        {currentTrack ? (
          <div className="music-now-page-layout">
            <section className="music-now-page-focus">
              <div className={`music-now-page-art${isPlaying ? ' is-playing' : ''}`}>
                <span className="music-stage-vinyl" aria-hidden="true" />
                {currentTrack.coverUrl
                  ? <img className="music-stage-art" src={currentTrack.coverUrl} alt="" />
                  : <span className="music-stage-art music-stage-placeholder" aria-hidden="true"><AudioLines size={48} /></span>}
              </div>
              <span className="music-now-page-status">{isPlaying ? <PlayingWave /> : <AudioLines size={15} />}{isPlaying ? '正在播放' : '已暂停'}</span>
              <h2>{currentTrack.title}</h2>
              <p>{currentTrack.artists}{currentTrack.album ? ` · ${currentTrack.album}` : ''}</p>
              <div className="music-now-page-controls">
                <button type="button" className="music-now-page-step" onClick={() => playRelative(-1)} disabled={!results.length} aria-label="上一首"><SkipBack size={18} fill="currentColor" /></button>
                <button type="button" className="music-now-page-toggle" onClick={togglePlayback} aria-label={isPlaying ? '暂停播放' : '播放'}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
                <button type="button" className="music-now-page-step" onClick={() => playRelative(1)} disabled={!results.length} aria-label="下一首"><SkipForward size={18} fill="currentColor" /></button>
              </div>
              <div className="music-now-page-progress"><time>{formatSeconds(currentTime)}</time><input type="range" min="0" max={Number.isFinite(duration) && duration > 0 ? duration : 0} value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} disabled={!duration} aria-label="播放进度" /><time>{formatSeconds(duration)}</time></div>
            </section>
            <aside className="music-now-page-queue" aria-label="播放队列">
              <div className="music-now-page-queue-head"><span>接下来播放</span><small>{results.length} 首</small></div>
              {results.length ? <div className="music-now-page-queue-list">{results.map(renderTrackRow)}</div> : <p>搜索或打开歌单后，队列会显示在这里。</p>}
            </aside>
          </div>
        ) : (
          <div className="music-now-page-empty"><span className="music-empty-disc" aria-hidden="true"><AudioLines size={28} /></span><strong>还没有正在播放的歌曲</strong><span>从发现页或我的音乐选择一首歌。</span><button type="button" className="text-btn" onClick={() => setView('discover')}>返回发现</button></div>
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

  return (
    <section className="module-page music-page" style={{ '--music-theme-hue': String(themeHue) } as CSSProperties}>
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => playRelative(1)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onError={() => setError('音频加载失败，这首歌可能受版权或服务限制。')}
      />
      <div className="music-shell">
        {renderTopBar()}
        <main className="music-view">
          {view === 'discover' && renderDiscover()}
          {view === 'search' && renderSearchResults()}
          {view === 'library' && renderLibrary()}
          {view === 'player' && renderNowPlaying()}
        </main>
      </div>
      {renderLoginModal()}
      <footer className="music-player" aria-label="播放器">
        <button type="button" className="music-player-track" onClick={() => setView('player')} aria-label={currentTrack ? '点击封面打开正在播放页面' : '打开播放页面'} title={currentTrack ? '点击封面打开正在播放页面' : '打开播放页面'}>
          {currentTrack?.coverUrl ? <img src={currentTrack.coverUrl} alt="" /> : <span className="music-player-cover"><AudioLines size={18} /></span>}
          <div><strong>{currentTrack?.title || '尚未选择歌曲'}</strong>{currentTrack && <small>{currentTrack.artists}</small>}</div>
        </button>
        <div className="music-player-center">
          <div className="music-player-controls">
            <button type="button" className="music-player-step" onClick={() => playRelative(-1)} disabled={!results.length} aria-label="上一首"><SkipBack size={16} fill="currentColor" /></button>
            <button type="button" className="music-player-toggle" onClick={togglePlayback} disabled={!currentTrack} aria-label={isPlaying ? '暂停播放' : '播放'}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button type="button" className="music-player-step" onClick={() => playRelative(1)} disabled={!results.length} aria-label="下一首"><SkipForward size={16} fill="currentColor" /></button>
          </div>
          <div className="music-progress"><time>{formatSeconds(currentTime)}</time><input type="range" min="0" max={Number.isFinite(duration) && duration > 0 ? duration : 0} value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} disabled={!currentTrack || !duration} aria-label="播放进度" /><time>{formatSeconds(duration)}</time></div>
        </div>
        <div className="music-player-meta">
          <button type="button" className="music-player-queue-link" onClick={() => setView('player')}><ListMusic size={16} />{results.length ? `队列 ${results.length}` : '队列'}</button>
        </div>
      </footer>
    </section>
  );
}
