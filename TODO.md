# TODO

## HLS direct playback fallback

- Test current mobile and desktop behavior for `.m3u8` / `playlist.m3u8` stations.
- Consider changing HLS playback to try direct station URLs first, then fall back to `/api/hls` only when direct playback fails or CORS blocks playlist/segment access.
- Keep the current `/api/hls` proxy available for streams that need playlist rewriting, segment proxying, or range/CORS handling.
- Verify bandwidth impact before changing production behavior: regular MP3/AAC streams already play directly from the station to the device, while proxied HLS currently relays through WadsRadio.
