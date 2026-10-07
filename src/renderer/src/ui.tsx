import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { highlightLines } from './syntax'
import type { DiffOp } from '../../shared/types'

/* ---------- icons ---------- */
const svg = (d: ReactNode) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">{d}</svg>
export const Icon = {
  chat: svg(<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />),
  changes: svg(<path d="M8 3v6M5 6h6M5 12.5h6" />),
  files: svg(<path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" />),
  term: svg(<><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3.5" /></>),
  git: svg(<><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 3-7 2-7 4" /></>),
  gear: svg(<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></>),
  instr: svg(<><path d="M4 2.5h6.5L13 5v8.5H4z" /><path d="M10.5 2.5V5H13M6.2 8h4.6M6.2 10.5h3" /></>),
  check: svg(<path d="M3.5 8.5l3 3 6-6.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />),
  ghost: svg(<><path d="M3.5 14V7a4.5 4.5 0 0 1 9 0v7l-1.5-1.2L9.5 14 8 12.8 6.5 14 5 12.8z" /><path d="M6.3 7h.01M9.7 7h.01" /></>),
  user: svg(<><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6" /></>),
}

/** A diff with both sides highlighted as whole files, so multi-line strings and comments color right. */
export function DiffView({ ops, path }: { ops: DiffOp[]; path: string }) {
  const html = useMemo(() => {
    const oldSide = highlightLines(path, ops.filter((o) => o.t !== '+').map((o) => o.s))
    const newSide = highlightLines(path, ops.filter((o) => o.t !== '-').map((o) => o.s))
    let a = 0, b = 0
    return ops.map((o) => (o.t === '-' ? oldSide[a++] : o.t === '+' ? newSide[b++] : (a++, newSide[b++])))
  }, [ops, path])
  return (
    <div className="code">
      {ops.map((o, i) => (
        <div key={i} className={`dl ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}`}>
          <span className="ln">{o.t === '-' ? o.a : o.b}</span>
          <span className="mk">{o.t === ' ' ? '' : o.t === '+' ? '+' : '−'}</span>
          <span className="tx" dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} />
        </div>
      ))}
    </div>
  )
}

/* ---------- toasts & confirm ---------- */
type ConfirmOpts = { title: string; text: string; ok?: string }
type Ctx = { toast: (text: string) => void; confirm: (o: ConfirmOpts) => Promise<boolean>; fail: (e: unknown) => void }
const UiCtx = createContext<Ctx>(null as unknown as Ctx)
export const useUi = () => useContext(UiCtx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [toastText, setToast] = useState<string | null>(null)
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const timer = useRef<number>(0)
  const toast = useCallback((text: string) => {
    setToast(text)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConf({ ...o, resolve })), [])
  const fail = useCallback((e: unknown) => toast((e as Error)?.message || String(e)), [toast])
  const done = (v: boolean) => {
    conf?.resolve(v)
    setConf(null)
  }
  return (
    <UiCtx.Provider value={{ toast, confirm, fail }}>
      {children}
      {toastText && <div className="toast" role="status">{toastText}</div>}
      {conf && (
        <Overlay onClose={() => done(false)}>
          <div className="modal" role="alertdialog" aria-label={conf.title}>
            <h2 style={{ color: 'var(--fg-hi)', fontSize: 15 }}>{conf.title}</h2>
            <p className="ctext">{conf.text}</p>
            <div className="mact">
              <span className="sp" />
              <button className="btn" onClick={() => done(false)}>Cancel</button>
              <button className="btn danger" autoFocus onClick={() => done(true)}>{conf.ok || 'Delete'}</button>
            </div>
          </div>
        </Overlay>
      )}
    </UiCtx.Provider>
  )
}

/** Dimmed backdrop; Escape or a click outside closes. */
export function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="ov" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  )
}

/** Close a popup when clicking anywhere else. */
export function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut() }
    const t = setTimeout(() => document.addEventListener('pointerdown', h))
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', h) }
  }, [ref, onOut, active])
}

export const STATUS = { open: 'Open', progress: 'In progress', done: 'Done' } as const
export const PRIO = { high: 'High', med: 'Medium', low: 'Low' } as const
