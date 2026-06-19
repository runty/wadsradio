import { Monitor, Moon, Sun } from 'lucide-react'
import type { WadsThemeMode } from './wads-theme'

type Props = {
  onChange: (mode: WadsThemeMode) => void
  value: WadsThemeMode
}

const themeOptions: Array<{
  icon: typeof Monitor
  label: string
  mode: WadsThemeMode
  title: string
}> = [
  { icon: Monitor, label: 'Follow system theme', mode: 'system', title: 'Follow system theme' },
  { icon: Sun, label: 'Use light theme', mode: 'light', title: 'Use light theme' },
  { icon: Moon, label: 'Use dark theme', mode: 'dark', title: 'Use dark theme' },
]

export function WadsThemeSwitch({ onChange, value }: Props) {
  return (
    <div className="wads-theme-switch" role="group" aria-label="Color theme">
      {themeOptions.map(({ icon: Icon, label, mode, title }) => (
        <button
          key={mode}
          className={value === mode ? 'active' : ''}
          type="button"
          title={title}
          aria-label={label}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}
