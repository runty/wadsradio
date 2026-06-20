import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleHlsProxyRequest } from './server/hls.mjs'
import { readStreamMetadata } from './server/metadata.mjs'
import { handleStationListRequest, handleStationListsRequest } from './server/station-lists.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'wadsradio-metadata-api',
      configureServer(server) {
        server.middlewares.use('/api/metadata', async (request, response) => {
          const requestUrl = new URL(request.url ?? '', 'http://localhost/api/metadata')
          const streamUrl = requestUrl.searchParams.get('url')

          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')

          if (!streamUrl) {
            response.statusCode = 400
            response.end(JSON.stringify({ ok: false, error: 'Missing stream URL.' }))
            return
          }

          const metadata = await readStreamMetadata(streamUrl)
          response.statusCode = metadata.ok ? 200 : 502
          response.end(JSON.stringify(metadata))
        })

        server.middlewares.use('/api/hls', async (request, response) => {
          const requestUrl = new URL(request.url ?? '', 'http://localhost/api/hls')
          await handleHlsProxyRequest(requestUrl, response, request)
        })

        server.middlewares.use('/api/station-lists', async (_request, response) => {
          await handleStationListsRequest(response)
        })

        server.middlewares.use('/api/station-list', async (request, response) => {
          const requestUrl = new URL(request.url ?? '', 'http://localhost/api/station-list')
          await handleStationListRequest(requestUrl, response)
        })
      },
    },
  ],
})
