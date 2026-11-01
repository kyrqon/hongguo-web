import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent, TouchEvent } from 'react'
import { ArrowRight, Bookmark, Check, ChevronLeft, ChevronRight, ChevronsUpDown, Compass, Film, Flame, Heart, History, Home, ListVideo, LoaderCircle, Lock, LogIn, LogOut, Play, Search, Settings2, Share2, X } from 'lucide-react'

import { api, ApiError } from './api'
import DramaPlayer from './components/DramaPlayer'
import ServerSettings from './components/ServerSettings'
import { getApiBase, isNativeApp } from './apiConfig'
import { demoEpisodes, demos, demoVideo } from './demo'
import { playbackUrl, readPlaybackRoute } from './playbackRoute'
import type { PlaybackRoute } from './playbackRoute'
import type { Drama, Episode, HistoryItem, PlaybackQuality, PlaybackResult, Section, User } from './types'

const categories = ['全部', '都市爱情', '甜宠', '古装', '逆袭', '悬疑', '家庭', '大女主']
const navItems = [
  { id: 'recommend', title: '为你推荐', icon: Home },
  { id: 'discover', title: '发现好剧', icon: Compass },
  { id: 'favorites', title: '我的收藏', icon: Bookmark },
  { id: 'history', title: '观看历史', icon: History },
] as const
const countLabel = (value: number) => value >= 10000 ? `${(value / 10000).toFixed(value >= 1000000 ? 0 : 1)}万` : String(value)
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'
type EpisodePageState = { dramaId: string; items: Episode[]; cursor: string; hasMore: boolean; request: Promise<void> | null }
type EpisodeAdvance = { page: EpisodePageState; afterId: string; continueFeed: boolean }

export default function App() {
  if (isNativeApp() && !getApiBase()) return <main className="native-server-setup"><section className="native-server-card"><ServerSettings initialSetup /></section></main>
  return <PlayerApp />
}

