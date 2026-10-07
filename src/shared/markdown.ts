import { esc } from './util'

function inline(text: string) {
  const codes: string[] = []
  let t = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
  t = esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[+n])}</code>`)
}

/** Basic markdown: headings, bold/italic/strike, code, lists, checklists, quotes, rules, links. */
export function mdRender(src: string) {
  let html = ''
  let list: string | null = null
  let para: string[] = []
  let quote: string[] = []
  let code: string[] | null = null
  const flushPara = () => {
    if (para.length) html += `<p>${para.join('<br>')}</p>`
    para = []
  }
  const flushQuote = () => {
    if (quote.length) html += `<blockquote>${quote.join('<br>')}</blockquote>`
    quote = []
  }
  const closeList = () => {
    if (list) html += `</${list}>`
    list = null
  }
  const openList = (tag: string, cls = '') => {
    if (list !== tag) {
      closeList()
      html += `<${tag}${cls ? ` class="${cls}"` : ''}>`
      list = tag
    }
  }
  const flush = () => {
    flushPara()
    flushQuote()
    closeList()
  }
  src.split('\n').forEach((line, i) => {
    if (code !== null) {
      if (/^```/.test(line)) {
        html += `<pre><code>${esc(code.join('\n'))}</code></pre>`
        code = null
      } else code.push(line)
      return
    }
    let m: RegExpMatchArray | null
    if (/^```/.test(line)) {
      flush()
      code = []
    } else if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      flush()
      const h = m[1].length + 1
      html += `<h${h}>${inline(m[2])}</h${h}>`
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush()
      html += '<hr>'
    } else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/))) {
      flushPara()
      flushQuote()
      openList('ul', 'check')
      const done = m[1] !== ' '
      html += `<li class="${done ? 'done' : ''}"><button class="cb" data-line="${i}" aria-pressed="${done}" aria-label="Toggle item"></button><span>${inline(m[2])}</span></li>`
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      flushPara()
      flushQuote()
      openList('ul')
      html += `<li>${inline(m[1])}</li>`
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      flushPara()
      flushQuote()
      openList('ol')
      html += `<li>${inline(m[1])}</li>`
    } else if ((m = line.match(/^>\s?(.*)/))) {
      flushPara()
      closeList()
      quote.push(inline(m[1]))
    } else if (!line.trim()) flush()
    else {
      flushQuote()
      closeList()
      para.push(inline(line))
    }
  })
  if (code !== null) html += `<pre><code>${esc((code as string[]).join('\n'))}</code></pre>`
  flush()
  return html
}

/** First meaningful line without markdown symbols, for list previews. */
export const mdSnippet = (src: string) =>
  (src.split('\n').find((l) => l.trim() && !/^```/.test(l)) || '')
    .replace(/^\s*(#{1,3}|[-*]\s+\[[ xX]\]|[-*]|\d+[.)]|>)\s*/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`~]/g, '')
    .trim()

/** Flip the checkbox on a given source line. */
export const toggleCheckbox = (src: string, line: number) => {
  const lines = src.split('\n')
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'))
  return lines.join('\n')
}

export type ChatPart = { kind: 'text'; text: string } | { kind: 'tools'; tools: string[] }

/** Agent reply as it happened: text, then the tools called before the next paragraph, and so on.
 *  Messages saved before marks existed show their tools first. */
export function chatParts(text: string, tools: string[], marks: number[]): ChatPart[] {
  const at = marks.length === tools.length ? marks : tools.map(() => 0)
  const parts: ChatPart[] = []
  let pos = 0
  tools.forEach((t, i) => {
    const cut = Math.min(Math.max(at[i], pos), text.length)
    const chunk = text.slice(pos, cut).trim()
    if (chunk) parts.push({ kind: 'text', text: chunk })
    pos = cut
    const last = parts[parts.length - 1]
    if (last?.kind === 'tools') last.tools.push(t)
    else parts.push({ kind: 'tools', tools: [t] })
  })
  const rest = text.slice(pos).trim()
  if (rest) parts.push({ kind: 'text', text: rest })
  return parts
}
