import { useEffect, useMemo, useRef, useState } from 'react'
import { esc, fuzzy } from '../../../shared/util'
import { svc } from '../api'
import { highlightLines } from '../syntax'
import { Overlay } from '../ui'

export type SearchMode = 'files' | 'text'
type Target = { projectId: string; forkId?: string | null }
type Hit = { file: string; line: number; text: string }

const mark = (text: string, q: string, caseSensitive: boolean, regex: boolean) => {
  if (!q) return esc(text)
  let re: RegExp
  try { re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi') } catch { return esc(text) }
  let out = '', last = 0
  for (const m of text.matchAll(re)) {
    if (!m[0]) break
    out += esc(text.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`
    last = m.index! + m[0].length
  }
  return out + esc(text.slice(last))
}

const split = (p: string) => { const i = p.lastIndexOf('/'); return [p.slice(i + 1), i > 0 ? p.slice(0, i) : ''] }

/** IntelliJ-style popup: Go to File (fuzzy names) or Find in Files (text, with a preview). */
export function SearchPopup({ mode, target, where, canOpen, onOpen, onClose }: {
  mode: SearchMode; target: Target; where: string; canOpen: boolean
  onOpen: (file: string, line?: number) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [hits, setHits] = useState<{ hits: Hit[]; truncated: boolean }>({ hits: [], truncated: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [cs, setCs] = useState(false)
  const [rx, setRx] = useState(false)
  const [sel, setSel] = useState(0)
  const [peek, setPeek] = useState<{ file: string; lines: string[] } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [mode])
  useEffect(() => { if (mode === 'files') svc.searchFiles(target).then(setFiles) }, [mode, target.projectId, target.forkId]) // eslint-disable-line react-hooks/exhaustive-deps

  // text search, debounced; stale answers are dropped
  useEffect(() => {
    if (mode !== 'text') return
    if (!q.trim()) { setHits({ hits: [], truncated: false }); setErr(''); return }
    let alive = true
    setBusy(true)
    const t = setTimeout(() => {
      svc.grep(target, q, { caseSensitive: cs, regex: rx }).then(
        (r) => { if (alive) { setHits(r); setErr(''); setSel(0) } },
        (e) => { if (alive) { setHits({ hits: [], truncated: false }); setErr((e as Error).message) } },
      ).finally(() => alive && setBusy(false))
    }, 160)
    return () => { alive = false; clearTimeout(t) }
  }, [mode, q, cs, rx, target.projectId, target.forkId]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    if (mode !== 'files') return []
    if (!q.trim()) return files.slice(0, 200)
    return files.map((f) => [f, fuzzy(f, q)] as const).filter((x): x is readonly [string, number] => x[1] !== null)
      .sort((a, b) => b[1] - a[1]).slice(0, 200).map((x) => x[0])
  }, [mode, files, q])
  useEffect(() => setSel(0), [q, mode])

  const count = mode === 'files' ? matches.length : hits.hits.length
  const cur = mode === 'text' ? hits.hits[sel] : undefined

  // preview of the selected hit
  useEffect(() => {
    if (!cur) { setPeek(null); return }
    if (peek?.file === cur.file) return
    let alive = true
    svc.peekFile(target, cur.file).then((c) => { if (alive) setPeek({ file: cur.file, lines: (c ?? '').split('\n') }) })
    return () => { alive = false }
  }, [cur?.file]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const open = (i = sel) => {
    if (!canOpen || (mode === 'text' && busy)) return // results are for the previous query
    if (mode === 'files') { const f = matches[i]; if (f) onOpen(f) }
    else { const h = hits.hits[i]; if (h) onOpen(h.file, h.line) }
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, count - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); open() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (mode === 'text' && e.altKey && e.code === 'KeyC') { e.preventDefault(); setCs((v) => !v) }
    else if (mode === 'text' && e.altKey && e.code === 'KeyX') { e.preventDefault(); setRx((v) => !v) }
  }

  const ctx = cur && peek?.file === cur.file ? Math.max(0, cur.line - 4) : 0
  const peekHtml = useMemo(() => (peek ? highlightLines(peek.file, peek.lines) : []), [peek])
  return (
    <Overlay onClose={onClose}>
      <div className={`spop ${mode}`} role="dialog" aria-label={mode === 'files' ? 'Go to file' : 'Find in files'} onKeyDown={keys}>
        <div className="shead">
          <b>{mode === 'files' ? 'Go to File' : 'Find in Files'}</b>
          <span className="where" title={where}>{where}</span>
          {mode === 'text' && <span className="scount">{busy ? 'Searching…' : q.trim() ? `${hits.hits.length}${hits.truncated ? '+' : ''} matches` : ''}</span>}
        </div>
        <div className="sinput">
          <input ref={input} id="searchInput" spellCheck={false} placeholder={mode === 'files' ? 'File name' : 'Text to find'} value={q} onChange={(e) => setQ(e.target.value)} />
          {mode === 'text' && (
            <>
              <button type="button" className="sopt" id="optCase" aria-pressed={cs} title="Match case (⌥C)" onClick={() => setCs((v) => !v)}>Cc</button>
              <button type="button" className="sopt" id="optRegex" aria-pressed={rx} title="Regex (⌥X)" onClick={() => setRx((v) => !v)}>.*</button>
            </>
          )}
        </div>
        <div className="sres" ref={list} role="listbox">
          {mode === 'files'
            ? matches.map((f, i) => {
                const [name, dir] = split(f)
                return (
                  <div key={f} className="sr" role="option" data-result={f} aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => setSel(i)} onDoubleClick={() => open(i)}>
                    <span className="sn">{name}</span><span className="sd">{dir}</span>
                  </div>
                )
              })
            : hits.hits.map((h, i) => (
                <div key={h.file + ':' + h.line + ':' + i} className="sr hit" role="option" data-result={`${h.file}:${h.line}`} aria-selected={i === sel} onClick={() => setSel(i)} onDoubleClick={() => open(i)}>
                  <span className="st" dangerouslySetInnerHTML={{ __html: mark(h.text.trim(), q, cs, rx) }} />
                  <span className="sd">{split(h.file)[0]} {h.line}</span>
                </div>
              ))}
          {err && <div className="sempty ferr">{err}</div>}
          {!err && !count && (mode === 'files' ? files.length > 0 : !!q.trim() && !busy) && <div className="sempty">Nothing found</div>}
        </div>
        {mode === 'text' && cur && peek?.file === cur.file && (
          <div className="speek">
            <div className="pkh">{cur.file}</div>
            <div className="code">
              {peekHtml.slice(ctx, ctx + 9).map((l, k) => (
                <div key={k} className={`dl${ctx + k + 1 === cur.line ? ' hitl' : ''}`}>
                  <span className="ln">{ctx + k + 1}</span>
                  <span className="tx" dangerouslySetInnerHTML={{ __html: l || ' ' }} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="sfoot">
          {canOpen ? <span>↵ open in Explorer · ↑↓ move · Esc close</span> : <span>Preview only. Open a fork or ghost to edit files.</span>}
        </div>
      </div>
    </Overlay>
  )
}
