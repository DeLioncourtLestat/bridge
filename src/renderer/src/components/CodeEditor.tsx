import { useEffect, useRef } from 'react'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, gutter, GutterMarker, keymap, type DecorationSet } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { changedLines } from '../../../shared/diff'
import type { Settings } from '../../../shared/types'

function language(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return javascript({ typescript: ext.startsWith('t'), jsx: ext.endsWith('x') })
  if (ext === 'json') return json()
  if (['css', 'scss'].includes(ext)) return css()
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return html()
  if (['md', 'markdown'].includes(ext)) return markdown()
  if (ext === 'py') return python()
  return []
}

const theme = EditorView.theme(
  {
    '&': { color: 'var(--fg)', backgroundColor: 'transparent', fontSize: 'var(--code-fs)', height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--f-code)', lineHeight: 'var(--code-lh)' },
    '.cm-content': { caretColor: 'var(--fg-hi)', padding: '10px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--fg-hi)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#525252', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dim)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent) !important' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,.08)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--line-2)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)' },
  },
  { dark: true },
)

// changed-line highlighting against the file at HEAD
const setChanged = StateEffect.define<Set<number>>()
const changedField = StateField.define<Set<number>>({
  create: () => new Set(),
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setChanged) ? e.value : acc), v),
})
const lineDeco = Decoration.line({ class: 'cm-changed-line' })
const changedDecos = EditorView.decorations.compute([changedField], (state) => {
  const b = new RangeSetBuilder<Decoration>()
  for (const n of [...state.field(changedField)].sort((x, y) => x - y)) if (n <= state.doc.lines) b.add(state.doc.line(n).from, state.doc.line(n).from, lineDeco)
  return b.finish() as DecorationSet
})
class Marker extends GutterMarker { toDOM() { const d = document.createElement('div'); d.className = 'cm-change-marker'; return d } }
const marker = new Marker()
const changedGutter = gutter({
  class: 'cm-gutter-changed',
  lineMarker: (view, line) => (view.state.field(changedField).has(view.state.doc.lineAt(line.from).number) ? marker : null),
  lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setChanged))),
})

type Props = { path: string; value: string; base: string | null; settings: Settings; onSave: (text: string) => void }

/** Editable file with autosave; edited lines are highlighted against HEAD. */
export function CodeEditor({ path, value, base, settings, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const tab = useRef(new Compartment())
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    let timer = 0
    let lastSaved = value
    const flush = () => {
      clearTimeout(timer)
      const text = view.current?.state.doc.toString()
      if (text !== undefined && text !== lastSaved) { lastSaved = text; saveRef.current(text) }
    }
    const mark = (v: EditorView) => v.dispatch({ effects: setChanged.of(changedLines(base, v.state.doc.toString())) })
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          theme,
          syntaxHighlighting(oneDarkHighlightStyle),
          language(path),
          changedField,
          changedDecos,
          changedGutter,
          tab.current.of([EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize))]),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { flush(); return true } }]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            clearTimeout(timer)
            timer = window.setTimeout(() => { flush(); mark(u.view) }, 400)
            mark(u.view)
          }),
        ],
      }),
    })
    view.current = v
    mark(v)
    return () => { flush(); v.destroy(); view.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    view.current?.dispatch({ effects: tab.current.reconfigure([EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize))]) })
  }, [settings.tabSize])

  return <div className="cmhost" ref={host} data-path={path} />
}
