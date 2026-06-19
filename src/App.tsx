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
import type Hls from 'hls.js'
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

const STATIONS_STORAGE_KEY = 'wadsradio.stations.v1'
const VOLUME_STORAGE_KEY = 'wadsradio.volume.v1'
const LAST_STATION_STORAGE_KEY = 'wadsradio.lastStation.v1'
const THEME_STORAGE_KEY = 'wadsradio.theme.v1'

type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
type MetadataStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

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
  const draggingStationIdRef = useRef<string | null>(null)
  const playbackRequestIdRef = useRef(0)
  const cleanupStationDragRef = useRef<(() => void) | null>(null)
  const [stations, setStations] = useState<Station[]>(() => loadStations())
  const [currentStationId, setCurrentStationId] = useState(() => loadLastStationId())
  const [query, setQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
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

  const currentStation =
    stations.find((station) => station.id === currentStationId) ?? stations[0] ?? DEFAULT_STATIONS[0]

  const filteredStations = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()

    return stations.filter((station) => {
      const matchesFavorite = !showFavoritesOnly || station.favorite
      const matchesQuery =
        !cleanQuery ||
        station.name.toLowerCase().includes(cleanQuery) ||
        station.url.toLowerCase().includes(cleanQuery)

      return matchesFavorite && matchesQuery
    })
  }, [query, showFavoritesOnly, stations])

  const favoritesCount = stations.filter((station) => station.favorite).length
  const statusLabel = status === 'loading' ? 'Tuning' : status === 'error' ? 'Could not play' : status
  const mediaDisplay = getMediaDisplay(mediaInfo, currentStation, metadataStatus)
  const mediaFacts = getMediaFacts(mediaInfo)
  const stationDisplayName = mediaInfo?.stationName || currentStation?.name || 'Station'
  const stationSubheading = getStationSubheading(mediaInfo, currentStation)

  useEffect(() => {
    localStorage.setItem(STATIONS_STORAGE_KEY, JSON.stringify(stations))
  }, [stations])

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

    setCurrentStationId(station.id)
    setStatus('loading')
    audio.volume = volume

    destroyHlsPlayer()

    const isHlsStation = isHlsStreamUrl(station.url)
    const playbackUrl = isHlsStation ? toHlsProxyUrl(station.url) : station.url

    if (isHlsStation && !canPlayHlsNatively(audio)) {
      audio.removeAttribute('src')
      audio.load()

      try {
        const { default: Hls } = await import('hls.js')
        if (playbackRequestId !== playbackRequestIdRef.current) return

        if (!Hls.isSupported()) {
          setStatus('error')
          return
        }

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
          audio.play().catch(() => {
            if (playbackRequestId === playbackRequestIdRef.current) setStatus('error')
          })
        })

        hls.attachMedia(audio)
      } catch {
        if (playbackRequestId === playbackRequestIdRef.current) setStatus('error')
      }

      return
    }

    if (audio.getAttribute('src') !== playbackUrl) {
      audio.src = playbackUrl
      audio.load()
    }

    audio.play().catch(() => {
      if (playbackRequestId === playbackRequestIdRef.current) setStatus('error')
    })
  }

  function destroyHlsPlayer() {
    if (!hlsRef.current) return
    hlsRef.current.destroy()
    hlsRef.current = null
  }

  function togglePlayback() {
    const audio = audioRef.current
    if (!audio || !currentStation) return

    if (status === 'playing' || status === 'loading') {
      audio.pause()
      setStatus('paused')
      return
    }

    playStation(currentStation)
  }

  function moveStation(direction: 1 | -1) {
    if (stations.length === 0) return

    const currentIndex = Math.max(
      0,
      stations.findIndex((station) => station.id === currentStation?.id),
    )
    const nextIndex = (currentIndex + direction + stations.length) % stations.length
    playStation(stations[nextIndex])
  }

  function toggleFavorite(stationId: string) {
    setStations((current) =>
      current.map((station) =>
        station.id === stationId ? { ...station, favorite: !station.favorite } : station,
      ),
    )
  }

  function removeStation(stationId: string) {
    setStations((current) => {
      const nextStations = current.filter((station) => station.id !== stationId)
      if (stationId === currentStationId && nextStations.length > 0) {
        setCurrentStationId(nextStations[0].id)
      }

      return nextStations.length > 0 ? nextStations : DEFAULT_STATIONS
    })
  }

  function beginStationDrag(event: ReactPointerEvent<HTMLButtonElement>, stationId: string) {
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
    setStations((current) => {
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

    setStations((current) => {
      const merged = mode === 'replace' ? parsed.stations : mergeStations(current, parsed.stations)
      if (!merged.some((station) => station.id === currentStationId)) {
        setCurrentStationId(merged[0]?.id ?? '')
      }
      return merged
    })

    setImportSummary(
      `${mode === 'replace' ? 'Loaded' : 'Added'} ${parsed.stations.length} station${
        parsed.stations.length === 1 ? '' : 's'
      } from ${parsed.format}${parsed.rejectedLines ? `; skipped ${parsed.rejectedLines} line(s)` : ''}.`,
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
    setStations((current) => mergeStations(current, [station]))
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
    anchor.download = 'playlist.csv'
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
            onCanPlay={() => setStatus('playing')}
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
            <div>
              <div className="eyebrow">Library</div>
              <h2>{stations.length} stations</h2>
            </div>
            <div className="segmented" aria-label="Library filter">
              <button type="button" className={!showFavoritesOnly ? 'active' : ''} onClick={() => setShowFavoritesOnly(false)}>
                All
              </button>
              <button type="button" className={showFavoritesOnly ? 'active' : ''} onClick={() => setShowFavoritesOnly(true)}>
                Favorites {favoritesCount}
              </button>
            </div>
          </div>

          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search station or URL" />
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
                    type="button"
                    title="Reorder station"
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
                      title={station.favorite ? 'Remove favorite' : 'Add favorite'}
                      onClick={() => toggleFavorite(station.id)}
                    >
                      <Heart size={17} fill={station.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button className="icon-button small" type="button" title={isPlaying ? 'Pause station' : 'Play station'} onClick={() => (isPlaying ? togglePlayback() : playStation(station))}>
                      {isPlaying ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                    <button className="icon-button small danger" type="button" title="Remove station" onClick={() => removeStation(station.id)}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>

          {filteredStations.length === 0 && (
            <div className="empty-state">
              <ListMusic size={28} />
              <p>No stations match this view.</p>
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
                Append
              </button>
              <button className="primary-button" type="button" onClick={() => importStations('replace')}>
                Replace library
              </button>
            </div>

            <form className="add-station" onSubmit={addStation}>
              <div className="eyebrow">Add one station</div>
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

function loadStations(): Station[] {
  try {
    const saved = localStorage.getItem(STATIONS_STORAGE_KEY)
    const parsed = saved ? (JSON.parse(saved) as Station[]) : null
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((station) => station.name && station.url)
    }
  } catch {
    // Ignore malformed local storage and fall back to the starter library.
  }

  return DEFAULT_STATIONS
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
  const domain = getStationLogoDomain(station)

  return {
    accent: getStationAccent(station),
    initials: getStationInitials(station.name),
    url: domain ? `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${domain}`)}&sz=128` : '',
  }
}

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
    return new URL(station.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

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
