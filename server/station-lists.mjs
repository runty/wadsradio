import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATION_LIST_DIR = fileURLToPath(new URL('../station-lists', import.meta.url))
const STATION_LIST_EXTENSIONS = new Set(['.csv', '.m3u', '.m3u8', '.pls', '.tsv', '.txt'])

export async function handleStationListsRequest(response) {
  const lists = await readStationListSummaries()
  sendJson(response, 200, { ok: true, lists })
}

export async function handleStationListRequest(requestUrl, response) {
  const id = requestUrl.searchParams.get('id') ?? ''
  const lists = await readStationListSummaries()
  const list = lists.find((candidate) => candidate.id === id)

  if (!list) {
    sendJson(response, 404, { ok: false, error: 'Station list not found.' })
    return
  }

  const content = await readFile(join(STATION_LIST_DIR, list.filename), 'utf8')
  sendJson(response, 200, { ok: true, list, content })
}

async function readStationListSummaries() {
  let entries

  try {
    entries = await readdir(STATION_LIST_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const files = entries
    .filter((entry) => entry.isFile() && STATION_LIST_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  const summaries = await Promise.all(files.map(readStationListSummary))
  return summaries.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }))
}

async function readStationListSummary(filename) {
  const content = await readFile(join(STATION_LIST_DIR, filename), 'utf8')
  const id = basename(filename, extname(filename))
  const title = readTitle(content) || titleFromId(id)
  const stationCount = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => {
      const cleanLine = line.trim()
      return cleanLine && !cleanLine.startsWith('#')
    }).length

  return { filename, id, stationCount, title }
}

function readTitle(content) {
  const titleLine = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .find((line) => /^#\s*WadsRadio station list:/i.test(line))

  return titleLine?.replace(/^#\s*WadsRadio station list:\s*/i, '').trim() ?? ''
}

function titleFromId(id) {
  return id
    .replace(/-wadsradio$/i, '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}
