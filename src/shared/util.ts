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

/** Fuzzy score of `q` as a subsequence of `path`; null when it doesn't match. File name hits and runs score higher. */
export function fuzzy(path: string, q: string): number | null {
  if (!q) return 0
  const p = path.toLowerCase()
  const s = q.toLowerCase().replace(/\s+/g, '')
  const base = p.lastIndexOf('/') + 1
  let score = 0, at = -1, run = 0
  for (const ch of s) {
    const i = p.indexOf(ch, at + 1)
    if (i < 0) return null
    run = i === at + 1 ? run + 1 : 0
    score += 1 + run * 2 + (i >= base ? 3 : 0) + (i === base || p[i - 1] === '/' || p[i - 1] === '-' || p[i - 1] === '_' || p[i - 1] === '.' ? 4 : 0)
    at = i
  }
  if (p.slice(base).startsWith(s)) score += 20
  return score - path.length * 0.01
}
