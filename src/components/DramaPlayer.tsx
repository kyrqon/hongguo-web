import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import DPlayer from 'dplayer'
import type { DPlayerVideo, FullScreenType } from 'dplayer'
import type Hls from 'hls.js'

export interface DramaPlayerProps {
  url: string
  revision: number
  poster: string
  durationHint: number
  converted: boolean
  timeOffset?: number
  autoplay?: boolean
  theaterMode: boolean
  fullscreen: boolean
  controlsDisabled?: boolean
  qualities?: Array<{ id: string; label: string; width?: number; height?: number; definition?: string }>
  selectedQuality?: string
  qualityBusy?: boolean
  onQualityChange?: (id: string) => void
  canPreviousEpisode?: boolean
  canNextEpisode?: boolean
  episodeNavigationBusy?: boolean
  onPreviousEpisode?: () => void
  onNextEpisode?: () => void
  onVideoReady: (video: HTMLVideoElement | null) => void
  onPlaybackState: (playing: boolean) => void
  onLoading: (loading: boolean) => void
  onError: (message: string) => void
  onEnded: () => void
  onRequestPlay?: () => void
  onTimeUpdate?: (time: number) => void
  onMetadata?: (video: HTMLVideoElement) => void
  onProgress?: (video: HTMLVideoElement) => void
  onToggleWebFullscreen: () => void
  onToggleFullscreen: () => void
}

// DPlayer's runtime exposes these documented APIs; @types/dplayer omits its DOM helpers.
interface PlayerInstance extends Omit<DPlayer, 'fullScreen' | 'switchVideo' | 'play' | 'volume' | 'notice'> {
  container: HTMLElement
  resize: () => void
  play: (fromNative?: boolean) => void
  volume: (value?: number, noStorage?: boolean, noNotice?: boolean) => number
  notice: (message: string, time?: number, opacity?: number) => void
  switchVideo: (video: DPlayerVideo) => void
  fullScreen: {
    request: (type?: FullScreenType) => void
    cancel: (type?: FullScreenType) => void
    isFullScreen: (type?: FullScreenType) => boolean
  }
  bar: { set: (name: string, percentage: number, direction: string) => void }
  setting: { loop: boolean; hide: () => void }
  hotkey: { cancelFullScreenHandler: EventListener }
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value))
const playbackSpeeds = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3]
const rateLabel = (value: number) => `${value}×`
type ControlIcon = 'play' | 'pause' | 'more' | 'fullscreen' | 'exit-fullscreen' | 'web-fullscreen' | 'exit-web-fullscreen'
function controlIcon(button: HTMLElement | null, name: ControlIcon) {
  if (!button || button.querySelector(`svg[data-player-icon="${name}"]`)) return
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'data-player-icon': name })) svg.setAttribute(key, value)
  const shape = (tag: string, attributes: Record<string, string>) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
    svg.append(element)
  }
  if (name === 'play') shape('path', { d: 'm8 5 11 7-11 7Z', fill: 'currentColor', stroke: 'none' })
  else if (name === 'pause') {
    shape('rect', { x: '6', y: '5', width: '4', height: '14', rx: '1', fill: 'currentColor', stroke: 'none' })
    shape('rect', { x: '14', y: '5', width: '4', height: '14', rx: '1', fill: 'currentColor', stroke: 'none' })
  } else if (name === 'more') {
    shape('path', { d: 'M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11' })
    for (const [cx, cy] of [['10', '6'], ['16', '12'], ['8', '18']]) shape('circle', { cx, cy, r: '2' })
  }
  else if (name === 'fullscreen') shape('path', { d: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3' })
  else if (name === 'exit-fullscreen') shape('path', { d: 'M3 8h3a2 2 0 0 0 2-2V3m8 0v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3m18 0h-3a2 2 0 0 0-2 2v3' })
  else {
    shape('rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' })
    if (name === 'exit-web-fullscreen') shape('rect', { x: '7', y: '9', width: '10', height: '6', rx: '1' })
  }
  button.replaceChildren(svg)
}
const formatTime = (input: number) => {
  const seconds = Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function storedNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const value = localStorage.getItem(key)
    const parsed = value === null ? fallback : Number(value)
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback
  } catch { return fallback }
}
function storeNumber(key: string, value: number) {
  try { localStorage.setItem(key, String(value)) } catch { /* Playback also works with storage disabled. */ }
}

