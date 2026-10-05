import type { Settings } from '../../shared/types'

export const ACCENTS: Record<string, [string, string]> = {
  Blue: ['#3b82f6', '#60a5fa'], Violet: ['#8b5cf6', '#a78bfa'], Green: ['#10b981', '#34d399'],
  Amber: ['#d97706', '#fbbf24'], Pink: ['#ec4899', '#f472b6'], Slate: ['#94a3b8', '#cbd5e1'],
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
  const [a1, a2] = ACCENTS[st.accent] || ACCENTS.Blue
  root.setProperty('--accent', a1)
  root.setProperty('--accent-2', a2)
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
