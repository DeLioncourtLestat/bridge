export const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/** Two-letter icon text: "easy-calendar" → "EC", "shop api" → "SA", "bridge" → "BR". */
export function initials(name: string) {
  const words = name.split(/[\s\-_.]+/).filter(Boolean)
  const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)
  return s.toUpperCase()
}

export const PROJECT_COLORS = ['#3b82f6', '#10b981', '#d97706', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#94a3b8']

export function colorFor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PROJECT_COLORS[h % PROJECT_COLORS.length]
}

/** Git ref names we accept for new branches. */
export const validBranch = (b: string) =>
  /^[\w][\w.\/-]*$/.test(b) && !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock') && !b.includes('//')
