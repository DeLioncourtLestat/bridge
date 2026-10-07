import hljs from 'highlight.js/lib/common'
import { Marked, Renderer } from 'marked'
import { esc } from '../../shared/util'

const renderer = new Renderer()
const link = renderer.link.bind(renderer)
const ALIAS: Record<string, string> = { sh: 'bash', zsh: 'bash', shell: 'bash', console: 'bash', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', yml: 'yaml', md: 'markdown' }

/** Fenced code: a header with the language and a copy button, highlighted body. */
renderer.code = ({ text, lang }) => {
  const name = (lang || '').trim().split(/\s+/)[0].toLowerCase()
  const id = ALIAS[name] || name
  let body: string
  try {
    body = id && hljs.getLanguage(id) ? hljs.highlight(text, { language: id, ignoreIllegals: true }).value : esc(text)
  } catch {
    body = esc(text)
  }
  return `<div class="cblock"><div class="cbh"><span>${esc(name || 'text')}</span><button type="button" class="cbcopy" aria-label="Copy code">Copy</button></div><pre><code class="hljs">${body}</code></pre></div>`
}
// agent output is untrusted: raw HTML is shown as text, links only to the web
renderer.html = ({ text }) => esc(text)
renderer.link = (tok) => (/^https?:\/\//i.test(tok.href) ? link(tok).replace('<a ', '<a target="_blank" rel="noopener" ') : renderer.parser.parseInline(tok.tokens))
renderer.image = ({ href, text }) => (/^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text || href)}</a>` : esc(text))
renderer.table = function (tok) {
  return `<div class="tblwrap">${Renderer.prototype.table.call(this, tok)}</div>`
}

const md = new Marked({ gfm: true, breaks: false, renderer })

/** GitHub-flavoured markdown for chat replies: tables, nested lists, task lists, highlighted code. */
export const chatMd = (src: string) => md.parse(src, { async: false }) as string

/** Click handler for rendered markdown: copy buttons on code blocks. */
export function onMdClick(e: React.MouseEvent) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cbcopy')
  if (!btn) return
  const code = btn.closest('.cblock')?.querySelector('code')?.textContent ?? ''
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied'
    setTimeout(() => { btn.textContent = 'Copy' }, 1200)
  })
}
