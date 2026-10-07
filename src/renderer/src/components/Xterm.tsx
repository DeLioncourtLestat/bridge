import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { bridge } from '../api'
import { currentTheme, THEME_EVENT } from '../settings'

const THEMES = {
  dark: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#f5f5f5', cursorAccent: '#0a0a0a', selectionBackground: '#3b82f655', black: '#262626', brightBlack: '#525252' },
  light: {
    background: '#ffffff', foreground: '#27272a', cursor: '#18181b', cursorAccent: '#ffffff', selectionBackground: '#3b82f640',
    black: '#27272a', brightBlack: '#71717a', white: '#a1a1aa', brightWhite: '#d4d4d8',
    red: '#c41a16', green: '#007400', yellow: '#946800', blue: '#0451a5', magenta: '#a626a4', cyan: '#0e7490',
    brightRed: '#dc2626', brightGreen: '#16a34a', brightYellow: '#a16207', brightBlue: '#2563eb', brightMagenta: '#c026d3', brightCyan: '#0891b2',
  },
}

type Attach = (cols: number, rows: number) => Promise<{ id: string; buffer: string } | null>

/**
 * A real shell. `attach` starts it (or reconnects) and returns the session id and what
 * was printed before, so the view can repaint after switching tabs or restarting.
 */
export function Xterm({ attach }: { attach: Attach }) {
  const host = useRef<HTMLDivElement>(null)
  const attachRef = useRef(attach)
  attachRef.current = attach
  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--f-code') || 'Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: THEMES[currentTheme()],
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    try { fit.fit() } catch { /* not laid out yet */ }
    let id: string | null = null
    let alive = true
    const off = bridge().on('term:data', (p: { id: string; data: string }) => { if (p.id === id) term.write(p.data) })
    const offExit = bridge().on('term:exit', (p: { id: string }) => { if (p.id === id) term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n') })
    attachRef.current(term.cols, term.rows).then((r) => {
      if (!alive || !r) return
      id = r.id
      if (host.current) host.current.dataset.termView = r.id
      if (r.buffer) term.write(r.buffer)
      term.focus()
    })
    const retheme = () => { term.options.theme = THEMES[currentTheme()] }
    window.addEventListener(THEME_EVENT, retheme)
    const input = term.onData((d) => { if (id) bridge().term.write(id, d) })
    const ro = new ResizeObserver(() => {
      try { fit.fit(); if (id) bridge().term.resize(id, term.cols, term.rows) } catch { /* hidden */ }
    })
    ro.observe(host.current!)
    return () => { alive = false; window.removeEventListener(THEME_EVENT, retheme); off(); offExit(); input.dispose(); ro.disconnect(); term.dispose() }
  }, [])
  return <div className="xhost" ref={host} />
}
