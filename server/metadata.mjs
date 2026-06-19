const MAX_METADATA_BYTES = 768 * 1024
const DEFAULT_TIMEOUT_MS = 6500

export async function readStreamMetadata(streamUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_METADATA_BYTES
  const url = normalizeStreamUrl(streamUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let reader

  try {
    const response = await fetch(url, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'WadsRadio/0.1 stream metadata probe',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    const headers = collectStreamHeaders(response.headers)
    const metadataInterval = Number.parseInt(response.headers.get('icy-metaint') ?? '', 10)
    let streamMetadata = {}

    if (response.body && Number.isFinite(metadataInterval) && metadataInterval > 0) {
      reader = response.body.getReader()
      streamMetadata = await readIcyMetadata(reader, metadataInterval, maxBytes)
    }

    const streamTitle = cleanText(streamMetadata.StreamTitle)
    const splitTitle = splitStreamTitle(streamTitle)

    const streamResult = {
      ok: response.ok,
      status: response.status,
      fetchedAt: new Date().toISOString(),
      stationName: cleanText(headers.icyName),
      genre: cleanText(headers.icyGenre),
      bitrate: normalizeBitrate(headers.icyBitrate),
      description: cleanText(headers.icyDescription),
      homepage: cleanText(headers.icyUrl),
      contentType: cleanText(headers.contentType),
      server: cleanText(headers.server),
      metadataInterval: Number.isFinite(metadataInterval) ? metadataInterval : null,
      streamTitle,
      streamUrl: cleanText(streamMetadata.StreamUrl),
      artist: splitTitle.artist,
      title: splitTitle.title,
      raw: streamMetadata,
    }

    const providerResult = await readProviderMetadata(url.href)
    const mergedResult = mergeMetadata(streamResult, providerResult)
    return enrichArtwork(mergedResult)
  } catch (error) {
    return {
      ok: false,
      fetchedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? 'Metadata request timed out.' : cleanText(error?.message) || 'Metadata unavailable.',
    }
  } finally {
    clearTimeout(timeout)
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // The remote stream may already be closed.
      }
    }
  }
}

function normalizeStreamUrl(value) {
  const url = new URL(String(value ?? '').trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS streams can be probed.')
  }

  return url
}

function collectStreamHeaders(headers) {
  return {
    contentType: headers.get('content-type'),
    icyBitrate: headers.get('icy-br'),
    icyDescription: headers.get('icy-description'),
    icyGenre: headers.get('icy-genre'),
    icyName: headers.get('icy-name'),
    icyUrl: headers.get('icy-url'),
    server: headers.get('server'),
  }
}

async function readIcyMetadata(reader, metadataInterval, maxBytes) {
  const decoder = new TextDecoder('utf-8')
  let audioBytesRemaining = metadataInterval
  let metadataBytesRemaining = null
  let metadataBytes = []
  let fallbackMetadata = {}
  let totalBytes = 0

  while (totalBytes < maxBytes) {
    const { value, done } = await reader.read()
    if (done || !value) break

    totalBytes += value.length

    for (const byte of value) {
      if (metadataBytesRemaining === null) {
        audioBytesRemaining -= 1
        if (audioBytesRemaining === 0) metadataBytesRemaining = -1
        continue
      }

      if (metadataBytesRemaining === -1) {
        metadataBytesRemaining = byte * 16
        metadataBytes = []

        if (metadataBytesRemaining === 0) {
          audioBytesRemaining = metadataInterval
          metadataBytesRemaining = null
        }
        continue
      }

      metadataBytes.push(byte)
      metadataBytesRemaining -= 1

      if (metadataBytesRemaining === 0) {
        const metadataText = decoder.decode(new Uint8Array(metadataBytes)).replace(/\0+$/g, '').trim()
        if (metadataText) {
          const parsedMetadata = parseMetadataBlock(metadataText)
          if (cleanText(parsedMetadata.StreamTitle)) return parsedMetadata
          if (Object.keys(parsedMetadata).length > 0) fallbackMetadata = parsedMetadata
        }

        audioBytesRemaining = metadataInterval
        metadataBytesRemaining = null
        metadataBytes = []
      }
    }
  }

  return fallbackMetadata
}

async function readProviderMetadata(streamUrl) {
  if (isKexpStream(streamUrl)) return readKexpMetadata()
  return null
}

function isKexpStream(streamUrl) {
  return /(^|\.)kexp\b|kexp-mp3|streamguys1\.com\/kexp/i.test(streamUrl)
}

