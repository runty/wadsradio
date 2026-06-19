import { Readable } from 'node:stream'

const HLS_PROXY_PATH = '/api/hls'
const HLS_PROXY_TIMEOUT_MS = 15000
const HLS_PLAYLIST_CONTENT_TYPE = 'application/vnd.apple.mpegurl; charset=utf-8'
const HLS_PROXY_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
}

export async function handleHlsProxyRequest(requestUrl, response, request) {
  const method = request?.method ?? 'GET'

  if (method === 'OPTIONS') {
    sendEmpty(response, 204)
    return
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendText(response, 405, 'HLS proxy supports GET and HEAD requests.')
    return
  }

  const targetUrl = requestUrl.searchParams.get('url')

  if (!targetUrl) {
    sendText(response, 400, 'Missing HLS URL.')
    return
  }

  let url
  try {
    url = normalizeHlsUrl(targetUrl)
  } catch (error) {
    sendText(response, 400, error?.message || 'Invalid HLS URL.')
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HLS_PROXY_TIMEOUT_MS)

  try {
    const upstream = await fetch(url, {
      method,
      headers: buildUpstreamHeaders(request),
      redirect: 'follow',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!upstream.ok) {
      sendText(response, 502, `HLS upstream returned ${upstream.status}.`)
      return
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    const upstreamUrl = upstream.url || url.href

    if (method === 'HEAD') {
      streamUpstreamResponse(upstream, response, false)
      return
    }

    if (isHlsPlaylist(upstreamUrl, contentType)) {
      const playlist = await upstream.text()
      sendText(response, 200, rewriteHlsPlaylist(playlist, upstreamUrl), HLS_PLAYLIST_CONTENT_TYPE)
      return
    }

    streamUpstreamResponse(upstream, response)
  } catch (error) {
    clearTimeout(timeout)
    sendText(
      response,
      502,
      error?.name === 'AbortError' ? 'HLS upstream timed out.' : error?.message || 'HLS upstream unavailable.',
    )
  }
}

export function rewriteHlsPlaylist(playlist, playlistUrl, proxyPath = HLS_PROXY_PATH) {
  const baseUrl = normalizeHlsUrl(playlistUrl)

  return String(playlist ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => rewriteHlsPlaylistLine(line, baseUrl, proxyPath))
    .join('\n')
}

function rewriteHlsPlaylistLine(line, baseUrl, proxyPath) {
  const trimmed = line.trim()
  if (!trimmed) return line

  if (trimmed.startsWith('#')) {
    return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${toProxyUrl(uri, baseUrl, proxyPath)}"`)
  }

  const uri = line.match(/^(\s*)(\S+)(\s*)$/)
  if (!uri) return line

  return `${uri[1]}${toProxyUrl(uri[2], baseUrl, proxyPath)}${uri[3]}`
}

function toProxyUrl(value, baseUrl, proxyPath) {
  try {
    const target = new URL(value, baseUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return value
    return `${proxyPath}?url=${encodeURIComponent(target.href)}`
  } catch {
    return value
  }
}

function normalizeHlsUrl(value) {
  const url = new URL(String(value ?? '').trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS HLS URLs are supported.')
  }
  return url
}

function buildUpstreamHeaders(request) {
  const headers = {
    Accept: '*/*',
    'User-Agent': 'WadsRadio/0.1 HLS proxy',
  }

  const range = request?.headers?.range
  if (range) headers.Range = range

  return headers
}

function isHlsPlaylist(url, contentType) {
  const cleanContentType = String(contentType ?? '').toLowerCase()
  if (
    cleanContentType.includes('application/vnd.apple.mpegurl') ||
    cleanContentType.includes('application/x-mpegurl') ||
    cleanContentType.includes('audio/mpegurl') ||
    cleanContentType.includes('audio/x-mpegurl')
  ) {
    return true
  }

  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8')
  } catch {
    return /\.m3u8(?:[?#]|$)/i.test(String(url ?? ''))
  }
}

function streamUpstreamResponse(upstream, response, sendBody = true) {
  const headers = {
    ...HLS_PROXY_CORS_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  }

  copyHeader(upstream, headers, 'accept-ranges')
  copyHeader(upstream, headers, 'content-length')
  copyHeader(upstream, headers, 'content-range')

  response.writeHead(upstream.status, headers)

  if (!sendBody || !upstream.body) {
    response.end()
    return
  }

  Readable.fromWeb(upstream.body).pipe(response)
}

function copyHeader(upstream, headers, name) {
  const value = upstream.headers.get(name)
  if (value) headers[name] = value
}

function sendEmpty(response, statusCode) {
  response.writeHead(statusCode, {
    ...HLS_PROXY_CORS_HEADERS,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end()
}

function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    ...HLS_PROXY_CORS_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(text)
}
