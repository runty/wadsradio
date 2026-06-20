import {
  Download,
  FileUp,
  GripVertical,
  Heart,
  Info,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import Hls from 'hls.js'
import './App.css'
import {
  DEFAULT_STATIONS,
  createStation,
  exportYoRadioPlaylist,
  parseStationList,
} from './stations'
import type { Station } from './stations'
import { WadsThemeSwitch } from './WadsThemeSwitch'
import { loadWadsThemeMode, syncWadsTheme, type WadsThemeMode } from './wads-theme'

const LEGACY_STATIONS_STORAGE_KEY = 'wadsradio.stations.v1'
const FAVORITE_STATIONS_STORAGE_KEY = 'wadsradio.favoriteStations.v1'
const SELECTED_PLAYLIST_STORAGE_KEY = 'wadsradio.selectedPlaylist.v1'
const VOLUME_STORAGE_KEY = 'wadsradio.volume.v1'
const LAST_STATION_STORAGE_KEY = 'wadsradio.lastStation.v1'
const THEME_STORAGE_KEY = 'wadsradio.theme.v1'
const FAVORITES_PLAYLIST_ID = '__favorites__'

type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
type MetadataStatus = 'idle' | 'loading' | 'ready' | 'unavailable'
type PlaylistStatus = 'idle' | 'loading' | 'ready' | 'error'

type StationListSummary = {
  filename: string
  id: string
  stationCount: number
  title: string
}

type StationListsResponse = {
  ok: boolean
  lists?: StationListSummary[]
  error?: string
}

type StationListResponse = {
  ok: boolean
  list?: StationListSummary
  content?: string
  error?: string
}

type MediaInfo = {
  ok: boolean
  fetchedAt?: string
  stationName?: string
  genre?: string
  bitrate?: string
  description?: string
  homepage?: string
  contentType?: string
  server?: string
  streamTitle?: string
  streamUrl?: string
  artist?: string
  title?: string
  provider?: string
  album?: string
  artwork?: string
  artworkProvider?: string
  thumbnail?: string
  labels?: string[]
  releaseDate?: string
  playedAt?: string
  showName?: string
  hostNames?: string[]
  showTagline?: string
  error?: string
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const importFileRef = useRef<HTMLInputElement | null>(null)
  const stationListRef = useRef<HTMLDivElement | null>(null)
  const audioStationIdRef = useRef<string | null>(null)
  const draggingStationIdRef = useRef<string | null>(null)
  const playbackRequestIdRef = useRef(0)
  const cleanupStationDragRef = useRef<(() => void) | null>(null)
  const [stationLists, setStationLists] = useState<StationListSummary[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(() => loadSelectedPlaylistId())
  const [playlistStations, setPlaylistStations] = useState<Station[]>(DEFAULT_STATIONS)
  const [playlistStatus, setPlaylistStatus] = useState<PlaylistStatus>('idle')
  const [playlistError, setPlaylistError] = useState('')
  const [favoriteStations, setFavoriteStations] = useState<Station[]>(() => loadFavoriteStations())
  const [currentStationId, setCurrentStationId] = useState(() => loadLastStationId())
  const [playbackStation, setPlaybackStation] = useState<Station | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [volume, setVolume] = useState(() => loadVolume())
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importSummary, setImportSummary] = useState('')
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null)
  const [metadataStatus, setMetadataStatus] = useState<MetadataStatus>('idle')
  const [metadataRefreshToken, setMetadataRefreshToken] = useState(0)
  const [draggingStationId, setDraggingStationId] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<WadsThemeMode>(() => loadWadsThemeMode(THEME_STORAGE_KEY))

  const activePlaylistIsFavorites = selectedPlaylistId === FAVORITES_PLAYLIST_ID
  const selectedStationList = stationLists.find((list) => list.id === selectedPlaylistId) ?? null
  const selectedPlaylistTitle = activePlaylistIsFavorites ? 'Favorites' : selectedStationList?.title || 'Station list'
  const canEditActivePlaylist = activePlaylistIsFavorites
  const effectivePlaylistStatus = activePlaylistIsFavorites ? 'ready' : playlistStatus
  const effectivePlaylistError = activePlaylistIsFavorites ? '' : playlistError
  const favoriteUrls = useMemo(
    () => new Set(favoriteStations.map((station) => station.url.toLowerCase())),
    [favoriteStations],
  )
  const stations = useMemo(
    () =>
      activePlaylistIsFavorites
        ? favoriteStations.map((station) => ({ ...station, favorite: true }))
        : playlistStations.map((station) => ({ ...station, favorite: favoriteUrls.has(station.url.toLowerCase()) })),
    [activePlaylistIsFavorites, favoriteStations, favoriteUrls, playlistStations],
  )

  const currentStation =
    playbackStation ?? stations.find((station) => station.id === currentStationId) ?? stations[0] ?? DEFAULT_STATIONS[0]

  const filteredStations = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()

    return stations.filter((station) => {
      const matchesQuery =
        !cleanQuery ||
        station.name.toLowerCase().includes(cleanQuery) ||
        station.url.toLowerCase().includes(cleanQuery)

      return matchesQuery
    })
  }, [query, stations])

  const favoritesCount = favoriteStations.length
  const statusLabel = status === 'loading' ? 'Tuning' : status === 'error' ? 'Could not play' : status
  const mediaDisplay = getMediaDisplay(mediaInfo, currentStation, metadataStatus)
  const mediaFacts = getMediaFacts(mediaInfo)
  const stationDisplayName = mediaInfo?.stationName || currentStation?.name || 'Station'
  const stationSubheading = getStationSubheading(mediaInfo, currentStation)

  useEffect(() => {
    localStorage.setItem(FAVORITE_STATIONS_STORAGE_KEY, JSON.stringify(favoriteStations))
  }, [favoriteStations])

  useEffect(() => {
    if (selectedPlaylistId) {
      localStorage.setItem(SELECTED_PLAYLIST_STORAGE_KEY, selectedPlaylistId)
    }
  }, [selectedPlaylistId])

  useEffect(() => {
    let ignore = false

    async function loadStationLists() {
      try {
        const response = await fetch('/api/station-lists')
        const result = (await response.json()) as StationListsResponse
        if (ignore) return

        const lists = result.ok && Array.isArray(result.lists) ? result.lists : []
        setStationLists(lists)
        setSelectedPlaylistId((current) => {
          if (current === FAVORITES_PLAYLIST_ID || lists.some((list) => list.id === current)) return current
          return lists[0]?.id ?? FAVORITES_PLAYLIST_ID
        })
      } catch {
        if (ignore) return
        setStationLists([])
        setSelectedPlaylistId((current) => current || FAVORITES_PLAYLIST_ID)
      }
    }

    void loadStationLists()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!selectedPlaylistId || activePlaylistIsFavorites) return

    let ignore = false
    const controller = new AbortController()

    async function loadSelectedStationList() {
      setPlaylistStatus('loading')
      setPlaylistError('')
      setPlaylistStations([])

      try {
        const response = await fetch(`/api/station-list?id=${encodeURIComponent(selectedPlaylistId)}`, {
          signal: controller.signal,
        })
        const result = (await response.json()) as StationListResponse
        if (ignore) return

        if (!response.ok || !result.ok || !result.content) {
          throw new Error(result.error || 'Station list unavailable.')
        }

        const parsed = parseStationList(result.content)
        setPlaylistStations(parsed.stations)
        setPlaylistStatus('ready')
      } catch (error) {
        if (ignore || error instanceof DOMException) return

        setPlaylistStations([])
        setPlaylistStatus('error')
        setPlaylistError(error instanceof Error ? error.message : 'Station list unavailable.')
      }
    }

    void loadSelectedStationList()

    return () => {
      ignore = true
      controller.abort()
    }
  }, [activePlaylistIsFavorites, selectedPlaylistId])

  useEffect(() => {
    return syncWadsTheme(THEME_STORAGE_KEY, themeMode)
  }, [themeMode])

  useEffect(() => {
    return () => cleanupStationDragRef.current?.()
  }, [])

  useEffect(() => {
    return () => {
      if (!hlsRef.current) return
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    updateMediaSessionMetadata(mediaInfo, currentStation, mediaDisplay, stationDisplayName, stationSubheading, status)
  }, [currentStation, mediaDisplay, mediaInfo, stationDisplayName, stationSubheading, status])

  useEffect(() => {
    setMediaSessionAction('play', () => resumeCurrentStation())
    setMediaSessionAction('pause', () => pausePlayback())
    setMediaSessionAction('previoustrack', () => moveStation(-1))
    setMediaSessionAction('nexttrack', () => moveStation(1))
    setMediaSessionAction('stop', () => pausePlayback())
  })

  useEffect(() => {
    return () => {
      clearMediaSessionActions()
      clearMediaSessionMetadata()
    }
  }, [])

  useEffect(() => {
    if (currentStation?.id) {
      localStorage.setItem(LAST_STATION_STORAGE_KEY, currentStation.id)
    }
  }, [currentStation?.id])

  useEffect(() => {
    if (!currentStation?.url) return

    let ignore = false
    const controller = new AbortController()

    async function refreshMetadata(showLoading: boolean) {
      if (showLoading) setMetadataStatus('loading')

      try {
        const response = await fetch(`/api/metadata?url=${encodeURIComponent(currentStation.url)}`, {
          signal: controller.signal,
        })
        const metadata = (await response.json()) as MediaInfo

        if (ignore) return
        setMediaInfo(metadata)
        setMetadataStatus(hasUsefulMetadata(metadata) ? 'ready' : 'unavailable')
      } catch (error) {
        if (ignore || error instanceof DOMException) return

        setMediaInfo({
          ok: false,
          error: 'Metadata unavailable.',
          fetchedAt: new Date().toISOString(),
        })
        setMetadataStatus('unavailable')
      }
    }

    void refreshMetadata(true)

    const interval =
      status === 'playing' || status === 'loading'
        ? window.setInterval(() => void refreshMetadata(false), 24000)
        : undefined

    return () => {
      ignore = true
      controller.abort()
      if (interval) window.clearInterval(interval)
    }
  }, [currentStation?.url, metadataRefreshToken, status])

  async function playStation(station: Station) {
    const audio = audioRef.current
    if (!audio) return

    const playbackRequestId = playbackRequestIdRef.current + 1
    playbackRequestIdRef.current = playbackRequestId
    audioStationIdRef.current = station.id

    setCurrentStationId(station.id)
    setPlaybackStation(station)
    setStatus('loading')
    audio.volume = volume

    destroyHlsPlayer()

    const isHlsStation = isHlsStreamUrl(station.url)
    const playbackUrl = isHlsStation ? toHlsProxyUrl(station.url) : station.url

    if (isHlsStation) {
      audio.removeAttribute('src')
      audio.load()

      try {
        if (playbackRequestId !== playbackRequestIdRef.current) return

        if (Hls.isSupported()) {
          const hls = new Hls({
            backBufferLength: 90,
            enableWorker: true,
            lowLatencyMode: true,
          })

          hlsRef.current = hls

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (hlsRef.current !== hls) return
            if (!data.fatal) return

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad()
              return
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError()
              return
            }

            if (hlsRef.current === hls) hlsRef.current = null
            hls.destroy()
            setStatus('error')
          })

          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            if (playbackRequestId !== playbackRequestIdRef.current || hlsRef.current !== hls) return
            hls.loadSource(playbackUrl)
          })

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (playbackRequestId !== playbackRequestIdRef.current) return
            requestAudioPlayback(audio, playbackRequestId)
          })

          hls.attachMedia(audio)
          requestAudioPlayback(audio, playbackRequestId)
          return
        }
      } catch {
        // Fall back to native HLS below when hls.js cannot load.
      }

      if (playbackRequestId !== playbackRequestIdRef.current) return

      if (!canPlayHlsNatively(audio)) {
        setStatus('error')
        return
      }

      audio.src = playbackUrl
      audio.load()
      requestAudioPlayback(audio, playbackRequestId)
      return
    }

    if (audio.getAttribute('src') !== playbackUrl) {
      audio.src = playbackUrl
      audio.load()
    }

    requestAudioPlayback(audio, playbackRequestId)
  }

  function destroyHlsPlayer() {
    if (!hlsRef.current) return
    hlsRef.current.destroy()
    hlsRef.current = null
  }

  function requestAudioPlayback(audio: HTMLAudioElement, playbackRequestId: number) {
    audio.play().catch((error) => {
      if (playbackRequestId !== playbackRequestIdRef.current) return
      if (isUserActivationPlaybackError(error)) {
        setStatus('paused')
        return
      }
      setStatus('error')
    })
  }

  function togglePlayback() {
    if (status === 'playing' || status === 'loading') {
      pausePlayback()
      return
    }

    resumeCurrentStation()
  }

  function pausePlayback() {
    const audio = audioRef.current
    if (!audio) return

    audio.pause()
    setStatus('paused')
  }

  function resumeCurrentStation() {
    const audio = audioRef.current
    if (!audio || !currentStation) return

    if (
      audio.currentSrc &&
      (status === 'paused' || status === 'error') &&
      audioStationIdRef.current === currentStation.id
    ) {
      setStatus('loading')
      requestAudioPlayback(audio, playbackRequestIdRef.current)
      return
    }

    playStation(currentStation)
  }

  function moveStation(direction: 1 | -1) {
    if (stations.length === 0) return

    const currentIndex = stations.findIndex((station) => station.id === currentStation?.id)
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : stations.length - 1
        : (currentIndex + direction + stations.length) % stations.length
    playStation(stations[nextIndex])
  }

  function choosePlaylist(event: ChangeEvent<HTMLSelectElement>) {
    setSelectedPlaylistId(event.target.value)
    setQuery('')
  }

  function toggleFavorite(station: Station) {
    setFavoriteStations((current) => {
      const key = station.url.toLowerCase()
      if (current.some((favorite) => favorite.url.toLowerCase() === key)) {
        return current.filter((favorite) => favorite.url.toLowerCase() !== key)
      }

      return mergeStations(current, [{ ...station, favorite: true }])
    })
  }

  function removeStation(stationId: string) {
    if (!canEditActivePlaylist) return

    setFavoriteStations((current) => {
      const nextStations = current.filter((station) => station.id !== stationId)
      if (stationId === currentStationId && nextStations.length > 0) {
        setCurrentStationId(nextStations[0].id)
      }

      return nextStations
    })
  }

  function beginStationDrag(event: ReactPointerEvent<HTMLButtonElement>, stationId: string) {
    if (!canEditActivePlaylist) return

    event.preventDefault()
    event.stopPropagation()
    cleanupStationDragRef.current?.()

    const pointerId = event.pointerId
    draggingStationIdRef.current = stationId
    setDraggingStationId(stationId)
    document.body.classList.add('station-reordering')

    const moveDraggedStation = (clientY: number) => {
      const draggedStationId = draggingStationIdRef.current
      if (!draggedStationId) return

      const target = getStationDropTarget(clientY)
      if (!target || target.stationId === draggedStationId) return

      moveStationToTarget(draggedStationId, target.stationId, target.placement)
    }

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return

      moveEvent.preventDefault()
      moveDraggedStation(moveEvent.clientY)
    }

    const stopDrag = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerEnd)
      document.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('blur', stopDrag)
      document.body.classList.remove('station-reordering')
      draggingStationIdRef.current = null
      cleanupStationDragRef.current = null
      setDraggingStationId(null)
    }

    const handlePointerEnd = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId === pointerId) stopDrag()
    }

    document.addEventListener('pointermove', handlePointerMove, { passive: false })
    document.addEventListener('pointerup', handlePointerEnd)
    document.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', stopDrag)
    cleanupStationDragRef.current = stopDrag
  }

  function moveStationWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, stationId: string) {
    if (!canEditActivePlaylist) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return

    event.preventDefault()
    const currentIndex = filteredStations.findIndex((station) => station.id === stationId)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const targetStation = filteredStations[currentIndex + direction]
    if (!targetStation) return

    moveStationToTarget(stationId, targetStation.id, direction === 1 ? 'after' : 'before')
  }

  function getStationDropTarget(clientY: number): { placement: 'before' | 'after'; stationId: string } | null {
    const rows = [...(stationListRef.current?.querySelectorAll<HTMLElement>('[data-station-id]') ?? [])]
    if (rows.length === 0) return null

    for (const row of rows) {
      const stationId = row.dataset.stationId
      if (!stationId) continue

      const box = row.getBoundingClientRect()
      if (clientY < box.top + box.height / 2) return { placement: 'before', stationId }
    }

    const lastStationId = rows[rows.length - 1]?.dataset.stationId
    return lastStationId ? { placement: 'after', stationId: lastStationId } : null
  }

  function moveStationToTarget(
    draggedStationId: string,
    targetStationId: string,
    placement: 'before' | 'after',
  ) {
    if (!canEditActivePlaylist) return

    setFavoriteStations((current) => {
      if (draggedStationId === targetStationId) return current

      const draggedStation = current.find((station) => station.id === draggedStationId)
      if (!draggedStation) return current

      const withoutDragged = current.filter((station) => station.id !== draggedStationId)
      const targetIndex = withoutDragged.findIndex((station) => station.id === targetStationId)
      if (targetIndex === -1) return current

      const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex
      const next = [...withoutDragged]
      next.splice(insertIndex, 0, draggedStation)

      const orderChanged = next.some((station, index) => station.id !== current[index]?.id)
      if (!orderChanged) return current

      return next
    })
  }

  function importStations(mode: 'append' | 'replace') {
    const parsed = parseStationList(importText)
    if (parsed.stations.length === 0) {
      setImportSummary(
        parsed.format === 'HLS media playlist'
          ? 'This looks like an HLS media playlist. Add its playlist.m3u8 URL as a station instead of importing the playlist file contents.'
          : 'No playable stations found.',
      )
      return
    }

    setSelectedPlaylistId(FAVORITES_PLAYLIST_ID)
    setFavoriteStations((current) => {
      const incoming = parsed.stations.map((station) => ({ ...station, favorite: true }))
      const merged = mode === 'replace' ? incoming : mergeStations(current, incoming)
      if (!merged.some((station) => station.id === currentStationId)) {
        setCurrentStationId(merged[0]?.id ?? '')
      }
      return merged
    })

    setImportSummary(
      `${mode === 'replace' ? 'Loaded' : 'Added'} ${parsed.stations.length} station${
        parsed.stations.length === 1 ? '' : 's'
      } to favorites from ${parsed.format}${parsed.rejectedLines ? `; skipped ${parsed.rejectedLines} line(s)` : ''}.`,
    )
  }

  function handleFileImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    void file.text().then((text) => {
      setImportText(text)
      setImportSummary(`Loaded ${file.name}. Choose append or replace.`)
    })

    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return

    void file.text().then((text) => {
      setImportText(text)
      setImportSummary(`Loaded ${file.name}. Choose append or replace.`)
    })
  }

  function addStation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!addName.trim() || !addUrl.trim()) return

    const station = createStation(addName, addUrl)
    setSelectedPlaylistId(FAVORITES_PLAYLIST_ID)
    setFavoriteStations((current) => mergeStations(current, [{ ...station, favorite: true }]))
    setCurrentStationId(station.id)
    setAddName('')
    setAddUrl('')
    setImportSummary(`Added ${station.name}.`)
  }

  function downloadPlaylist() {
    const playlist = exportYoRadioPlaylist(stations)
    const blob = new Blob([playlist], { type: 'text/tab-separated-values;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = href
    anchor.download = `${downloadNameFromTitle(selectedPlaylistTitle)}.csv`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src="/wadsworth-logo.png" alt="" />
          </span>
          <div>
            <h1>WadsRadio</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <WadsThemeSwitch value={themeMode} onChange={setThemeMode} />
          <button className="icon-button" type="button" title="Import stations" onClick={() => setImportOpen(true)}>
            <Upload size={19} />
          </button>
          <button className="icon-button" type="button" title="Export YoRadio playlist.csv" onClick={downloadPlaylist}>
            <Download size={19} />
          </button>
        </div>
      </header>

      <main className="radio-layout">
        <section className="now-playing" aria-label="Now playing">
          <div className={`art-stage ${mediaDisplay.artwork ? 'has-artwork' : 'no-artwork'}`}>
            {mediaDisplay.artwork ? (
              <>
                <img className="art-backdrop" src={mediaDisplay.artwork} alt="" />
                <img className="art-cover" src={mediaDisplay.artwork} alt="" />
              </>
            ) : (
              <div className="art-fallback" aria-hidden="true">
                <div className="art-fallback-mark">
                  <Music2 size={36} />
                </div>
                <div>
                  <span>{mediaDisplay.label}</span>
                  <strong>{mediaDisplay.title}</strong>
                  <em>{mediaDisplay.subtitle}</em>
                </div>
              </div>
            )}
            <div className="signal-panel">
              <span className={`status-dot ${status}`} aria-hidden="true" />
              <span>{capitalize(statusLabel)}</span>
            </div>
            {mediaInfo?.bitrate && <div className="bitrate-panel">{mediaInfo.bitrate}</div>}
          </div>

          <div className="player-copy">
            <div className="eyebrow station-name">{stationDisplayName}</div>
            <h2>{currentStation?.name ?? 'No station selected'}</h2>
            <p>{stationSubheading}</p>
          </div>

          <section className="media-card" aria-label="Current media information" aria-live="polite">
            <div className="media-card-header">
              {mediaDisplay.artwork ? (
                <img className="media-artwork" src={mediaDisplay.artwork} alt="" />
              ) : (
                <div className="media-icon" aria-hidden="true">
                  <Music2 size={20} />
                </div>
              )}
              <div className="media-title-wrap">
                <div className="eyebrow">{mediaDisplay.label}</div>
                <h3>{mediaDisplay.title}</h3>
                <p>{mediaDisplay.subtitle}</p>
              </div>
              <button
                className={`icon-button small metadata-refresh ${metadataStatus === 'loading' ? 'spinning' : ''}`}
                type="button"
                title="Refresh media info"
                onClick={() => setMetadataRefreshToken((value) => value + 1)}
              >
                <RefreshCw size={16} />
              </button>
            </div>

            <dl className="media-facts">
              {mediaFacts.map((fact) => (
                <div className={fact.wide ? 'media-fact wide' : 'media-fact'} key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>
                    <span>{fact.value}</span>
                    {fact.detail && <small>{fact.detail}</small>}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="metadata-note">
              <Info size={15} aria-hidden="true" />
              <span>{mediaDisplay.note}</span>
            </div>
          </section>

          <div className="transport" aria-label="Playback controls">
            <button className="icon-button control" type="button" title="Previous station" onClick={() => moveStation(-1)}>
              <SkipBack size={22} />
            </button>
            <button className="play-button" type="button" title={status === 'playing' ? 'Pause' : 'Play'} onClick={togglePlayback}>
              {status === 'playing' || status === 'loading' ? <Pause size={27} /> : <Play size={29} />}
            </button>
            <button className="icon-button control" type="button" title="Next station" onClick={() => moveStation(1)}>
              <SkipForward size={22} />
            </button>
          </div>

          <label className="volume-control">
            <Volume2 size={19} aria-hidden="true" />
            <input
              aria-label="Volume"
              max="1"
              min="0"
              step="0.01"
              type="range"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <span>{Math.round(volume * 100)}%</span>
          </label>

          <audio
            ref={audioRef}
            preload="none"
            onEnded={() => moveStation(1)}
            onError={() => {
              if (!hlsRef.current) setStatus('error')
            }}
            onPause={() => setStatus((current) => (current === 'error' ? current : 'paused'))}
            onPlaying={() => setStatus('playing')}
            onWaiting={() => setStatus('loading')}
          />
        </section>

        <section className="library" aria-label="Station library">
          <div className="library-header">
            <div className="playlist-heading">
              <div className="eyebrow">Library</div>
              <h2>{selectedPlaylistTitle}</h2>
              <p>{stations.length} station{stations.length === 1 ? '' : 's'}</p>
            </div>
            <label className="playlist-picker">
              <ListMusic size={18} aria-hidden="true" />
              <span className="sr-only">Station list</span>
              <select value={selectedPlaylistId} onChange={choosePlaylist}>
                {!selectedPlaylistId && <option value="">Loading lists</option>}
                <option value={FAVORITES_PLAYLIST_ID}>Favorites ({favoritesCount})</option>
                {stationLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title} ({list.stationCount})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search current list" />
          </label>

          <div className="station-list" ref={stationListRef} role="list">
            {filteredStations.map((station) => {
              const isCurrent = station.id === currentStation?.id
              const isPlaying = isCurrent && status === 'playing'
              const stationLogo = getStationLogo(station)

              return (
                <article
                  className={`station-row ${isCurrent ? 'selected' : ''} ${
                    draggingStationId === station.id ? 'dragging' : ''
                  }`}
                  data-station-id={station.id}
                  key={station.id}
                  role="listitem"
                >
                  <button
                    className="drag-handle"
                    disabled={!canEditActivePlaylist}
                    type="button"
                    title={canEditActivePlaylist ? 'Reorder station' : 'Playlist file controls this order'}
                    aria-label={`Reorder ${station.name}`}
                    onKeyDown={(event) => moveStationWithKeyboard(event, station.id)}
                    onPointerDown={(event) => beginStationDrag(event, station.id)}
                  >
                    <GripVertical size={17} />
                  </button>
                  <button className="station-main" type="button" onClick={() => playStation(station)}>
                    <span className="station-logo" aria-hidden="true" style={{ '--logo-accent': stationLogo.accent } as CSSProperties}>
                      <span>{stationLogo.initials}</span>
                      {stationLogo.url && (
                        <img
                          src={stationLogo.url}
                          alt=""
                          loading="lazy"
                          onLoad={(event) => {
                            const image = event.currentTarget
                            if (isLowQualityFavicon(image.src, image.naturalWidth)) {
                              image.remove()
                            }
                          }}
                          onError={(event) => {
                            event.currentTarget.remove()
                          }}
                        />
                      )}
                    </span>
                    <span>
                      <strong>{station.name}</strong>
                      <small>{station.url}</small>
                    </span>
                  </button>
                  <div className="station-actions">
                    <button
                      className={`icon-button small ${station.favorite ? 'liked' : ''}`}
                      type="button"
                      title={station.favorite ? 'Remove from favorites' : 'Add to favorites'}
                      onClick={() => toggleFavorite(station)}
                    >
                      <Heart size={17} fill={station.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button className="icon-button small" type="button" title={isPlaying ? 'Pause station' : 'Play station'} onClick={() => (isPlaying ? togglePlayback() : playStation(station))}>
                      {isPlaying ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                    {canEditActivePlaylist && (
                      <button className="icon-button small danger" type="button" title="Remove station" onClick={() => removeStation(station.id)}>
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {filteredStations.length === 0 && (
            <div className="empty-state">
              <ListMusic size={28} />
              <p>{effectivePlaylistStatus === 'loading' ? 'Loading station list.' : effectivePlaylistError || 'No stations match this view.'}</p>
            </div>
          )}
        </section>
      </main>

      {importOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setImportOpen(false)}>
          <section
            aria-label="Import stations"
            aria-modal="true"
            className="import-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <div>
                <div className="eyebrow">YoRadio compatible</div>
                <h2>Import stations</h2>
              </div>
              <button className="icon-button small" type="button" title="Close" onClick={() => setImportOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onClick={() => importFileRef.current?.click()}
            >
              <FileUp size={24} />
              <span>Drop a YoRadio playlist.csv, WebStations.txt, station M3U/M3U8, or PLS file here.</span>
              <input
                ref={importFileRef}
                accept=".csv,.txt,.m3u,.m3u8,.pls,.json"
                hidden
                onChange={handleFileImport}
                type="file"
              />
            </div>

            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'Paste rows like:\nStation name\\thttps://stream.example/radio\\t0\nHLS Station\\thttps://stream.example/playlist.m3u8\\t0'}
            />

            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => importStations('append')}>
                Append to favorites
              </button>
              <button className="primary-button" type="button" onClick={() => importStations('replace')}>
                Replace favorites
              </button>
            </div>

            <form className="add-station" onSubmit={addStation}>
              <div className="eyebrow">Add one favorite</div>
              <label>
                Name
                <input value={addName} onChange={(event) => setAddName(event.target.value)} placeholder="Station name" />
              </label>
              <label>
                Stream URL
                <input value={addUrl} onChange={(event) => setAddUrl(event.target.value)} placeholder="https://..." />
              </label>
              <button className="secondary-button" type="submit">
                <Plus size={17} />
                Add
              </button>
            </form>

            {importSummary && <p className="import-summary">{importSummary}</p>}
          </section>
        </div>
      )}
    </div>
  )
}

function loadSelectedPlaylistId(): string {
  return localStorage.getItem(SELECTED_PLAYLIST_STORAGE_KEY) ?? ''
}

function loadFavoriteStations(): Station[] {
  try {
    const saved = localStorage.getItem(FAVORITE_STATIONS_STORAGE_KEY)
    const parsed = saved ? (JSON.parse(saved) as Station[]) : null
    if (Array.isArray(parsed) && parsed.length > 0) {
      return sanitizeFavoriteStations(parsed)
    }
  } catch {
    // Ignore malformed local storage and try the legacy station library.
  }

  try {
    const saved = localStorage.getItem(LEGACY_STATIONS_STORAGE_KEY)
    const parsed = saved ? (JSON.parse(saved) as Station[]) : null
    if (Array.isArray(parsed) && parsed.length > 0) {
      const favorites = parsed.filter((station) => station.favorite)
      if (favorites.length > 0) return sanitizeFavoriteStations(favorites)
    }
  } catch {
    // Ignore malformed legacy local storage and fall back to starter favorites.
  }

  return sanitizeFavoriteStations(DEFAULT_STATIONS.filter((station) => station.favorite))
}

function sanitizeFavoriteStations(stations: Station[]): Station[] {
  return stations
    .filter((station) => station.name && station.url)
    .map((station) => ({ ...station, favorite: true, logoUrl: normalizeStationLogoUrl(station.logoUrl) || undefined }))
}

function loadVolume(): number {
  const saved = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '')
  if (Number.isFinite(saved)) return Math.max(0, Math.min(1, saved))
  return 0.82
}

function loadLastStationId(): string {
  return localStorage.getItem(LAST_STATION_STORAGE_KEY) ?? ''
}

function isHlsStreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const combined = `${parsed.pathname}${parsed.search}`.toLowerCase()
    return /\.m3u8(?:[?#]|$)/i.test(combined) || combined.includes('m3u8')
  } catch {
    return /\.m3u8(?:[?#]|$)/i.test(url)
  }
}

function canPlayHlsNatively(audio: HTMLAudioElement): boolean {
  return Boolean(audio.canPlayType('application/vnd.apple.mpegurl') || audio.canPlayType('application/x-mpegURL'))
}

function toHlsProxyUrl(url: string): string {
  return `/api/hls?url=${encodeURIComponent(url)}`
}

function isUserActivationPlaybackError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

function updateMediaSessionMetadata(
  metadata: MediaInfo | null,
  station: Station,
  mediaDisplay: ReturnType<typeof getMediaDisplay>,
  stationDisplayName: string,
  stationSubheading: string,
  status: PlaybackStatus,
) {
  if (!supportsMediaSession()) return

  const artist = metadata?.artist || stationDisplayName || station.name
  const album = metadata?.album || stationSubheading || station.name

  setMediaSessionPlaybackState(status)

  if (typeof window.MediaMetadata !== 'function') return

  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: mediaDisplay.title || station.name,
      artist,
      album,
      artwork: getMediaSessionArtwork(mediaDisplay.artwork),
    })
  } catch {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: mediaDisplay.title || station.name,
      artist,
      album,
    })
  }
}

function setMediaSessionPlaybackState(status: PlaybackStatus) {
  if (!supportsMediaSession()) return

  if (status === 'playing' || status === 'loading') {
    navigator.mediaSession.playbackState = 'playing'
    return
  }

  navigator.mediaSession.playbackState = status === 'paused' ? 'paused' : 'none'
}

function getMediaSessionArtwork(artwork: string): MediaImage[] {
  if (artwork) return [{ src: artwork }]

  return [
    { src: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
    { src: '/favicon.png', sizes: '512x512', type: 'image/png' },
  ]
}

function setMediaSessionAction(action: MediaSessionAction, handler: MediaSessionActionHandler) {
  if (!supportsMediaSession()) return

  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // Some browsers expose Media Session but reject individual actions.
  }
}

function clearMediaSessionActions() {
  if (!supportsMediaSession()) return

  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop'] as const) {
    try {
      navigator.mediaSession.setActionHandler(action, null)
    } catch {
      // Ignore unsupported actions during teardown.
    }
  }
}

function clearMediaSessionMetadata() {
  if (!supportsMediaSession()) return

  navigator.mediaSession.metadata = null
  navigator.mediaSession.playbackState = 'none'
}

function supportsMediaSession(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

function mergeStations(current: Station[], incoming: Station[]): Station[] {
  const seen = new Set(current.map((station) => station.url.toLowerCase()))
  const additions = incoming.filter((station) => {
    const key = station.url.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return [...current, ...additions]
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function downloadNameFromTitle(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'wadsradio-playlist'
  )
}

function hasUsefulMetadata(metadata: MediaInfo | null): boolean {
  if (!metadata) return false
  return Boolean(
    metadata.title ||
      metadata.artist ||
      metadata.streamTitle ||
      metadata.stationName ||
      metadata.genre ||
      metadata.bitrate ||
      metadata.contentType,
  )
}

function getStationSubheading(metadata: MediaInfo | null, station: Station): string {
  const showName = metadata?.showName?.trim()
  const hosts = metadata?.hostNames?.filter(Boolean).join(', ')

  if (showName && hosts) return `${showName} with ${hosts}`
  if (showName) return showName
  if (hosts) return `Hosted by ${hosts}`
  if (metadata?.description) return metadata.description
  if (metadata?.genre) return metadata.genre

  return station.url || 'Import a YoRadio playlist to begin.'
}

function getMediaDisplay(
  metadata: MediaInfo | null,
  station: Station,
  metadataStatus: MetadataStatus,
): { artwork: string; label: string; note: string; subtitle: string; title: string } {
  const artwork = metadata?.artwork || metadata?.thumbnail || ''

  if (metadataStatus === 'loading') {
    return {
      artwork,
      label: 'Reading stream',
      title: metadata?.title || metadata?.streamTitle || 'Tuning metadata',
      subtitle: station.name,
      note: 'Reading ICY/Shoutcast headers and current track data from the stream.',
    }
  }

  if (metadata?.title || metadata?.streamTitle) {
    return {
      artwork,
      label: 'Now playing',
      title: metadata.title || metadata.streamTitle || station.name,
      subtitle: metadata.artist || metadata.album || metadata.stationName || metadata.genre || station.name,
      note: formatMetadataNote(metadata),
    }
  }

  if (hasUsefulMetadata(metadata)) {
    return {
      artwork,
      label: 'Stream info',
      title: metadata?.stationName || station.name,
      subtitle: metadata?.description || metadata?.genre || 'Track title is not published by this stream.',
      note: formatMetadataNote(metadata),
    }
  }

  return {
    artwork,
    label: 'Stream info',
    title: station.name,
    subtitle: metadata?.error || 'This station is not publishing track metadata right now.',
    note: 'Some streams only expose audio and do not publish artist or title fields.',
  }
}

function getMediaFacts(metadata: MediaInfo | null): Array<{ detail?: string; label: string; value: string; wide?: boolean }> {
  const facts: Array<{ detail?: string; label: string; value: string; wide?: boolean }> = []

  if (metadata?.album) {
    const albumDetail = [metadata.labels?.join(', '), metadata.releaseDate ? formatReleaseDate(metadata.releaseDate) : '']
      .filter(Boolean)
      .join(' · ')

    facts.push({
      detail: albumDetail,
      label: 'Album',
      value: metadata.album,
      wide: true,
    })
  }

  if (metadata?.homepage) facts.push({ label: 'Homepage', value: metadata.homepage, wide: true })
  if (metadata?.description && metadata.description !== metadata.stationName) {
    facts.push({ label: 'Description', value: metadata.description, wide: true })
  }

  return facts
}

function getStationLogo(station: Station): { accent: string; initials: string; url: string } {
  const curatedLogoUrl = normalizeStationLogoUrl(station.logoUrl) || getCuratedStationLogoUrl(station)
  const domain = getStationLogoDomain(station)

  return {
    accent: getStationAccent(station),
    initials: getStationInitials(station.name),
    url: curatedLogoUrl || (domain ? `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${domain}`)}&sz=128` : ''),
  }
}

function normalizeStationLogoUrl(value: unknown): string {
  const cleanValue = String(value ?? '').trim()
  if (!cleanValue) return ''
  return /^(https?:\/\/|data:image\/|\/)/i.test(cleanValue) ? cleanValue : ''
}

function getCuratedStationLogoUrl(station: Station): string {
  const searchable = `${station.name} ${station.url}`.toLowerCase()
  const logo = CURATED_STATION_LOGOS.find(({ pattern }) => pattern.test(searchable))
  return logo?.url ?? ''
}

const CURATED_STATION_LOGOS: Array<{ pattern: RegExp; url: string }> = [
  { pattern: /\bcbc\b|cbcradiolive|cfykfm_cbc/i, url: '/station-logos/cbc.svg' },
  { pattern: /\bici (premiere|musique)\b|radio-canada|rcavliveaudio/i, url: '/station-logos/radio-canada.svg' },
  { pattern: /\bbbc\b|bbc_/i, url: '/station-logos/bbc.svg' },
  { pattern: /\bnpr\b/i, url: '/station-logos/npr.svg' },
  { pattern: /\bkexp\b/i, url: '/station-logos/kexp.svg' },
  { pattern: /\bkuow\b/i, url: '/station-logos/kuow.svg' },
  { pattern: /\bjazz24\b/i, url: '/station-logos/jazz24.svg' },
  { pattern: /\bknkx\b/i, url: '/station-logos/knkx.svg' },
  { pattern: /\bking fm\b|classicalking/i, url: '/station-logos/king-fm.svg' },
  { pattern: /\bkcrw\b/i, url: '/station-logos/kcrw.svg' },
  { pattern: /\blaist\b|kpcc/i, url: '/station-logos/laist.svg' },
  { pattern: /\bwnyc\b/i, url: '/station-logos/wnyc.svg' },
  { pattern: /\bwqxr\b|new sounds/i, url: '/station-logos/wqxr.svg' },
  { pattern: /\bkqed\b/i, url: '/station-logos/kqed.svg' },
  { pattern: /\bopb\b/i, url: '/station-logos/opb.svg' },
  { pattern: /\brthk\b/i, url: '/station-logos/rthk.svg' },
  { pattern: /\bmetro (finance|info|plus)\b/i, url: '/station-logos/metro-radio.svg' },
  { pattern: /\baxr\b/i, url: '/station-logos/axr.svg' },
  { pattern: /\bmediacorp\b/i, url: '/station-logos/mediacorp.svg' },
  { pattern: /\bmoney fm\b|money_893/i, url: '/station-logos/money-fm.svg' },
  { pattern: /\bone fm\b|one_fm_913/i, url: '/station-logos/one-fm.svg' },
  { pattern: /\bufm ?100\.?3\b|ufm_1003/i, url: '/station-logos/ufm.svg' },
  { pattern: /\bhao fm\b|hao_963/i, url: '/station-logos/hao-fm.svg' },
  { pattern: /\bpower ?98\b|power98/i, url: '/station-logos/power98.svg' },
  { pattern: /\b88\.?3 ?jia\b|883jia|harrys_s02/i, url: '/station-logos/jia883.svg' },
  { pattern: /\bfip\b/i, url: '/station-logos/fip.svg' },
  { pattern: /\bfrance (inter|info|culture|musique|bleu)\b|\bici paris\b|\bmouv\b|radiofrance/i, url: '/station-logos/radio-france.svg' },
  { pattern: /\brfi\b/i, url: '/station-logos/rfi.svg' },
  { pattern: /\brtl2?\b/i, url: '/station-logos/rtl.svg' },
  { pattern: /\beurope [12]\b/i, url: '/station-logos/europe1.svg' },
  { pattern: /\bnrj\b|nostalgie|cherie fm|rire et chansons/i, url: '/station-logos/nrj.svg' },
  { pattern: /\bvirgin radio\b/i, url: '/station-logos/virgin.svg' },
  { pattern: /\bcapital\b/i, url: '/station-logos/capital.svg' },
  { pattern: /\bheart\b/i, url: '/station-logos/heart.svg' },
  { pattern: /\bsmooth\b/i, url: '/station-logos/smooth.svg' },
  { pattern: /\bclassic fm\b/i, url: '/station-logos/classic-fm.svg' },
  { pattern: /\blbc\b/i, url: '/station-logos/lbc.svg' },
  { pattern: /\babsolute\b/i, url: '/station-logos/absolute.svg' },
  { pattern: /\bkiss(tory|92)?\b|kiss_92/i, url: '/station-logos/kiss.svg' },
  { pattern: /\bsomafm\b|soma fm|groove salad/i, url: '/station-logos/somafm.svg' },
  { pattern: /\bradio paradise\b|radioparadise/i, url: '/station-logos/radio-paradise.svg' },
  { pattern: /\bwfmu\b/i, url: '/station-logos/wfmu.svg' },
]

function getStationLogoDomain(station: Station): string {
  const searchable = `${station.name} ${station.url}`.toLowerCase()
  const knownDomains = [
    { domain: 'somafm.com', pattern: /\b(somafm|soma fm|groove salad)\b/ },
    { domain: 'kexp.org', pattern: /\bkexp\b/ },
    { domain: 'radioparadise.com', pattern: /\b(radio paradise|radioparadise)\b/ },
    { domain: 'wfmu.org', pattern: /\bwfmu\b/ },
    { domain: 'radiofrance.fr', pattern: /\b(fip|radiofrance|radio france)\b/ },
  ]

  const known = knownDomains.find(({ pattern }) => pattern.test(searchable))
  if (known) return known.domain

  try {
    const hostname = new URL(station.url).hostname.replace(/^www\./, '')
    return isGenericStreamHost(hostname) ? '' : hostname
  } catch {
    return ''
  }
}

function isGenericStreamHost(hostname: string): boolean {
  return isIpAddressHost(hostname) || GENERIC_STREAM_HOSTS.some((pattern) => pattern.test(hostname))
}

function isLowQualityFavicon(src: string, naturalWidth: number): boolean {
  return /google\.com\/s2\/favicons/i.test(src) && naturalWidth > 0 && naturalWidth <= 32
}

function isIpAddressHost(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || /^\[[0-9a-f:]+\]$/i.test(hostname)
}

const GENERIC_STREAM_HOSTS = [
  /(^|\.)akamaized\.net$/,
  /(^|\.)amperwave\.net$/,
  /(^|\.)asurahosting\.com$/,
  /(^|\.)audiocdn\.com$/,
  /(^|\.)cdn77\.org$/,
  /(^|\.)cdnstream1\.com$/,
  /(^|\.)cloudfront\.net$/,
  /(^|\.)creacast\.com$/,
  /(^|\.)hellorayo\.co\.uk$/,
  /(^|\.)icecast\./,
  /(^|\.)infomaniak\.ch$/,
  /(^|\.)jpbgdigital\.com$/,
  /(^|\.)leanstream\.co$/,
  /(^|\.)live365\.com$/,
  /(^|\.)liveboxstream\.uk$/,
  /(^|\.)live\.streamtheworld\.com$/,
  /(^|\.)musicradio\.com$/,
  /(^|\.)onestreaming\.com$/,
  /(^|\.)playerservices\.streamtheworld\.com$/,
  /(^|\.)planetradio\.co\.uk$/,
  /(^|\.)radiojar\.com$/,
  /(^|\.)radioking\.com$/,
  /(^|\.)radioboss\.fm$/,
  /(^|\.)rcs\.revma\.com$/,
  /(^|\.)revma\./,
  /(^|\.)securenetsystems\.net$/,
  /(^|\.)sharp-stream\.com$/,
  /(^|\.)streamb\.live$/,
  /(^|\.)streamguys\d*\.com$/,
  /(^|\.)streamlock\.net$/,
  /(^|\.)streamon\.fm$/,
  /(^|\.)streeemer\.com$/,
  /(^|\.)tunein\.cdnstream1\.com$/,
]

function getStationInitials(name: string): string {
  const words = name
    .replace(/[^a-z0-9 ]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return 'R'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

function getStationAccent(station: Station): string {
  const source = station.id || station.name
  let hash = 0

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index)
    hash |= 0
  }

  const colors = ['#ffbf47', '#33d6a6', '#ff7a45', '#8fb8ff', '#f2d27a', '#c69cff']
  return colors[Math.abs(hash) % colors.length]
}

function formatMetadataNote(metadata: MediaInfo | null): string {
  const source = metadata?.provider
    ? ` via ${metadata.provider}`
    : metadata?.artworkProvider
      ? ` with art from ${metadata.artworkProvider}`
      : ''
  const timestamp = metadata?.playedAt || metadata?.fetchedAt
  return timestamp ? `Updated ${formatTime(timestamp)}${source}.` : `Live stream metadata loaded${source}.`
}

function formatReleaseDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.getUTCFullYear().toString()
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'just now'

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default App