async function readKexpMetadata() {
  try {
    const plays = await fetchJson('https://api.kexp.org/v2/plays/?format=json&limit=1&ordering=-airdate')
    const play = plays?.results?.[0]
    if (!play) return null

    const show = play.show_uri ? await fetchJson(play.show_uri).catch(() => null) : null

    return {
      provider: 'KEXP playlist',
      title: cleanText(play.song),
      artist: cleanText(play.artist),
      album: cleanText(play.album),
      artwork: cleanText(play.image_uri),
      thumbnail: cleanText(play.thumbnail_uri),
      labels: Array.isArray(play.labels) ? play.labels.map(cleanText).filter(Boolean) : [],
      releaseDate: cleanText(play.release_date),
      playedAt: cleanText(play.airdate),
      showName: cleanText(show?.program_name),
      showTags: cleanText(show?.program_tags),
      hostNames: Array.isArray(show?.host_names) ? show.host_names.map(cleanText).filter(Boolean) : [],
      showTagline: cleanText(show?.tagline),
      stationName: 'KEXP 90.3 FM',
    }
  } catch {
    return null
  }
}

async function fetchJson(url, timeoutMs = 4500) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WadsRadio/0.1 now playing provider',
      },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`Provider returned ${response.status}`)
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function mergeMetadata(streamResult, providerResult) {
  if (!providerResult) return streamResult

  const providerStreamTitle =
    providerResult.artist && providerResult.title
      ? `${providerResult.artist} - ${providerResult.title}`
      : providerResult.title

  return {
    ...streamResult,
    provider: providerResult.provider,
    stationName: providerResult.stationName || streamResult.stationName,
    genre: providerResult.showTags || streamResult.genre,
    description: providerResult.showTagline || streamResult.description,
    streamTitle: streamResult.streamTitle || providerStreamTitle || '',
    artist: providerResult.artist || streamResult.artist,
    title: providerResult.title || streamResult.title,
    album: providerResult.album,
    artwork: providerResult.artwork || providerResult.thumbnail,
    thumbnail: providerResult.thumbnail || providerResult.artwork,
    labels: providerResult.labels,
    releaseDate: providerResult.releaseDate,
    playedAt: providerResult.playedAt,
    showName: providerResult.showName,
    hostNames: providerResult.hostNames,
    showTagline: providerResult.showTagline,
  }
}

async function enrichArtwork(metadata) {
  if (metadata.artwork || !metadata.artist || !metadata.title) return metadata

  const artwork = await readAppleArtwork(metadata.artist, metadata.title)
  if (!artwork) return metadata

  return {
    ...metadata,
    album: metadata.album || artwork.album,
    artwork: artwork.artwork,
    artworkProvider: artwork.provider,
    releaseDate: metadata.releaseDate || artwork.releaseDate,
    thumbnail: artwork.thumbnail || artwork.artwork,
  }
}

async function readAppleArtwork(artist, title) {
  try {
    const term = encodeURIComponent(`${artist} ${title}`)
    const data = await fetchJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`, 3500)
    const candidates = Array.isArray(data?.results) ? data.results : []
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: scoreAppleCandidate(candidate, artist, title),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)

    const match = ranked[0]?.candidate
    if (!match?.artworkUrl100) return null

    return {
      album: cleanText(match.collectionName),
      artwork: upscaleAppleArtwork(match.artworkUrl100),
      provider: 'Apple Music Search',
      releaseDate: cleanText(match.releaseDate),
      thumbnail: cleanText(match.artworkUrl100),
    }
  } catch {
    return null
  }
}

function scoreAppleCandidate(candidate, artist, title) {
  const candidateArtist = normalizeForMatch(candidate.artistName)
  const candidateTitle = normalizeForMatch(candidate.trackName)
  const wantedArtist = normalizeForMatch(artist)
  const wantedTitle = normalizeForMatch(title)
  let score = 0

  if (!candidateArtist || !candidateTitle || !wantedArtist || !wantedTitle) return 0

  if (candidateArtist === wantedArtist) score += 4
  else if (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist)) score += 2

  if (candidateTitle === wantedTitle) score += 5
  else if (candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle)) score += 3

  return score
}

function upscaleAppleArtwork(url) {
  return cleanText(url).replace(/\/\d+x\d+bb\.(jpg|jpeg|png|webp)$/i, '/600x600bb.$1')
}

function normalizeForMatch(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseMetadataBlock(metadataText) {
  const fields = {}
  const pattern = /([A-Za-z0-9_]+)=['"]([^'"]*)['"];?/g
  let match

  while ((match = pattern.exec(metadataText)) !== null) {
    fields[match[1]] = decodeEntities(match[2])
  }

  return fields
}

function splitStreamTitle(streamTitle) {
  const cleanTitle = cleanText(streamTitle)
  if (!cleanTitle) return { artist: '', title: '' }

  const split = cleanTitle.match(/^(.+?)\s+-\s+(.+)$/)
  if (!split) return { artist: '', title: cleanTitle }

  return {
    artist: cleanText(split[1]),
    title: cleanText(split[2]),
  }
}

function normalizeBitrate(value) {
  const cleanValue = cleanText(value)
  if (!cleanValue) return ''
  if (/kbps$/i.test(cleanValue)) return cleanValue
  return `${cleanValue} kbps`
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function decodeEntities(value) {
  return cleanText(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}
