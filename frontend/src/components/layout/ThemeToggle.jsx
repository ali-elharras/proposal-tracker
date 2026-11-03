import { useState } from 'react'
import Icon from '../ui/Icon.jsx'

const KEY = 'iee.theme'

/** Light (the default, whatever the computer uses) unless the person chose dark on this computer. */
function read() {
  try {
    return window.localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Light · dark. Remembered on this computer only (index.html applies it before the first paint). */
export default function ThemeToggle({ withLabel = false }) {
  const [theme, setTheme] = useState(read)
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'
  const flip = () => {
    setTheme(next)
    try {
      if (next === 'dark') window.localStorage.setItem(KEY, 'dark')
      else window.localStorage.removeItem(KEY)
    } catch { /* not remembered */ }
    if (next === 'dark') document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
  }
  return (
    <button type="button" className={withLabel ? 'sidebar__util' : 'icon-btn'} onClick={flip} title={label} aria-label={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      {withLabel && <span className="sidebar__label">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>}
    </button>
  )
}