/** Real DPlayer controls, with the app retaining ownership of the episode feed and full-screen stage. */
export default function DramaPlayer(props: DramaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<PlayerInstance | null>(null)
  const callbacks = useRef(props)
  const sourceVersion = useRef(0)
  const hlsRef = useRef<Hls | null>(null)
  const preferredRate = useRef(storedNumber('hongguo.playbackRate', 1, .25, 4))
  const sourceReady = useRef(false)
  const [controlHosts, setControlHosts] = useState<{ left: HTMLElement; right: HTMLElement } | null>(null)
  const [openMenu, setOpenMenu] = useState<'quality' | 'speed' | 'volume' | null>(null)
  const [playbackRate, setPlaybackRate] = useState(preferredRate.current)
  const [volumeState, setVolumeState] = useState(() => ({ level: storedNumber('hongguo.volume', .7, 0, 1), muted: false }))
  const lastAudibleVolume = useRef(volumeState.level || .7)
  const volumeCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressVolumeFocus = useRef(false)
  const focusVolumeSlider = useRef(false)
  const extraControlsRef = useRef<HTMLDivElement>(null)
  const volumeControlRef = useRef<HTMLDivElement>(null)
  const qualityButtonRef = useRef<HTMLButtonElement>(null)
  const speedButtonRef = useRef<HTMLButtonElement>(null)
  const volumeButtonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  callbacks.current = props

  const focusTrigger = (menu: typeof openMenu) => {
    const button = menu === 'quality' ? qualityButtonRef.current : menu === 'speed' ? speedButtonRef.current : volumeButtonRef.current
    suppressVolumeFocus.current = menu === 'volume'
    button?.focus()
    suppressVolumeFocus.current = false
  }
  const cancelVolumeClose = () => {
    if (volumeCloseTimer.current) clearTimeout(volumeCloseTimer.current)
    volumeCloseTimer.current = null
  }
  const closeMenu = (restoreFocus = false) => {
    cancelVolumeClose()
    setOpenMenu(null)
    if (restoreFocus) focusTrigger(openMenu)
  }
  const toggleMenu = (menu: 'quality' | 'speed') => {
    playerRef.current?.setting.hide()
    setOpenMenu(previous => previous === menu ? null : menu)
  }
  const selectSpeed = (value: number) => {
    preferredRate.current = value
    storeNumber('hongguo.playbackRate', value)
    setPlaybackRate(value)
    const video = playerRef.current?.video
    if (video) { video.defaultPlaybackRate = value; video.playbackRate = value }
    closeMenu(true)
  }
  const openVolume = () => {
    cancelVolumeClose()
    if (suppressVolumeFocus.current) return
    playerRef.current?.setting.hide()
    setOpenMenu('volume')
  }
  const scheduleVolumeClose = () => {
    cancelVolumeClose()
    volumeCloseTimer.current = setTimeout(() => {
      if (!volumeControlRef.current?.contains(document.activeElement)) setOpenMenu(previous => previous === 'volume' ? null : previous)
    }, 140)
  }
  const selectVolume = (percent: number) => {
    const player = playerRef.current
    if (!player) return
    const level = clamp(percent / 100)
    // Keep the controlled range in sync before the queued native volumechange event.
    setVolumeState({ level, muted: false })
    player.video.muted = false
    player.volume(level)
    if (level > 0) lastAudibleVolume.current = level
  }
  const toggleMute = () => {
    const player = playerRef.current
    if (!player) return
    const video = player.video
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) player.volume(lastAudibleVolume.current)
      video.muted = false
    } else {
      lastAudibleVolume.current = video.volume
      video.muted = true
    }
  }
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'))
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  useEffect(() => {
    if (!openMenu) return
    const root = extraControlsRef.current
    const menu = root?.querySelector<HTMLElement>('[role="menu"]')
    const selected = menu?.querySelector<HTMLElement>('[aria-checked="true"]') || menu?.querySelector<HTMLElement>('[role="menuitemradio"]')
    if (openMenu !== 'volume') selected?.focus()
    else if (focusVolumeSlider.current) { root?.querySelector<HTMLInputElement>('.player-volume-slider')?.focus(); focusVolumeSlider.current = false }
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root?.contains(event.target)) setOpenMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation()
      setOpenMenu(null)
      focusTrigger(openMenu)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [openMenu])

  useEffect(() => { cancelVolumeClose(); setOpenMenu(null) }, [props.url, props.revision])
  useEffect(() => () => cancelVolumeClose(), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    const detach: Array<() => void> = []
    const listen = (element: EventTarget, name: string, handler: EventListener) => {
      element.addEventListener(name, handler)
      detach.push(() => element.removeEventListener(name, handler))
    }
    const get = (selector: string) => container.querySelector<HTMLElement>(selector)
    const isCurrent = () => !disposed && playerRef.current === player
    const destroyHls = () => { hlsRef.current?.destroy(); hlsRef.current = null }
    const customHls = (video: HTMLVideoElement) => {
      const version = sourceVersion.current
      const url = callbacks.current.url
      if (!url) return
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
        return
      }
      // DPlayer first assigns the URL itself. Cancel that native HLS attempt before attaching MSE.
      video.removeAttribute('src')
      video.load()
      void import('hls.js').then(({ default: HlsPlayer }) => {
        if (!isCurrent() || sourceVersion.current !== version) return
        if (!HlsPlayer.isSupported()) {
          callbacks.current.onLoading(false)
          callbacks.current.onError('当前浏览器不支持此视频流，请更新浏览器后重试')
          return
        }
        destroyHls()
        const hls = new HlsPlayer()
        hlsRef.current = hls
        hls.on(HlsPlayer.Events.ERROR, (_, data) => {
          if (isCurrent() && sourceVersion.current === version && data.fatal) {
            callbacks.current.onLoading(false)
            callbacks.current.onError('视频流加载失败，请重试或选择其他分集')
          }
        })
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (isCurrent() && sourceVersion.current === version && callbacks.current.autoplay !== false) player.play()
        })
        hls.loadSource(url)
        hls.attachMedia(video)
      }).catch(() => {
        if (isCurrent() && sourceVersion.current === version) {
          callbacks.current.onLoading(false)
          callbacks.current.onError('视频组件加载失败，请刷新后重试')
        }
      })
    }

    const player = new DPlayer({
      container,
      lang: 'zh-cn',
      theme: '#fe2c55',
      autoplay: false,
      loop: false,
      hotkey: false,
      mutex: false,
      screenshot: false,
      preload: 'metadata',
      volume: storedNumber('hongguo.volume', .7, 0, 1),
      playbackSpeed: playbackSpeeds,
      video: { url: '', pic: props.poster, type: 'normal', customType: { hongguoHls: customHls } },
    }) as unknown as PlayerInstance
    playerRef.current = player
    const leftHost = document.createElement('span')
    const rightHost = document.createElement('span')
    leftHost.className = 'drama-episode-controls-host'
    rightHost.className = 'drama-extra-controls-host'
    const leftControls = get('.dplayer-icons-left')
    const rightControls = get('.dplayer-icons-right')
    leftControls?.insertBefore(leftHost, get('.dplayer-volume'))
    rightControls?.prepend(rightHost)
    if (leftControls && rightControls) setControlHosts({ left: leftHost, right: rightHost })
    // DPlayer installs its Escape handler even with hotkey:false. The app owns Escape
    // priority so closing an episode drawer or login dialog must not also leave fullscreen.
    document.removeEventListener('keydown', player.hotkey.cancelFullScreenHandler)
    const video = player.video
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.removeAttribute('src')
    video.load()
    video.defaultPlaybackRate = preferredRate.current
    video.playbackRate = preferredRate.current
    player.volume(storedNumber('hongguo.volume', player.volume(), 0, 1), false, true)

    // Cropped compatibility streams start natively at zero. Keep DPlayer and the feed
    // on the original episode's timeline without seeking outside the received clip.
    const offset = () => Number.isFinite(callbacks.current.timeOffset) ? Math.max(0, callbacks.current.timeOffset || 0) : 0
    const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    if (nativeTime?.get && nativeTime.set) {
      try {
        Object.defineProperty(video, 'currentTime', {
          configurable: true,
          get: () => (nativeTime.get!.call(video) as number) + offset(),
          set: (requested: number) => nativeTime.set!.call(video, Math.max(0, requested - offset())),
        })
        detach.push(() => { Reflect.deleteProperty(video, 'currentTime') })
      } catch { /* Browsers without per-element descriptors retain their native timeline. */ }
    }
    const nativeBuffered = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'buffered')?.get
    if (nativeBuffered) {
      try {
        Object.defineProperty(video, 'buffered', {
          configurable: true,
          get: (): TimeRanges => {
            const ranges = nativeBuffered.call(video) as TimeRanges
            const startOffset = offset()
            return { length: ranges.length, start: index => ranges.start(index) + startOffset, end: index => ranges.end(index) + startOffset }
          },
        })
        detach.push(() => { Reflect.deleteProperty(video, 'buffered') })
      } catch { /* Native buffered ranges remain available if the adapter is unsupported. */ }
    }
    // fMP4 duration can be Infinity or just the latest fragment; the API knows the total.
    const nativeDuration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')?.get
    if (nativeDuration) {
      try {
        Object.defineProperty(video, 'duration', {
          configurable: true,
          get: () => {
            const actual = nativeDuration.call(video) as number
            if (!callbacks.current.converted) return actual + offset()
            const finite = Number.isFinite(actual) && actual > 0 ? actual + offset() : 0
            return Math.max(finite, callbacks.current.durationHint || 0)
          },
        })
        detach.push(() => { Reflect.deleteProperty(video, 'duration') })
      } catch { /* The display updater below still prevents non-finite timeline labels. */ }
    }

    const originalPlay = player.play.bind(player)
    player.play = (fromNative) => {
      if (callbacks.current.controlsDisabled) return
      if (!callbacks.current.url) { callbacks.current.onRequestPlay?.(); return }
      originalPlay(fromNative)
    }
    const originalSeek = player.seek.bind(player)
    player.seek = (requested) => {
      if (!callbacks.current.url || !Number.isFinite(requested)) return
      const duration = Number.isFinite(video.duration) ? video.duration : callbacks.current.durationHint
      let target = clamp(requested, 0, duration || Number.MAX_SAFE_INTEGER)
      if (callbacks.current.converted) {
        const ranges = video.buffered
        const start = ranges.length ? ranges.start(0) : offset()
        const end = ranges.length ? ranges.end(ranges.length - 1) : video.currentTime
        if (target < start || target > end) {
          target = clamp(target, start, Math.max(start, end - .05))
          player.notice('此片源仅支持跳转到已缓冲的位置', 2200)
        }
      }
      originalSeek(target)
    }
    // Keep the whole app stage in fullscreen, including episode and favorite controls.
    player.fullScreen.isFullScreen = (type = 'browser') => type === 'web' ? callbacks.current.theaterMode : callbacks.current.fullscreen
    const toggleScreen = (type: FullScreenType = 'browser') => {
      if (type === 'web') callbacks.current.onToggleWebFullscreen()
      else callbacks.current.onToggleFullscreen()
    }
    player.fullScreen.request = toggleScreen
    player.fullScreen.cancel = toggleScreen

    const progress = get('.dplayer-bar-wrap')
    const volume = get('.dplayer-volume-bar-wrap')
    const play = get('.dplayer-play-icon')
    const mute = get('.dplayer-volume-icon')
    const settings = get('.dplayer-setting-icon')
    const fullscreen = get('.dplayer-full-icon')
    const webFullscreen = get('.dplayer-full-in-icon')
    const nativeVolume = get('.dplayer-volume')
    if (nativeVolume) { nativeVolume.style.display = 'none'; nativeVolume.setAttribute('aria-hidden', 'true') }
    const loopLabel = get('.dplayer-setting-loop .dplayer-label')
    if (loopLabel) loopLabel.textContent = '单集循环'
    const synchronizeControls = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : callbacks.current.durationHint
      const time = Number.isFinite(video.currentTime) ? video.currentTime : 0
      const shownVolume = Math.round((video.muted ? 0 : video.volume) * 100)
      setVolumeState(previous => previous.level === video.volume && previous.muted === video.muted ? previous : { level: video.volume, muted: video.muted })
      if (video.volume > 0) lastAudibleVolume.current = video.volume
      controlIcon(play, video.paused ? 'play' : 'pause')
      controlIcon(settings, 'more')
      controlIcon(fullscreen, callbacks.current.fullscreen ? 'exit-fullscreen' : 'fullscreen')
      controlIcon(webFullscreen, callbacks.current.theaterMode ? 'exit-web-fullscreen' : 'web-fullscreen')
      const durationLabel = get('.dplayer-dtime')
      if (durationLabel) durationLabel.textContent = formatTime(duration)
      if (duration > 0) {
        player.bar.set('played', clamp(time / duration), 'width')
        const loaded = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
        player.bar.set('loaded', clamp(loaded / duration), 'width')
      }
      for (const [button, label] of [
        [play, video.paused ? '播放' : '暂停'],
        [mute, video.muted || video.volume === 0 ? '开启声音' : '静音'],
      ] as const) {
        button?.setAttribute('aria-label', label)
        button?.setAttribute('title', label)
        button?.setAttribute('data-balloon', label)
      }
      volume?.setAttribute('aria-valuenow', String(shownVolume))
      volume?.setAttribute('aria-valuetext', `${shownVolume}%`)
      progress?.setAttribute('aria-valuemax', String(duration || 0))
      progress?.setAttribute('aria-valuenow', String(time))
      progress?.setAttribute('aria-valuetext', `${formatTime(time)} / ${formatTime(duration)}`)
    }
    for (const [element, name] of [[play, '播放'], [mute, '静音'], [settings, '播放设置'], [fullscreen, '系统全屏'], [webFullscreen, '网页全屏']] as const) {
      element?.setAttribute('aria-label', name)
      element?.setAttribute('title', name)
    }
    for (const [element, name] of [[progress, '播放进度'], [volume, '音量']] as const) {
      if (!element) continue
      element.setAttribute('role', 'slider')
      element.setAttribute('tabindex', '0')
      element.setAttribute('aria-label', name)
      element.setAttribute('aria-valuemin', '0')
      element.setAttribute('aria-valuemax', name === '音量' ? '100' : '0')
      element.setAttribute('aria-valuenow', '0')
      listen(element, 'keydown', ((event: KeyboardEvent) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1
        if (name === '音量') {
          const value = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (video.muted ? 0 : video.volume) + direction * .05
          player.volume(clamp(value))
        } else {
          const value = event.key === 'Home' ? 0 : event.key === 'End' ? video.duration : video.currentTime + direction * 5
          player.seek(value)
        }
        synchronizeControls()
      }) as EventListener)
    }
    nativeVolume?.querySelectorAll<HTMLElement>('button, [tabindex]').forEach(element => { element.tabIndex = -1 })
    container.querySelectorAll<HTMLElement>('.dplayer-setting-speed-item').forEach((element) => {
      element.setAttribute('role', 'menuitem')
      element.setAttribute('tabindex', '0')
      listen(element, 'keydown', ((event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); element.click() }
      }) as EventListener)
    })

    const on = (name: Parameters<DPlayer['on']>[0], handler: () => void) => player.on(name, () => { if (isCurrent()) handler() })
    on('play', () => { callbacks.current.onPlaybackState(true); callbacks.current.onLoading(false); synchronizeControls() })
    on('playing', () => { sourceReady.current = true; callbacks.current.onPlaybackState(true); callbacks.current.onLoading(false) })
    on('pause', () => { callbacks.current.onPlaybackState(false); synchronizeControls() })
    on('waiting', () => { if (callbacks.current.url) callbacks.current.onLoading(true) })
    on('canplay', () => { callbacks.current.onLoading(false); synchronizeControls() })
    on('loadedmetadata', () => {
      video.playbackRate = preferredRate.current
      sourceReady.current = true
      callbacks.current.onMetadata?.(video)
      synchronizeControls()
    })
    on('durationchange', synchronizeControls)
    on('timeupdate', () => { callbacks.current.onTimeUpdate?.(video.currentTime); synchronizeControls() })
    on('progress', () => { callbacks.current.onProgress?.(video); synchronizeControls() })
    on('volumechange', () => { storeNumber('hongguo.volume', video.volume); synchronizeControls() })
    on('ratechange', () => {
      if (sourceReady.current && video.playbackRate > 0) {
        preferredRate.current = video.playbackRate
        if (video.defaultPlaybackRate !== video.playbackRate) video.defaultPlaybackRate = video.playbackRate
        storeNumber('hongguo.playbackRate', video.playbackRate)
        setPlaybackRate(video.playbackRate)
      }
    })
    on('ended', () => {
      callbacks.current.onLoading(false)
      // Respect DPlayer's native repeat switch instead of advancing behind its back.
      if (!player.setting.loop) callbacks.current.onEnded()
    })
    on('error', () => {
      if (!callbacks.current.url || !video.error || hlsRef.current) return
      callbacks.current.onLoading(false)
      callbacks.current.onError('视频加载失败，片源可能已过期，请重试或选择其他分集')
    })
    callbacks.current.onVideoReady(video)
    synchronizeControls()
    let previousSize = ''
    const observer = new ResizeObserver(([entry]) => {
      const size = `${Math.round(entry.contentRect.width)}:${Math.round(entry.contentRect.height)}`
      if (isCurrent() && entry.contentRect.width > 0 && entry.contentRect.height > 0 && size !== previousSize) {
        previousSize = size; player.resize()
      }
    })
    observer.observe(container)

    return () => {
      disposed = true
      sourceVersion.current++
      observer.disconnect()
      destroyHls()
      callbacks.current.onVideoReady(null)
      setControlHosts(null)
      playerRef.current = null
      for (const remove of detach) remove()
      player.destroy()
    }
  }, [])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    player.container.classList.toggle('has-source', !!props.url)
    player.container.classList.toggle('is-idle', !props.url)
    sourceVersion.current++
    sourceReady.current = false
    hlsRef.current?.destroy(); hlsRef.current = null
    player.pause()
    controlIcon(player.container.querySelector('.dplayer-play-icon'), 'play')
    player.bar.set('played', 0, 'width')
    player.bar.set('loaded', 0, 'width')
    if (!props.url) {
      player.video.removeAttribute('src')
      player.video.load()
      return
    }
    callbacks.current.onLoading(true)
    player.switchVideo({
      url: props.url,
      pic: props.poster,
      type: /\.m3u8(?:[?#]|$)/i.test(props.url) ? 'hongguoHls' : 'normal',
    })
    player.video.defaultPlaybackRate = preferredRate.current
    player.video.playbackRate = preferredRate.current
    if (props.autoplay !== false) player.play()
    controlIcon(player.container.querySelector('.dplayer-play-icon'), player.video.paused ? 'play' : 'pause')
  }, [props.url, props.revision])

  useEffect(() => {
    if (playerRef.current) playerRef.current.video.poster = props.poster
  }, [props.poster])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const labels = [
      ['.dplayer-full-icon', props.fullscreen ? '退出系统全屏' : '系统全屏'],
      ['.dplayer-full-in-icon', props.theaterMode ? '退出网页全屏' : '网页全屏'],
    ] as const
    for (const [selector, label] of labels) {
      const button = player.container.querySelector<HTMLElement>(selector)
      button?.setAttribute('aria-label', label); button?.setAttribute('title', label); button?.setAttribute('data-balloon', label)
    }
    controlIcon(player.container.querySelector('.dplayer-full-icon'), props.fullscreen ? 'exit-fullscreen' : 'fullscreen')
    controlIcon(player.container.querySelector('.dplayer-full-in-icon'), props.theaterMode ? 'exit-web-fullscreen' : 'web-fullscreen')
    controlIcon(player.container.querySelector('.dplayer-setting-icon'), 'more')
    player.container.querySelectorAll<HTMLButtonElement>('.dplayer-play-icon, .dplayer-mobile-play').forEach((button) => { button.disabled = !!props.controlsDisabled })
    player.resize()
  }, [props.theaterMode, props.fullscreen, props.controlsDisabled])

  // DPlayer owns extra classes on this element; keep React's className stable so source
  // changes cannot overwrite dplayer-playing, dplayer-no-danmaku, or controller state.
  const selectedQuality = props.qualities?.find(item => item.id === props.selectedQuality)
  const qualityLabel = selectedQuality?.label || (props.qualities?.length === 1 ? props.qualities[0].label : '清晰度')
  const qualityCount = props.qualities?.length || 0
  const qualityTitle = props.qualityBusy ? '正在切换清晰度' : !qualityCount ? '播放后显示片源提供的清晰度' : `${qualityLabel}${qualityCount === 1 ? ' · 当前片源仅有此清晰度' : ''}`
  const volumeMuted = volumeState.muted || volumeState.level === 0
  const volumePercent = Math.round((volumeMuted ? 0 : volumeState.level) * 100)
  return <>
    <div ref={containerRef} className="drama-player drama-dplayer" aria-label="DPlayer 短剧播放器" />
    {controlHosts && createPortal(<div className="drama-extra-controls" ref={extraControlsRef} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button ref={qualityButtonRef} className="player-text-control quality-control" type="button" aria-label="清晰度" title={qualityTitle} aria-haspopup="menu" aria-expanded={openMenu === 'quality'} aria-controls={`${menuId}-quality`} disabled={!!props.qualityBusy || qualityCount < 2 || !props.onQualityChange} onClick={() => toggleMenu('quality')} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); toggleMenu('quality') } }}>{props.qualityBusy ? '切换中…' : qualityLabel}</button>
      <button ref={speedButtonRef} className="player-text-control speed-control" type="button" aria-label="倍速" title={`播放速度 ${rateLabel(playbackRate)}`} aria-haspopup="menu" aria-expanded={openMenu === 'speed'} aria-controls={`${menuId}-speed`} onClick={() => toggleMenu('speed')} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); toggleMenu('speed') } }}>{playbackRate === 1 ? '倍速' : rateLabel(playbackRate)}</button>
      <div className="player-volume-control" ref={volumeControlRef} onMouseEnter={openVolume} onMouseLeave={scheduleVolumeClose} onFocusCapture={openVolume} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleVolumeClose() }}>
        <button ref={volumeButtonRef} className="player-volume-button" type="button" aria-label={volumeMuted ? '开启声音' : '静音'} title={volumeMuted ? '开启声音' : `音量 ${volumePercent}%`} aria-haspopup="dialog" aria-expanded={openMenu === 'volume'} aria-controls={`${menuId}-volume`} onClick={toggleMute} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const slider = volumeControlRef.current?.querySelector<HTMLInputElement>('.player-volume-slider')
            if (slider) slider.focus()
            else { focusVolumeSlider.current = true; openVolume() }
          }
        }}>{volumeMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}</button>
        {openMenu === 'volume' && <div id={`${menuId}-volume`} className="player-volume-popover" role="dialog" aria-label="音量调节" onMouseEnter={cancelVolumeClose}>
          <input className="player-volume-slider" type="range" min="0" max="100" step="1" value={volumePercent} aria-label="音量" aria-orientation="vertical" aria-valuetext={`${volumePercent}%`} style={{ '--volume-level': `${volumePercent}%` } as CSSProperties} onChange={event => selectVolume(Number(event.currentTarget.value))} />
        </div>}
      </div>
      {openMenu === 'quality' && <div className="player-control-menu quality-menu" id={`${menuId}-quality`} role="menu" aria-label="清晰度选项" onKeyDown={onMenuKeyDown}>{props.qualities?.map(item => <button type="button" key={item.id} role="menuitemradio" aria-checked={item.id === props.selectedQuality} disabled={!!props.qualityBusy} onClick={() => { if (item.id !== props.selectedQuality) props.onQualityChange?.(item.id); closeMenu(true) }}><span>{item.label}</span><span className="control-menu-check" aria-hidden="true">{item.id === props.selectedQuality ? '✓' : ''}</span></button>)}</div>}
      {openMenu === 'speed' && <div className="player-control-menu speed-menu" id={`${menuId}-speed`} role="menu" aria-label="播放速度" onKeyDown={onMenuKeyDown}>{playbackSpeeds.map(value => <button type="button" key={value} role="menuitemradio" aria-checked={Math.abs(value - playbackRate) < .001} onClick={() => selectSpeed(value)}><span>{rateLabel(value)}</span><span className="control-menu-check" aria-hidden="true">{Math.abs(value - playbackRate) < .001 ? '✓' : ''}</span></button>)}</div>}
    </div>, controlHosts.right)}
    {controlHosts && createPortal(<span className="drama-episode-controls" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="dplayer-icon episode-step-button" aria-label="上一集" title="上一集" disabled={!props.canPreviousEpisode || !!props.episodeNavigationBusy || !props.onPreviousEpisode} onClick={() => props.onPreviousEpisode?.()}><SkipBack size={22} aria-hidden="true" /></button>
      <button type="button" className="dplayer-icon episode-step-button" aria-label="下一集" title="下一集" disabled={!props.canNextEpisode || !!props.episodeNavigationBusy || !props.onNextEpisode} onClick={() => props.onNextEpisode?.()}><SkipForward size={22} aria-hidden="true" /></button>
    </span>, controlHosts.left)}
  </>
}
