export type WadsThemeMode = 'system' | 'light' | 'dark'
export type WadsResolvedTheme = Exclude<WadsThemeMode, 'system'>

export function loadWadsThemeMode(storageKey: string): WadsThemeMode {
  try {
    const stored = localStorage.getItem(storageKey)
    return isWadsThemeMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function syncWadsTheme(storageKey: string, mode: WadsThemeMode): () => void {
  try {
    localStorage.setItem(storageKey, mode)
  } catch {
    // Persisting theme preference is best-effort.
  }

  return watchWadsTheme(mode)
}

export function resolveWadsTheme(mode: WadsThemeMode, media?: MediaQueryList): WadsResolvedTheme {
  if (mode !== 'system') return mode
  const systemTheme = media ?? window.matchMedia('(prefers-color-scheme: dark)')
  return systemTheme.matches ? 'dark' : 'light'
}

export function watchWadsTheme(mode: WadsThemeMode): () => void {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = () => {
    document.documentElement.dataset.theme = resolveWadsTheme(mode, systemTheme)
  }

  applyTheme()

  if (mode !== 'system') return () => {}

  systemTheme.addEventListener('change', applyTheme)
  return () => systemTheme.removeEventListener('change', applyTheme)
}

function isWadsThemeMode(value: string | null): value is WadsThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}
