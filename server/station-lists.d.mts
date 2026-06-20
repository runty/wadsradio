import type { ServerResponse } from 'node:http'

export function handleStationListsRequest(response: ServerResponse): Promise<void>

export function handleStationListRequest(requestUrl: URL, response: ServerResponse): Promise<void>
