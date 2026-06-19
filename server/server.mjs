import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStreamMetadata } from './metadata.mjs'

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10)
const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url))

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (requestUrl.pathname === '/api/metadata') {
    await handleMetadataRequest(requestUrl, response)
    return
  }

  await serveStaticFile(requestUrl.pathname, response)
}).listen(PORT, '0.0.0.0', () => {
  console.log(`WadsRadio listening on http://0.0.0.0:${PORT}`)
})

async function handleMetadataRequest(requestUrl, response) {
  const streamUrl = requestUrl.searchParams.get('url')
  if (!streamUrl) {
    sendJson(response, 400, { ok: false, error: 'Missing stream URL.' })
    return
  }

  const metadata = await readStreamMetadata(streamUrl)
  sendJson(response, metadata.ok ? 200 : 502, metadata)
}

async function serveStaticFile(pathname, response) {
  const cleanPath = decodeURIComponent(pathname.split('?')[0] ?? '/')
  const relativePath = cleanPath === '/' ? '/index.html' : cleanPath
  const filePath = safeJoin(DIST_DIR, relativePath)

  if (!filePath) {
    sendText(response, 403, 'Forbidden')
    return
  }

  try {
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) throw new Error('Not a file')
    streamFile(filePath, response)
  } catch {
    streamFile(join(DIST_DIR, 'index.html'), response, false)
  }
}

function streamFile(filePath, response, immutable = true) {
  const extension = extname(filePath)
  response.writeHead(200, {
    'Cache-Control': immutable && filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  })
  createReadStream(filePath).pipe(response)
}

function safeJoin(root, path) {
  const normalizedPath = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '')
  const filePath = join(root, normalizedPath)
  return filePath.startsWith(root) ? filePath : ''
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(text)
}