function PlayerApp() {
  const initialRoute = useRef(readPlaybackRoute(window.location.href))
  const pendingRoute = useRef<(PlaybackRoute & { autoplay: boolean }) | null>(initialRoute.current.dramaId ? { ...initialRoute.current, autoplay: false } : null)
  const [routeRevision, setRouteRevision] = useState(0)
  const [routeSettled, setRouteSettled] = useState(!pendingRoute.current)
  const routeWriteMode = useRef<'pushState' | 'replaceState'>('replaceState')
  const catalogPending = useRef(true)
  const [section, setSection] = useState<Section>('recommend')
  const [category, setCategory] = useState('全部')
  const [source, setSource] = useState<'hongguo' | 'demo'>(initialRoute.current.source)
  const [sourceMessage, setSourceMessage] = useState('')
  const [dramas, setDramas] = useState<Drama[]>([])
  const [active, setActive] = useState(0)
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [catalogMode, setCatalogMode] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [favorites, setFavorites] = useState<Drama[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [authOpen, setAuthOpen] = useState(false)
  const [episodesOpen, setEpisodesOpen] = useState(false)
  const [episodeDescending, setEpisodeDescending] = useState(false)
  const [episodeHasMore, setEpisodeHasMore] = useState(false)
  const [episodePageLoading, setEpisodePageLoading] = useState(false)
  const [episodePageError, setEpisodePageError] = useState('')
  const [episodeAdvance, setEpisodeAdvance] = useState<EpisodeAdvance | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [episode, setEpisode] = useState(0)
  const [episodeLoading, setEpisodeLoading] = useState(false)
  const [episodeError, setEpisodeError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoRevision, setVideoRevision] = useState(0)
  const [streamConverted, setStreamConverted] = useState(false)
  const [timeOffset, setTimeOffset] = useState(0)
  const [autoplayVideo, setAutoplayVideo] = useState(true)
  const [qualities, setQualities] = useState<PlaybackQuality[]>([])
  const [selectedQuality, setSelectedQuality] = useState('')
  const [qualityBusy, setQualityBusy] = useState(false)
  const [playError, setPlayError] = useState('')
  const [playErrorCode, setPlayErrorCode] = useState('')
  const [videoLoading, setVideoLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [durationHint, setDurationHint] = useState(0)
  const [liked, setLiked] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authBusy, setAuthBusy] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [theaterMode, setTheaterMode] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)
  const playRequestId = useRef(0)
  const playbackAbort = useRef<AbortController | null>(null)
  const gestureTime = useRef(0)
  const touchStart = useRef({ x: 0, y: 0 })
  const resumePosition = useRef(0)
  const qualityPreference = useRef('')
  const autoPlayNext = useRef(false)
  const episodesFor = useRef('')
  const episodePage = useRef<EpisodePageState>({ dramaId: '', items: [], cursor: '', hasMore: false, request: null })
  const watchState = useRef({ user, drama: undefined as Drama | undefined, episodes, episode })
  const drama = dramas[active]
  const isFavorite = !!drama && favorites.some(item => item.id === drama.id)
  const isLiked = !!drama && liked.includes(drama.id)
  const retrySeconds = Math.max(0, Math.ceil((retryAt - clock) / 1000))
  watchState.current = { user, drama, episodes, episode }
  const catalogState = useRef({ dramas, cursor, hasMore, catalogMode })
  catalogState.current = { dramas, cursor, hasMore, catalogMode }
  const clearRouteTarget = useCallback(() => {
    pendingRoute.current = null
    routeWriteMode.current = 'pushState'
    setRouteSettled(true)
  }, [])

  const handleVideoReady = useCallback((video: HTMLVideoElement | null) => { videoRef.current = video }, [])
  const restorePosition = useCallback((video: HTMLVideoElement) => {
    const position = resumePosition.current
    if (!position) return
    if (streamConverted && (!video.buffered.length || video.buffered.end(video.buffered.length - 1) < position)) return
    if (!streamConverted && !Number.isFinite(video.duration)) return
    video.currentTime = Math.min(position, video.duration || position)
    resumePosition.current = 0
  }, [streamConverted])

  const notify = useCallback((message: string) => setToast(message), [])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer) } }, [toast])

  useEffect(() => {
    if (!retryAt) return
    const timer = window.setInterval(() => { const now = Date.now(); setClock(now); if (now >= retryAt) setRetryAt(0) }, 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])

  const refreshLibrary = useCallback(async () => {
    const [saved, watched] = await Promise.all([api.favorites(), api.history()])
    setFavorites(saved.items)
    setHistory(watched.items)
  }, [])
  useEffect(() => {
    let cancelled = false
    api.me().then(result => {
      if (cancelled) return
      setUser(result.user)
      if (result.user) refreshLibrary().catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [refreshLibrary])

  const loadDramas = useCallback(async () => {
    const id = ++requestId.current
    catalogPending.current = true
    setLoading(true); setListError(''); setRetryAt(0); setCatalogMode(''); setActive(0); setHasMore(false); setCursor('')
    const target = pendingRoute.current
    if (target?.dramaId && target.source === source) {
      try {
        const previous = catalogState.current
        const found = previous.dramas.findIndex(item => item.id === target.dramaId && item.source === source)
        if (found >= 0) {
          setActive(found); setCursor(previous.cursor); setHasMore(previous.hasMore); setCatalogMode(previous.catalogMode)
        } else {
          const selected = source === 'demo' ? demos.find(item => item.id === target.dramaId) : (await api.drama(target.dramaId)).drama
          if (!selected) throw new Error('链接中的短剧不存在')
          if (id !== requestId.current) return
          if (source === 'demo') { setDramas(demos); setActive(demos.findIndex(item => item.id === selected.id)) }
          else { setDramas([selected]); setHasMore(true) }
          setCatalogMode('direct')
        }
      } catch (error) { if (id === requestId.current) { setDramas([]); setListError(messageOf(error)) } }
      finally { if (id === requestId.current) { catalogPending.current = false; setLoading(false) } }
      return
    }
    if (section === 'favorites' || section === 'history') {
      setDramas(section === 'favorites' ? favorites : history.map(item => item.drama))
      catalogPending.current = false; setLoading(false)
      return
    }
    if (source === 'demo') {
      const filtered = demos.filter(item => (!search || `${item.title}${item.tags.join('')}${item.description}`.includes(search)) && (category === '全部' || item.tags.includes(category)))
      setDramas(filtered); catalogPending.current = false; setLoading(false); return
    }
    try {
      const page = search ? await api.search(search) : await api.feed(category === '全部' ? '推荐' : category)
      if (id !== requestId.current) return
      setDramas(page.items); setCursor(page.cursor || ''); setHasMore(page.hasMore); setCatalogMode(page.catalogMode || '')
    } catch (error) {
      if (id !== requestId.current) return
      setDramas([]); setListError(messageOf(error))
      if (error instanceof ApiError && error.retryAfterMs > 0) { setClock(Date.now()); setRetryAt(Date.now() + error.retryAfterMs) }
    } finally { if (id === requestId.current) { catalogPending.current = false; setLoading(false) } }
  }, [source, search, category, section, routeRevision, section === 'favorites' ? favorites : null, section === 'history' ? history : null])
  useEffect(() => { void loadDramas() }, [loadDramas])
  useEffect(() => () => playbackAbort.current?.abort(), [])

  useEffect(() => {
    let cancelled = false
    const page: EpisodePageState = { dramaId: drama?.id || '', items: [], cursor: '', hasMore: false, request: null }
    episodePage.current = page
    ++playRequestId.current
    playbackAbort.current?.abort(); playbackAbort.current = null
    setVideoUrl(''); setPlayError(''); setPlayErrorCode(''); setStarted(false); setPlaying(false); setVideoLoading(false); setDurationHint(0)
    setQualities([]); setSelectedQuality(''); setQualityBusy(false); setTimeOffset(0); setAutoplayVideo(true)
    setEpisodes([]); setEpisode(0); setEpisodeError(''); setEpisodeHasMore(false); setEpisodePageLoading(false); setEpisodePageError(''); setEpisodeAdvance(null); resumePosition.current = 0
    episodesFor.current = ''
    if (!drama) return
    const applyEpisodes = (items: Episode[]) => {
      page.items = items
      episodesFor.current = drama.id
      setEpisodes(items)
      const watched = history.find(item => item.drama.id === drama.id)
      if (watched && !pendingRoute.current?.episodeId) {
        const index = items.findIndex(item => item.id === watched.episodeId)
        if (index >= 0) { setEpisode(index); resumePosition.current = watched.position }
      }
    }
    if (drama.source === 'demo') { applyEpisodes(demoEpisodes(drama)); setEpisodeLoading(false); return }
    setEpisodeLoading(true)
    api.drama(drama.id).then(result => {
      if (!cancelled) {
        applyEpisodes(result.episodes)
        page.hasMore = !!result.episodesHasMore; page.cursor = result.episodesCursor || ''
        setEpisodeHasMore(page.hasMore)
        setDramas(previous => previous.map(item => item.id === result.drama.id ? { ...item, ...result.drama, episodeCount: result.drama.episodeCount || result.episodes.length } : item))
      }
    }).catch(error => { if (!cancelled) setEpisodeError(messageOf(error)) })
      .finally(() => { if (!cancelled) setEpisodeLoading(false) })
    return () => { cancelled = true }
  }, [drama?.id, drama?.source])

  const saveProgress = useCallback(() => {
    const state = watchState.current
    const position = videoRef.current?.currentTime || 0
    if (state.user && state.drama && state.episodes[state.episode] && position > 0) {
      void api.saveHistory({ drama: state.drama, episodeId: state.episodes[state.episode].id, episodeIndex: state.episodes[state.episode].index, position }).catch(() => {})
    }
  }, [])
  useEffect(() => {
    const restore = () => {
      const target = readPlaybackRoute(window.location.href)
      const autoplay = started
      saveProgress(); ++playRequestId.current; playbackAbort.current?.abort(); videoRef.current?.pause()
      autoPlayNext.current = false
      pendingRoute.current = target.dramaId ? { ...target, autoplay } : null
      routeWriteMode.current = 'replaceState'
      catalogPending.current = true
      setRouteSettled(!target.dramaId); setSource(target.source); setSection('recommend'); setCategory('全部'); setSearch(''); setQuery(''); setVideoUrl(''); setStarted(false); setPlaying(false)
      setPlayError(''); setPlayErrorCode(''); setEpisodeAdvance(null)
      setRouteRevision(previous => previous + 1)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [saveProgress, started])
  useEffect(() => {
    const interval = setInterval(saveProgress, 10000)
    const visibility = () => { if (document.hidden) saveProgress() }
    document.addEventListener('visibilitychange', visibility)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visibility) }
  }, [saveProgress])

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => notify('暂时无法退出全屏，请按 Esc'))
    else if (playerRef.current?.requestFullscreen) void playerRef.current.requestFullscreen().catch(() => { setTheaterMode(true); notify('已进入网页全屏，可按 Esc 退出') })
    else { setTheaterMode(true); notify('已进入网页全屏，可按 Esc 退出') }
  }, [notify])

  const loadVideo = useCallback(async (index: number, resume?: number, quality?: string, autoplay = true) => {
    if (!drama || !episodes[index] || episodesFor.current !== drama.id) return
    if (pendingRoute.current) clearRouteTarget()
    setEpisodeAdvance(null)
    if (episodes[index].playable === false) {
      ++playRequestId.current; playbackAbort.current?.abort(); videoRef.current?.pause()
      setEpisode(index); setVideoUrl(''); setVideoLoading(false); setQualityBusy(false)
      setPlayError('当前片源暂不允许播放这一集，请查看官方客户端中的可用状态。'); setPlayErrorCode('PLAYBACK_UNAVAILABLE'); return
    }
    const id = ++playRequestId.current
    playbackAbort.current?.abort()
    const controller = new AbortController()
    playbackAbort.current = controller
    saveProgress()
    videoRef.current?.pause()
    setEpisode(index); setPlayError(''); setPlayErrorCode(''); setVideoLoading(true); setStarted(true); setVideoUrl(''); setQualityBusy(!!quality); setAutoplayVideo(autoplay)
    if (index !== episode) { setQualities([]); setSelectedQuality('') }
    resumePosition.current = resume ?? (index === episode ? resumePosition.current : 0)
    try {
      let result: PlaybackResult = drama.source === 'demo'
        ? { url: demoVideo, duration: 0, converted: false, qualities: [{ id: 'demo', label: '示例' }], selectedQuality: 'demo' }
        : await api.play(episodes[index].id, controller.signal, quality, resumePosition.current)
      if (!quality && drama.source !== 'demo' && id === playRequestId.current && qualityPreference.current && result.selectedQuality !== qualityPreference.current && result.qualities?.some(item => item.id === qualityPreference.current)) {
        result = await api.play(episodes[index].id, controller.signal, qualityPreference.current, resumePosition.current)
      }
      if (id === playRequestId.current) {
        setVideoUrl(result.url); setVideoRevision(previous => previous + 1); setDurationHint(result.duration || 0); setStreamConverted(!!result.converted)
        setTimeOffset(result.timeOffset || 0)
        setQualities(result.qualities || []); setSelectedQuality(result.selectedQuality || '')
      }
    } catch (error) { if (id === playRequestId.current) { setPlayError(messageOf(error)); setPlayErrorCode(error instanceof ApiError ? error.code || '' : ''); setVideoLoading(false) } }
    finally { if (id === playRequestId.current) setQualityBusy(false) }
  }, [drama, episodes, episode, saveProgress, clearRouteTarget])

  const changeQuality = (id: string) => {
    if (qualityBusy || (videoLoading && !videoUrl) || id === selectedQuality || !qualities.some(item => item.id === id)) return
    qualityPreference.current = id
    void loadVideo(episode, videoRef.current?.currentTime || 0, id, videoRef.current ? !videoRef.current.paused : true)
  }

  useEffect(() => {
    if (autoPlayNext.current && routeSettled && !pendingRoute.current && episodes.length && episodesFor.current === drama?.id) {
      autoPlayNext.current = false
      void loadVideo(episode)
    }
  }, [drama?.id, episodes, episode, loadVideo, routeSettled])


  const togglePlay = useCallback(() => {
    if (!drama) return
    if (!started || playError) { void loadVideo(episode); return }
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => setPlayError('播放未能开始，请重试'))
    else video.pause()
  }, [drama, episode, started, playError, loadVideo])

  const loadMoreEpisodes = useCallback((): Promise<void> => {
    const current = episodePage.current
    if (!current.dramaId || watchState.current.drama?.id !== current.dramaId || !current.hasMore) return Promise.resolve()
    if (current.request) return current.request
    const isCurrent = () => episodePage.current === current && watchState.current.drama?.id === current.dramaId
    setEpisodePageLoading(true); setEpisodePageError('')
    current.request = (async () => {
      try {
        const page = await api.episodes(current.dramaId, current.cursor)
        if (!isCurrent()) return
        const known = new Set(current.items.map(item => item.id))
        const additions = page.items.filter(item => { if (known.has(item.id)) return false; known.add(item.id); return true })
        current.items = [...current.items, ...additions]
        current.hasMore = page.hasMore; current.cursor = page.cursor || ''
        setEpisodes(current.items); setEpisodeHasMore(current.hasMore)
        if (!additions.length && current.hasMore) setEpisodePageError('暂未返回新的分集，请重试加载后续集数')
      } catch (error) { if (isCurrent()) setEpisodePageError(messageOf(error)) }
      finally { current.request = null; if (isCurrent()) setEpisodePageLoading(false) }
    })()
    return current.request
  }, [])

  const retryEpisodePage = () => {
    if (episodeAdvance) { setPlayError(''); setPlayErrorCode(''); setVideoLoading(true) }
    void loadMoreEpisodes()
  }

  const retryEpisodes = async () => {
    const current = episodePage.current
    if (!drama || current.dramaId !== drama.id) return
    setEpisodeLoading(true)
    try {
      const result = await api.drama(current.dramaId)
      if (episodePage.current !== current || watchState.current.drama?.id !== current.dramaId) return
      current.items = result.episodes; current.hasMore = !!result.episodesHasMore; current.cursor = result.episodesCursor || ''
      episodesFor.current = current.dramaId
      setEpisodes(current.items); setEpisodeHasMore(current.hasMore); setEpisodeError('')
    } catch (error) { if (episodePage.current === current) setEpisodeError(messageOf(error)) }
    finally { if (episodePage.current === current) setEpisodeLoading(false) }
  }

  useEffect(() => {
    const target = pendingRoute.current
    if (!target || catalogPending.current || loading || episodeLoading || episodeError || !drama || drama.id !== target.dramaId || drama.source !== target.source || episodesFor.current !== drama.id || episodes !== episodePage.current.items) return
    const index = target.episodeId ? episodes.findIndex(item => item.id === target.episodeId) : episode
    if (index < 0 && episodePage.current.hasMore) {
      if (!episodePageLoading && !episodePageError) void loadMoreEpisodes()
      return
    }
    pendingRoute.current = null
    if (index >= 0) {
      setEpisode(index)
      if (target.episodeId) resumePosition.current = 0
      autoPlayNext.current = target.autoplay
    } else { setEpisode(0); notify('链接中的分集不存在，已显示第一集') }
    setRouteSettled(true)
  }, [routeRevision, loading, episodeLoading, episodeError, drama, episodes, episode, episodePageLoading, episodePageError, loadMoreEpisodes, notify])

  useEffect(() => {
    if (!routeSettled || pendingRoute.current || catalogPending.current || loading || episodeLoading) return
    if (drama && drama.source !== source && section !== 'favorites' && section !== 'history') return
    if (drama && (episodesFor.current !== drama.id || episodes !== episodePage.current.items || !episodes[episode])) return
    const url = playbackUrl(window.location.href, { source: drama?.source || source, dramaId: drama?.id || '', episodeId: episodes[episode]?.id || '' })
    if (url.href !== window.location.href) window.history[routeWriteMode.current](window.history.state, '', url)
    routeWriteMode.current = 'pushState'
  }, [routeSettled, source, section, loading, episodeLoading, drama, episodes, episode])

  const nextDrama = useCallback(async (direction: number) => {
    if (loading || pageLoading || !dramas.length) return
    saveProgress()
    const next = active + direction
    if (next < 0) { notify('已经是第一部了'); return }
    if (next < dramas.length) { clearRouteTarget(); autoPlayNext.current = started; setActive(next); return }
    if (!hasMore) { notify('已经看到最后一部，去发现更多好剧吧'); return }
    clearRouteTarget()
    const id = requestId.current
    setPageLoading(true)
    try {
      const page = search ? await api.search(search, cursor) : await api.feed(category, cursor)
      if (id !== requestId.current) return
      setDramas(previous => [...previous, ...page.items.filter(item => !previous.some(existing => existing.id === item.id))])
      setCursor(page.cursor || ''); setHasMore(page.hasMore)
      if (page.items.some(item => !dramas.some(existing => existing.id === item.id))) { autoPlayNext.current = started; setActive(next) }
      else notify('暂时没有更多新剧了')
    } catch (error) { if (id === requestId.current) notify(messageOf(error)) }
    finally { setPageLoading(false) }
  }, [active, category, cursor, dramas, hasMore, loading, notify, pageLoading, saveProgress, search, started, clearRouteTarget])

  const handleEpisodeEnded = (continueFeed = true) => {
    if (!continueFeed) videoRef.current?.pause()
    saveProgress()
    const current = episodePage.current
    const ended = episodes[episode]
    if (!ended || current.dramaId !== drama?.id || episodesFor.current !== current.dramaId) return
    setEpisodePageError(''); setPlayError(''); setPlayErrorCode(''); setVideoLoading(true)
    setEpisodeAdvance({ page: current, afterId: ended.id, continueFeed })
  }

  useEffect(() => {
    if (!episodeAdvance) return
    const current = episodeAdvance.page
    if (episodePage.current !== current || current.dramaId !== drama?.id) { setEpisodeAdvance(null); return }
    const index = episodes.findIndex(item => item.id === episodeAdvance.afterId)
    if (index >= 0 && index + 1 < episodes.length) { void loadVideo(index + 1); return }
    if (episodePageError) {
      setPlayError(`后续分集加载失败：${episodePageError}`); setPlayErrorCode('EPISODE_PAGE_ERROR'); setVideoLoading(false)
      return
    }
    if (episodePageLoading) return
    if (current.hasMore) { void loadMoreEpisodes(); return }
    setEpisodeAdvance(null); setVideoLoading(false)
    if (episodeAdvance.continueFeed) void nextDrama(1)
    else notify('已经是最后一集了')
  }, [drama?.id, episodeAdvance, episodes, episodePageError, episodePageLoading, loadMoreEpisodes, loadVideo, nextDrama, notify])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (authOpen || infoOpen || serverSettingsOpen || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.target instanceof Element && event.target.closest('.episode-drawer, .dplayer-controller, .dplayer-setting, .dplayer-menu')) return
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); togglePlay() }
      if (event.key === 'ArrowDown') { event.preventDefault(); void nextDrama(1) }
      if (event.key === 'ArrowUp') { event.preventDefault(); void nextDrama(-1) }
      if (event.key === 'ArrowRight' && videoRef.current) {
        const video = videoRef.current
        const maximum = streamConverted ? (video.buffered.length ? video.buffered.end(video.buffered.length - 1) : video.currentTime) : (Number.isFinite(video.duration) ? video.duration : video.currentTime)
        video.currentTime = Math.min(maximum, video.currentTime + 5)
      }
      if (event.key === 'ArrowLeft' && videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [authOpen, infoOpen, serverSettingsOpen, nextDrama, togglePlay, streamConverted])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (serverSettingsOpen) setServerSettingsOpen(false)
      else if (authOpen) setAuthOpen(false)
      else if (episodesOpen) setEpisodesOpen(false)
      else if (infoOpen) setInfoOpen(false)
      else setTheaterMode(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [authOpen, episodesOpen, infoOpen, serverSettingsOpen])

  const changeSource = (next: 'hongguo' | 'demo') => {
    clearRouteTarget(); autoPlayNext.current = false
    setSource(next); setSourceMessage(''); setSection('recommend'); setCategory('全部'); setSearch(''); setQuery('')
  }
  const navigate = (next: Section) => {
    clearRouteTarget()
    const reloadCurrent = section === next && !search && category === '全部'
    autoPlayNext.current = false
    saveProgress(); setSection(next); setSearch(''); setQuery(''); setCategory('全部')
    if (reloadCurrent) void loadDramas()
    if (user && (next === 'history' || next === 'favorites')) refreshLibrary().catch(error => notify(messageOf(error)))
  }
  const toggleFavorite = async () => {
    if (!user) { setAuthOpen(true); return }
    if (!drama || favoriteBusy) return
    setFavoriteBusy(true)
    try {
      if (isFavorite) { await api.unfavorite(drama.id); setFavorites(previous => previous.filter(item => item.id !== drama.id)); notify('已取消收藏') }
      else { await api.favorite(drama); setFavorites(previous => [drama, ...previous]); notify('已加入我的收藏') }
    } catch (error) { notify(messageOf(error)) }
    finally { setFavoriteBusy(false) }
  }
  const performSearch = (event: FormEvent) => { event.preventDefault(); if (query.trim()) { clearRouteTarget(); setSection('discover'); setCategory('全部'); setSearch(query.trim()) } }
  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setAuthBusy(true); setAuthError('')
    const data = new FormData(event.currentTarget)
    try {
      const result = await api.auth(authMode, String(data.get('username')).trim(), String(data.get('password')))
      setUser(result.user); setAuthOpen(false); await refreshLibrary(); notify(authMode === 'login' ? '已登录本站账号' : '本站账号已创建')
    } catch (error) { setAuthError(messageOf(error)) }
    finally { setAuthBusy(false) }
  }
  const logout = async () => {
    try { saveProgress(); await api.logout(); setUser(null); setFavorites([]); setHistory([]); navigate('recommend'); notify('已退出本站账号') }
    catch (error) { notify(messageOf(error)) }
  }
  const share = async () => {
    if (!drama) return
    const url = playbackUrl(window.location.href, { source: drama.source, dramaId: drama.id, episodeId: episodesFor.current === drama.id ? episodes[episode]?.id || '' : '' })
    try { await navigator.clipboard.writeText(url.toString()); notify('链接已复制') }
    catch { notify('无法访问剪贴板，请复制浏览器地址分享') }
  }
  const openServerSettings = () => {
    saveProgress(); videoRef.current?.pause(); setInfoOpen(false); setServerSettingsOpen(true)
  }

  const onTouchEnd = (event: TouchEvent) => {
    if (authOpen || infoOpen || serverSettingsOpen) return
    if (event.target instanceof Element && event.target.closest('.episode-drawer, .dplayer-controller, .dplayer-setting, .dplayer-menu')) return
    const touch = event.changedTouches[0]
    const dy = touchStart.current.y - touch.clientY
    const dx = touchStart.current.x - touch.clientX
    if (Math.abs(dy) > 65 && Math.abs(dy) > Math.abs(dx) * 1.4) void nextDrama(dy > 0 ? 1 : -1)
  }
  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || authOpen || infoOpen || serverSettingsOpen) return
    if (event.target instanceof Element && event.target.closest('.episode-drawer, .dplayer-controller, .dplayer-setting, .dplayer-menu, .stage-tools, .player-actions, .feed-navigation')) return
    if (Math.abs(event.deltaY) < 25 || Date.now() - gestureTime.current < 900) return
    gestureTime.current = Date.now(); void nextDrama(event.deltaY > 0 ? 1 : -1)
  }
  const emptyLibrary = !user && (section === 'favorites' || section === 'history')

  return <div className={`app-shell${theaterMode ? ' theater-mode' : ''}`}>
    <header className="topbar">
      <button className="brand" onClick={() => navigate('recommend')} aria-label="红果首页"><span className="brand-icon"><Play size={23} fill="currentColor" /></span><span>红果<span className="brand-divider" /><span className="brand-sub">短剧</span></span></button>
      <form className="search-form" onSubmit={performSearch}><Search size={19} /><input aria-label="搜索短剧" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索剧名，发现你的心动好剧" />{query && <button type="button" className="icon-button" onClick={() => { setQuery(''); if (search) { clearRouteTarget(); setSearch('') } }} aria-label="清空搜索"><X size={15} /></button>}<button className="search-submit" aria-label="提交搜索">搜索</button></form>
      <div className="header-actions"><span className={`source-dot ${source === 'demo' ? 'demo-dot' : ''}`} /><select aria-label="选择片源" value={source} onChange={event => { changeSource(event.target.value as 'hongguo' | 'demo') }}><option value="hongguo">红果片源</option><option value="demo">示例片源</option></select><button className="header-user" onClick={() => user ? navigate('favorites') : setAuthOpen(true)}><span className="avatar">{user ? user.username[0].toUpperCase() : <LogIn size={16} />}</span><span>{user?.username || '本站登录 / 注册'}</span></button></div>
      {isNativeApp() && <button className="server-settings-trigger" aria-label="服务地址" title="服务地址" onClick={openServerSettings}><Settings2 size={19} /></button>}
    </header>

    <aside className="sidebar">
      <nav>{navItems.map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={21} strokeWidth={section === item.id ? 2.3 : 1.7} /><span>{item.title}</span>{item.id === 'recommend' && <span className="nav-live" />}{item.id === 'favorites' && favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><button onClick={() => setInfoOpen(true)}><Settings2 size={17} />使用说明</button>{user && <button onClick={() => void logout()}><LogOut size={16} />退出登录</button>}<small>个人自用 · openhongguo</small></div>
    </aside>

    <main className="main-content">
      <div className="category-bar">{categories.map(item => <button key={item} className={category === item ? 'selected' : ''} onClick={() => { clearRouteTarget(); setCategory(item); setSection('discover'); setSearch(''); setQuery('') }}>{item}</button>)}{source === 'hongguo' && <span className={`catalog-status${listError ? ' has-error' : ''}`}>{listError ? '连接失败' : loading ? '正在连接片源' : catalogMode === 'ranking' ? '红果 · 真人热播榜' : catalogMode === 'discover' ? '红果 · 真人短剧' : '红果 · 真实片源'}</span>}</div>

      {source === 'demo' && <div className="source-banner"><span><span className="tiny-dot" />示例模式 · 剧名与封面为界面演示，播放使用公开测试视频</span><button title={sourceMessage || '连接真实红果短剧目录'} onClick={() => { changeSource('hongguo') }}>连接红果片源 <ArrowRight size={13} /></button></div>}

      <div className="viewing-layout">
        <section className="feed-column" aria-label="短剧播放器">
          {loading ? <div className="player-empty"><LoaderCircle className="spin" size={28} /><h2>好故事正在路上</h2><p>正在连接{source === 'hongguo' ? '红果' : '示例'}片源…</p></div> : !drama || emptyLibrary ? <div className="player-empty"><span className="empty-symbol">{emptyLibrary ? <Bookmark size={32} /> : <Search size={32} />}</span><h2>{emptyLibrary ? '让好故事有个归处' : listError ? '真实片源暂时没有回应' : '还没有找到故事'}</h2><p>{emptyLibrary ? '登录你的本站账号，收藏和进度都会为你保留。' : listError || (section === 'favorites' ? '看到喜欢的剧，点击收藏就会出现在这里。' : section === 'history' ? '开始播放一集，观看记录就会保存在这里。' : '试试其他关键词或分类吧。')}</p><button className="primary-button" disabled={!!listError && retrySeconds > 0} onClick={() => emptyLibrary ? setAuthOpen(true) : listError ? void loadDramas() : navigate('recommend')}>{emptyLibrary ? '本站登录 / 注册' : listError ? (retrySeconds > 0 ? `${retrySeconds} 秒后可重试` : '重试真实片源') : '发现更多好剧'}<ArrowRight size={16} /></button></div> : <>
            <div className={`player-stage${playing ? ' is-playing' : ''}${episodesOpen ? ' episodes-visible' : ''}`} ref={playerRef} onWheel={onWheel} onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY } }} onTouchEnd={onTouchEnd}>
              <div className="video-card">
                <img className="video-ambient" src={drama.cover} alt="" aria-hidden="true" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />
                <DramaPlayer
                  url={videoUrl} revision={videoRevision} poster={drama.cover}
                  durationHint={durationHint} converted={streamConverted}
                  timeOffset={timeOffset} autoplay={autoplayVideo}
                  qualities={qualities} selectedQuality={selectedQuality} qualityBusy={qualityBusy || (videoLoading && !videoUrl)}
                  onQualityChange={changeQuality}
                  canPreviousEpisode={episode > 0} canNextEpisode={episode + 1 < episodes.length || episodeHasMore}
                  episodeNavigationBusy={episodeLoading || episodePageLoading}
                  onPreviousEpisode={() => { if (episode > 0) void loadVideo(episode - 1) }}
                  onNextEpisode={() => { if (episode + 1 < episodes.length) void loadVideo(episode + 1); else if (episodeHasMore) handleEpisodeEnded(false) }}
                  onVideoReady={handleVideoReady} onPlaybackState={setPlaying}
                  onLoading={setVideoLoading} onError={message => { setPlayError(message); setPlayErrorCode('MEDIA_ERROR'); setVideoLoading(false) }}
                  onEnded={() => handleEpisodeEnded()}
                  onMetadata={restorePosition} onProgress={restorePosition}
                  onRequestPlay={togglePlay} controlsDisabled={episodeLoading || !episodes.length || episodes[episode]?.playable === false}
                  onToggleWebFullscreen={() => setTheaterMode(previous => !previous)}
                  onToggleFullscreen={toggleFullscreen} theaterMode={theaterMode} fullscreen={fullscreen}
                />
                <div className="video-shade" />
                {drama.source === 'demo' && <div className="demo-credit">本地生成的有声测试视频 · 不含真实剧集内容</div>}
                <div className="player-top"><span className="original-badge"><span className="brand-mini"><Play size={10} fill="currentColor" /></span> {drama.source === 'demo' ? '示例短剧' : '红果短剧'}</span><span className="episode-indicator">第 {episodes[episode]?.index || 1} 集{drama.episodeCount ? ` / 共 ${drama.episodeCount} 集` : ''}</span></div>
                {!started && !videoLoading && !playError && <button className="big-play" onClick={togglePlay} disabled={episodeLoading || !episodes.length} aria-label="播放短剧"><Play size={30} fill="currentColor" strokeWidth={1} /></button>}
                {videoLoading && !videoUrl && <div className="video-status"><LoaderCircle className="spin" size={32} /><span>正在准备播放…</span></div>}
                {(playError || episodeError) && <div className="video-error"><Film size={28} /><p>{playError || episodeError}</p>{['AUTHENTICATION_REQUIRED', 'CHALLENGE_REQUIRED', 'PLAYBACK_UNAVAILABLE', 'DRM_PROTECTED'].includes(playErrorCode) ? <a href={`https://hongguoduanju.com/player/${drama.id}/${episodes[episode]?.id || ''}`} target="_blank" rel="noreferrer">查看官方播放页</a> : <button disabled={episodePageLoading || episodeLoading} onClick={() => playErrorCode === 'EPISODE_PAGE_ERROR' ? retryEpisodePage() : episodeError ? void retryEpisodes() : void loadVideo(episode)}>{playErrorCode === 'EPISODE_PAGE_ERROR' ? '重试加载下一集' : '重试'}</button>}</div>}
                <div className="video-info"><div className="video-eyebrow"><span className="quality-tag">精选好剧</span><span><Flame size={12} /> {drama.playCount ? `${countLabel(drama.playCount)}次播放` : '正在热播'}</span></div><h2>{drama.title}</h2><p>{drama.description}</p><div className="video-tags">{drama.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}</div><button className="episode-strip" aria-expanded={episodesOpen} aria-controls="episode-drawer" onClick={() => setEpisodesOpen(previous => !previous)}><ListVideo size={16} /><span>选集</span><span className="strip-divider" /><span>全 {drama.episodeCount} 集{drama.source === 'demo' ? ' · 示例' : ''}</span><ChevronRight size={16} /></button></div>
              </div>
              <div className="player-actions"><button className={isLiked ? 'liked' : ''} onClick={() => setLiked(previous => isLiked ? previous.filter(id => id !== drama.id) : [...previous, drama.id])}><span><Heart size={25} fill={isLiked ? 'currentColor' : 'none'} /></span><small>{isLiked ? '已喜欢' : '喜欢'}</small></button><button className={isFavorite ? 'saved' : ''} disabled={favoriteBusy} onClick={() => void toggleFavorite()}><span><Bookmark size={24} fill={isFavorite ? 'currentColor' : 'none'} /></span><small>{isFavorite ? '已收藏' : '收藏'}</small></button><button aria-expanded={episodesOpen} aria-controls="episode-drawer" onClick={() => setEpisodesOpen(previous => !previous)}><span><ListVideo size={24} /></span><small>选集</small></button><button onClick={() => void share()}><span><Share2 size={24} /></span><small>分享</small></button></div><div className="feed-navigation" aria-label="切换短剧"><button className="next-arrow" disabled={active === 0} onClick={() => void nextDrama(-1)} aria-label="上一部短剧"><ChevronLeft size={23} className="rotate-up" /></button><button className="next-arrow" disabled={pageLoading || (!hasMore && active === dramas.length - 1)} onClick={() => void nextDrama(1)} aria-label="下一部短剧">{pageLoading ? <LoaderCircle className="spin" size={20} /> : <ChevronRight size={23} className="rotate-down" />}</button></div>
              {episodesOpen && <aside id="episode-drawer" className="episode-drawer" aria-label="剧集选集"><div className="episode-drawer-header"><h2>选集</h2><button className="icon-button" aria-label="关闭选集" onClick={() => setEpisodesOpen(false)}><X size={20} /></button></div><div className="episode-drawer-body"><div className="episode-modal-summary"><img src={drama?.cover} alt="" /><div><h3>{drama?.title}</h3><p>全 {drama?.episodeCount} 集{drama?.source === 'demo' ? ' · 示例分集，均播放同一公开测试片段' : ''}</p></div></div><div className="episode-options"><span><span className="tiny-dot" />正在播放 第 {episodes[episode]?.index || 1} 集</span><button onClick={() => setEpisodeDescending(previous => !previous)}>排序 <ChevronsUpDown size={13} /></button></div>{episodeLoading ? <div className="modal-loading"><LoaderCircle className="spin" />正在读取分集…</div> : episodeError ? <p className="inline-error">{episodeError}</p> : <div className="episode-grid">{(episodeDescending ? episodes.map((item, index) => ({ item, index })).reverse() : episodes.map((item, index) => ({ item, index }))).map(({ item, index }) => <button key={item.id} disabled={item.playable === false} title={item.playable === false ? '当前片源暂不可播放' : `第 ${item.index} 集`} className={episode === index ? 'selected' : ''} onClick={() => { void loadVideo(index) }}>{episode === index && <span className="equalizer"><i /><i /><i /></span>}{item.playable === false && <Lock size={11} />}{item.index}</button>)}</div>}{episodes.some(item => item.playable === false) && <p className="episode-access-note"><Lock size={12} />带锁集数当前片源暂不可播放</p>}{episodePageError && <p className="inline-error" role="alert">{episodePageError}</p>}{episodeHasMore && <button className="episode-load-more" disabled={episodePageLoading} onClick={retryEpisodePage}>{episodePageLoading ? '正在加载…' : episodePageError ? '重试加载分集' : '加载更多分集'}</button>}</div></aside>}
            </div>
          </>}
        </section>


      </div>
    </main>

    <nav className="mobile-nav">{navItems.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={21} /><span>{item.title.replace('为你', '').replace('好剧', '')}</span></button>)}<button onClick={() => user ? navigate('favorites') : setAuthOpen(true)}><span className="mobile-avatar">{user ? user.username[0] : <LogIn size={20} />}</span><span>{user ? '我的' : '本站登录'}</span></button></nav>

    {authOpen && <Modal title={authMode === 'login' ? '登录本站账号' : '注册本站账号'} onClose={() => setAuthOpen(false)} className="auth-modal"><div className="auth-brand"><span className="brand-icon"><Play size={23} fill="currentColor" /></span></div><p className="auth-description">保存本站收藏和观看进度。尚未接入红果官方登录。</p><form onSubmit={authenticate}><label>本站用户名<input name="username" autoComplete="username" placeholder="输入用户名（至少 2 个字符）" minLength={2} maxLength={32} required /></label><label>密码<input name="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="输入密码（至少 8 个字符）" minLength={8} maxLength={128} required /></label>{authError && <p className="inline-error" role="alert">{authError}</p>}<button className="primary-button" disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={17} /> : null}{authMode === 'login' ? '登录本站账号' : '创建本站账号'}<ArrowRight size={16} /></button></form><p className="auth-switch">{authMode === 'login' ? '第一次来？' : '已经有账号？'}<button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? '注册本站账号' : '去登录本站账号'}</button></p><div className="auth-note"><Bookmark size={14} /><span>这是本站账号，用于保存收藏和进度。<br />不关联红果官方账号。</span></div></Modal>}
    {infoOpen && <Modal title="欢迎来到你的私人放映室" onClose={() => setInfoOpen(false)}><div className="help-copy"><p>鼠标在画面上滚动，或使用 ↑ ↓ 切换短剧。手机上在画面内上下滑动即可刷剧。</p><p>点击画面中间开始播放，空格暂停。点击「选集」切换分集，播完后自动播放下一集。</p><p>登录本站账号后，收藏和观看进度保存在你运行的后端中。当前账号不关联红果官方账号。</p><p>「红果片源」通过 openhongguo 读取真实目录。示例片源仅演示界面，剧名、封面和测试视频并不对应真实短剧。部分上游分集受访问限制或加密保护，浏览器无法播放时会显示原因。</p><button className="help-server-settings" onClick={openServerSettings}><Settings2 size={16} />服务地址设置<ArrowRight size={14} /></button><a href="https://github.com/beilunyang/openhongguo" target="_blank" rel="noreferrer">查看参考项目 <ArrowRight size={14} /></a></div></Modal>}
    {serverSettingsOpen && <Modal title="服务地址" onClose={() => setServerSettingsOpen(false)} className="server-settings-modal"><ServerSettings /></Modal>}
    {toast && createPortal(<div className="toast" role="status"><Check size={16} />{toast}</div>, document.fullscreenElement || document.body)}
  </div>
}

function Modal({ title, children, onClose, className = '' }: { title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [portalTarget, setPortalTarget] = useState<Element>(() => document.fullscreenElement || document.body)
  useEffect(() => {
    const changed = () => setPortalTarget(document.fullscreenElement || document.body)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = ref.current
    element?.querySelector<HTMLElement>('input, button')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !element) return
      const focusable = Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href], select'))
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', trap)
    return () => { window.removeEventListener('keydown', trap); previous?.focus() }
  }, [portalTarget])
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-title"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div>{children}</div></div>, portalTarget)
}






