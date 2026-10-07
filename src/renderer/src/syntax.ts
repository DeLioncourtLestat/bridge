import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { LanguageSupport, StreamLanguage, type LRLanguage } from '@codemirror/language'
import { c, cpp, csharp, java, kotlin } from '@codemirror/legacy-modes/mode/clike'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { go } from '@codemirror/legacy-modes/mode/go'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { pgSQL } from '@codemirror/legacy-modes/mode/sql'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { highlightTree, styleTags, tagHighlighter, tags as t } from '@lezer/highlight'
import { esc } from '../../shared/util'

// legacy-modes types its StringStream from @codemirror/streamparser; same class at runtime
// Lezer tags a class/object method name as a plain property; color it as a function declaration, like IDEs do
const jsExtraTags = styleTags({ 'MethodDeclaration/PropertyDefinition': t.function(t.definition(t.propertyName)) })

const legacy = (mode: object) => StreamLanguage.define(mode as Parameters<typeof StreamLanguage.define>[0])
const LEGACY: Record<string, () => StreamLanguage<unknown>> = {
  rb: () => legacy(ruby), rake: () => legacy(ruby), gemspec: () => legacy(ruby), ru: () => legacy(ruby), erb: () => legacy(ruby),
  go: () => legacy(go), sh: () => legacy(shell), bash: () => legacy(shell), zsh: () => legacy(shell),
  yml: () => legacy(yaml), yaml: () => legacy(yaml), rs: () => legacy(rust), swift: () => legacy(swift), toml: () => legacy(toml),
  sql: () => legacy(pgSQL), java: () => legacy(java), kt: () => legacy(kotlin), kts: () => legacy(kotlin),
  c: () => legacy(c), h: () => legacy(c), cpp: () => legacy(cpp), cc: () => legacy(cpp), hpp: () => legacy(cpp), cs: () => legacy(csharp),
  lua: () => legacy(lua),
}
const NAMES: Record<string, string> = { Gemfile: 'rb', Rakefile: 'rb', Dockerfile: 'dockerfile', Brewfile: 'rb', '.zshrc': 'zsh', '.bashrc': 'bash' }

/** CodeMirror language for a file name (Lezer grammar, or a legacy stream mode), or null for plain text. */
export function language(path: string): LanguageSupport | StreamLanguage<unknown> | null {
  const base = path.split('/').pop() ?? ''
  const ext = NAMES[base] ?? (base.includes('.') ? base.split('.').pop()!.toLowerCase() : '')
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) {
    const js = javascript({ typescript: ['ts', 'tsx', 'mts', 'cts'].includes(ext), jsx: ext.endsWith('x') })
    return new LanguageSupport((js.language as LRLanguage).configure({ props: [jsExtraTags] }), js.support)
  }
  if (ext === 'json') return json()
  if (['css', 'scss'].includes(ext)) return css()
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return html()
  if (['md', 'markdown'].includes(ext)) return markdown()
  if (ext === 'py') return python()
  if (ext === 'dockerfile') return legacy(dockerFile)
  return LEGACY[ext]?.() ?? null
}

const parserOf = (l: LanguageSupport | StreamLanguage<unknown>) => ('language' in l ? l.language.parser : l.parser)

/**
 * One syntax palette for the editor, diffs, commits and search previews: Lezer tags → `sx-*` classes,
 * colored by the `--s-*` tokens of the chosen scheme in styles.css. More specific tags win, so a
 * function's declaration, a call and a plain variable each get their own color.
 */
export const ideHighlighter = tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'sx-com' },
  { tag: [t.keyword, t.definitionKeyword, t.operatorKeyword, t.modifier], class: 'sx-kw' },
  { tag: [t.controlKeyword, t.moduleKeyword], class: 'sx-ctl' },
  { tag: [t.string, t.special(t.string), t.character, t.docString], class: 'sx-str' },
  { tag: [t.regexp, t.escape], class: 'sx-rx' },
  { tag: [t.number, t.integer, t.float], class: 'sx-num' },
  { tag: [t.bool, t.null, t.atom, t.self, t.constant(t.variableName), t.standard(t.variableName)], class: 'sx-const' },
  { tag: t.variableName, class: 'sx-var' },
  { tag: t.definition(t.variableName), class: 'sx-def' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'sx-fn' },
  { tag: [t.function(t.definition(t.variableName)), t.function(t.definition(t.propertyName))], class: 'sx-fnd' },
  { tag: [t.propertyName, t.definition(t.propertyName), t.special(t.propertyName)], class: 'sx-prop' },
  { tag: [t.typeName, t.className, t.definition(t.className), t.namespace, t.definition(t.typeName)], class: 'sx-type' },
  { tag: [t.tagName, t.angleBracket], class: 'sx-tag' },
  { tag: t.attributeName, class: 'sx-attr' },
  { tag: [t.meta, t.annotation, t.macroName, t.processingInstruction], class: 'sx-meta' },
  { tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.definitionOperator, t.updateOperator, t.function(t.punctuation)], class: 'sx-op' },
  { tag: [t.punctuation, t.paren, t.brace, t.squareBracket, t.separator, t.derefOperator, t.special(t.brace)], class: 'sx-punc' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], class: 'sx-head' },
  { tag: [t.link, t.url], class: 'sx-link' },
  { tag: t.emphasis, class: 'sx-em' },
  { tag: t.strong, class: 'sx-strong' },
  { tag: t.strikethrough, class: 'sx-strike' },
  { tag: t.labelName, class: 'sx-var' },
  { tag: t.invalid, class: 'sx-bad' },
])

/** Highlighted HTML for each line of `lines`, parsed as one file. Plain-text files come back escaped. */
export function highlightLines(path: string, lines: string[]): string[] {
  const lang = language(path)
  const text = lines.join('\n')
  if (!lang || text.length > 400_000) return lines.map(esc)
  const out: string[] = lines.map(() => '')
  const starts: number[] = []
  let pos = 0
  for (const l of lines) { starts.push(pos); pos += l.length + 1 }
  const emit = (from: number, to: number, cls: string) => {
    // split the span at line breaks
    let line = lineAt(starts, from)
    while (from < to) {
      const end = Math.min(to, starts[line] + lines[line].length)
      if (end > from) {
        const s = esc(text.slice(from, end))
        out[line] += cls ? `<span class="${cls}">${s}</span>` : s
      }
      from = end + 1
      line++
    }
  }
  let at = 0
  highlightTree(parserOf(lang).parse(text), ideHighlighter, (from, to, cls) => {
    if (from > at) emit(at, from, '')
    emit(from, to, cls)
    at = to
  })
  if (at < text.length) emit(at, text.length, '')
  return out
}

function lineAt(starts: number[], pos: number) {
  let lo = 0, hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}
