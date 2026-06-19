import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleHlsProxyRequest(
  requestUrl: URL,
  response: ServerResponse,
  request?: IncomingMessage,
): Promise<void>

export function rewriteHlsPlaylist(playlist: string, playlistUrl: string, proxyPath?: string): string
