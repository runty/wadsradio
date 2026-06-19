export type Station = {
  id: string
  name: string
  url: string
  volumeOffset: number
  favorite: boolean
}

export type ParsedStations = {
  stations: Station[]
  format: string
  rejectedLines: number
}

type StationDraft = Omit<Station, 'id' | 'favorite'> & { favorite?: boolean }

export const DEFAULT_STATIONS: Station[] = [
  createStation('SomaFM Groove Salad', 'https://ice1.somafm.com/groovesalad-128-mp3', 0, true),
  createStation('KEXP Seattle', 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3', 0, true),
  createStation('Radio Paradise Main Mix', 'https://stream.radioparadise.com/mp3-192', 0, false),
  createStation('WFMU Freeform', 'https://stream0.wfmu.org/freeform-128k', 0, false),
  createStation('FIP', 'https://icecast.radiofrance.fr/fip-midfi.mp3', 0, false),
]

export function createStation(
  name: string,
  url: string,
  volumeOffset = 0,
  favorite = false,
): Station {
  const cleanName = cleanField(name) || stationNameFromUrl(url)
  const cleanUrl = normalizeStreamUrl(url)

  return {
    id: makeStationId(cleanName, cleanUrl),
    name: cleanName,
    url: cleanUrl,
    volumeOffset: clampVolumeOffset(volumeOffset),
    favorite,
  }
}

export function parseStationList(input: string): ParsedStations {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const drafts: StationDraft[] = []
  let rejectedLines = 0
  const isHlsMediaPlaylist = /^#EXT-X-/im.test(normalized)
  let format = isHlsMediaPlaylist ? 'HLS media playlist' : 'Text'

  const plsStations = parsePls(normalized)
  if (plsStations.length > 0) {
    return {
      stations: uniqueStations(plsStations),
      format: 'PLS',
      rejectedLines: 0,
    }
  }

  let pendingM3uTitle = ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (!isHlsMediaPlaylist && /^#EXTINF/i.test(line)) {
      pendingM3uTitle = cleanField(line.replace(/^#EXTINF:[^,]*,?/i, ''))
      format = 'M3U'
      continue
    }

    if (line.startsWith('#')) continue

    if (!isHlsMediaPlaylist && pendingM3uTitle && looksLikeStreamUrl(line)) {
      drafts.push({ name: pendingM3uTitle, url: normalizeStreamUrl(line), volumeOffset: 0 })
      pendingM3uTitle = ''
      format = 'M3U'
      continue
    }

    const tsv = parseDelimitedLine(line, '\t')
    if (tsv && looksLikeStreamUrl(tsv[1])) {
      drafts.push({
        name: tsv[0],
        url: normalizeStreamUrl(tsv[1]),
        volumeOffset: parseVolumeOffset(tsv[2]),
      })
      format = tsv.length >= 3 ? 'YoRadio playlist.csv' : 'Tab-separated text'
      continue
    }

    const jsonStation = parseJsonStation(line)
    if (jsonStation) {
      drafts.push(jsonStation)
      format = 'YoRadio/KaRadio JSON lines'
      continue
    }

    const csv = parseDelimitedLine(line, ',')
    if (csv && csv.length >= 2 && looksLikeStreamUrl(csv[1])) {
      drafts.push({
        name: csv[0],
        url: normalizeStreamUrl(csv[1]),
        volumeOffset: parseVolumeOffset(csv[2]),
      })
      format = 'CSV'
      continue
    }

    const split = line.match(/^(.+?)\s*[-|;]\s*(https?:\/\/.+)$/i)
    if (split) {
      drafts.push({ name: split[1], url: normalizeStreamUrl(split[2]), volumeOffset: 0 })
      continue
    }

    if (looksLikeStreamUrl(line)) {
      if (isHlsMediaPlaylist) {
        rejectedLines += 1
        continue
      }

      drafts.push({ name: stationNameFromUrl(line), url: normalizeStreamUrl(line), volumeOffset: 0 })
      continue
    }

    rejectedLines += 1
  }

  return {
    stations: uniqueStations(drafts),
    format,
    rejectedLines,
  }
}

export function exportYoRadioPlaylist(stations: Station[]): string {
  return stations
    .map((station) => {
      const name = cleanForYoRadio(station.name)
      const url = cleanForYoRadio(station.url)
      const volumeOffset = clampVolumeOffset(station.volumeOffset)
      return `${name}\t${url}\t${volumeOffset}`
    })
    .join('\n')
    .concat('\n')
}

function parseJsonStation(line: string): StationDraft | null {
  const object = parseObjectLine(line)
  if (!object) return null

  const nameValue = firstString(object, ['name', 'station', 'title', 'n']) ?? firstStringValue(object)
  const urlValue = firstString(object, ['url', 'stream', 'streamUrl', 'stream_url'])

  if (nameValue && urlValue && looksLikeStreamUrl(urlValue)) {
    return {
      name: nameValue,
      url: normalizeStreamUrl(urlValue),
      volumeOffset: parseVolumeOffset(firstString(object, ['ovol', 'volume', 'volumeOffset'])),
    }
  }

  const host = firstString(object, ['host', 'h'])
  const path = firstString(object, ['file', 'path', 'f']) ?? ''
  const port = firstString(object, ['port', 'p'])

  if (!nameValue || !host) return null

  let base = host
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`

  let url: string
  const parsedPort = Number.parseInt(port ?? '', 10)
  if (Number.isFinite(parsedPort) && parsedPort > 0) {
    url = `${base}:${parsedPort}${path.startsWith('/') ? path : `/${path}`}`
  } else {
    url = `${base}${path.startsWith('/') || path === '' ? path : `/${path}`}`
  }

  return {
    name: nameValue,
    url: normalizeStreamUrl(url),
    volumeOffset: parseVolumeOffset(firstString(object, ['ovol', 'volume', 'volumeOffset'])),
  }
}

function parseObjectLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    const entries = [...line.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)]
    if (entries.length > 0) {
      return Object.fromEntries(entries.map((entry) => [entry[1], entry[2]]))
    }
  }

  return null
}

function parsePls(input: string): StationDraft[] {
  if (!/\[playlist\]/i.test(input) && !/^File\d+=/im.test(input)) return []

  const files = new Map<number, string>()
  const titles = new Map<number, string>()
  const lines = input.replace(/\r\n?/g, '\n').split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const file = line.match(/^File(\d+)=(.+)$/i)
    if (file) {
      files.set(Number.parseInt(file[1], 10), file[2].trim())
      continue
    }

    const title = line.match(/^Title(\d+)=(.+)$/i)
    if (title) {
      titles.set(Number.parseInt(title[1], 10), title[2].trim())
    }
  }

  return [...files.entries()]
    .sort(([left], [right]) => left - right)
    .filter(([, url]) => looksLikeStreamUrl(url))
    .map(([index, url]) => ({
      name: titles.get(index) ?? stationNameFromUrl(url),
      url: normalizeStreamUrl(url),
      volumeOffset: 0,
    }))
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] | null {
  const values: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const next = line[index + 1]

    if (character === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (character === '"') {
      quoted = !quoted
      continue
    }

    if (character === delimiter && !quoted) {
      values.push(cleanField(current))
      current = ''
      continue
    }

    current += character
  }

  if (quoted) return null
  values.push(cleanField(current))

  if (values.length < 2 || !values[0] || !values[1]) return null
  return values
}

function uniqueStations(drafts: StationDraft[]): Station[] {
  const usedIds = new Set<string>()
  const seenUrls = new Set<string>()
  const stations: Station[] = []

  for (const draft of drafts) {
    const url = normalizeStreamUrl(draft.url)
    const dedupeKey = url.toLowerCase()
    if (!draft.name || !url || seenUrls.has(dedupeKey)) continue

    seenUrls.add(dedupeKey)
    let station = createStation(draft.name, url, draft.volumeOffset, draft.favorite ?? false)
    let suffix = 2

    while (usedIds.has(station.id)) {
      station = { ...station, id: `${station.id}-${suffix}` }
      suffix += 1
    }

    usedIds.add(station.id)
    stations.push(station)
  }

  return stations
}

function normalizeStreamUrl(url: string): string {
  const cleanUrl = cleanField(url)
  if (/^https?:\/\//i.test(cleanUrl)) return cleanUrl
  if (/^[a-z]+:\/\//i.test(cleanUrl)) return cleanUrl
  return `http://${cleanUrl.replace(/^\/+/, '')}`
}

function looksLikeStreamUrl(value: string): boolean {
  const cleanValue = cleanField(value)
  return /^(https?:\/\/|icy:\/\/|mms:\/\/)/i.test(cleanValue) || /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\/.+/i.test(cleanValue)
}

function stationNameFromUrl(url: string): string {
  try {
    const parsed = new URL(normalizeStreamUrl(url))
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return 'Untitled station'
  }
}

function cleanField(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function cleanForYoRadio(value: string): string {
  return value.replace(/[\t\r\n]/g, ' ').trim()
}

function parseVolumeOffset(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '0'), 10)
  return clampVolumeOffset(Number.isFinite(parsed) ? parsed : 0)
}

function clampVolumeOffset(value: number): number {
  return Math.max(-30, Math.min(30, Math.trunc(value)))
}

function firstString(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return undefined
}

function firstStringValue(object: Record<string, unknown>): string | undefined {
  for (const value of Object.values(object)) {
    if (typeof value === 'string' && value.trim()) return value
  }

  return undefined
}

function makeStationId(name: string, url: string): string {
  const source = `${name}|${url}`.toLowerCase()
  let hash = 2166136261

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return `st-${(hash >>> 0).toString(36)}`
}
