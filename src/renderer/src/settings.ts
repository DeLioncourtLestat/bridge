import type { Settings, Theme } from '../../shared/types'

/** Accent, its lighter tint for text on dark, and a darker one for text on light. */
export const ACCENTS: Record<string, [string, string, string]> = {
  Blue: ['#3b82f6', '#60a5fa', '#2563eb'], Violet: ['#8b5cf6', '#a78bfa', '#7c3aed'], Green: ['#10b981', '#34d399', '#059669'],
  Amber: ['#d97706', '#fbbf24', '#b45309'], Pink: ['#ec4899', '#f472b6', '#db2777'], Slate: ['#94a3b8', '#cbd5e1', '#475569'],
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
export const resolveTheme = (t: Theme): 'dark' | 'light' => (t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t)
export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
let themeSetting: Theme = 'dark'
darkQuery.addEventListener('change', () => { if (themeSetting === 'system') setTheme(resolveTheme('system')) })

/** Editor and terminal listen for this to recolor in place. */
export const THEME_EVENT = 'bridge:theme'
function setTheme(t: 'dark' | 'light') {
  const root = document.documentElement
  if (root.dataset.theme === t) return
  root.dataset.theme = t
  window.dispatchEvent(new Event(THEME_EVENT))
}
export const UI_FONTS: Record<string, string> = {
  System: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  Rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  Serif: 'ui-serif, Georgia, "Times New Roman", serif',
  Mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
}
export const CODE_FONTS: Record<string, string> = {
  'System mono': 'ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
  Menlo: 'Menlo, Monaco, monospace',
  Courier: '"Courier New", Courier, monospace',
}
export const CODE_SIZES: Record<string, number> = { '12': 18, '12.5': 20, '13': 20, '14': 22, '15': 24 }

export function applySettings(st: Settings) {
  const root = document.documentElement.style
  themeSetting = st.theme || 'dark'
  const theme = resolveTheme(themeSetting)
  setTheme(theme)
  document.documentElement.dataset.syntax = st.syntax || 'vscode'
  const [a1, a2, a3] = ACCENTS[st.accent] || ACCENTS.Blue
  root.setProperty('--accent', a1)
  root.setProperty('--accent-2', theme === 'light' ? a3 : a2)
  root.setProperty('--f-ui', UI_FONTS[st.uiFont] || UI_FONTS.System)
  root.setProperty('--f-code', CODE_FONTS[st.codeFont] || CODE_FONTS['System mono'])
  root.setProperty('--ui-fs', st.uiSize + 'px')
  root.setProperty('--code-fs', st.codeSize + 'px')
  root.setProperty('--code-lh', (CODE_SIZES[String(st.codeSize)] || 20) + 'px')
  root.setProperty('--r', st.radius + 'px')
  document.body.classList.toggle('compact', st.compact)
  document.body.classList.toggle('no-ln', !st.lineNumbers)
  document.body.classList.toggle('no-hl', !st.highlightChanges)
}


/** Set while Settings records a shortcut, so the old binding doesn't fire. */
export const keyRecording = { on: false }

/** Search asks the open fork to show a file: detail = { forkId, file, line? }. */
export const OPEN_FILE_EVENT = 'bridge:open-file'
