export type StreamMetadata = {
  ok: boolean
  status?: number
  fetchedAt: string
  stationName?: string
  genre?: string
  bitrate?: string
  description?: string
  homepage?: string
  contentType?: string
  server?: string
  metadataInterval?: number | null
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
  raw?: Record<string, string>
}

export function readStreamMetadata(
  streamUrl: string,
  options?: {
    maxBytes?: number
    timeoutMs?: number
  },
): Promise<StreamMetadata>
