import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { Repo } from './db'
import { childEnv } from './env'

type Live = { proc: pty.IPty; buffer: string; save: NodeJS.Timeout | null }

const SHELLS: Record<string, string> = { zsh: '/bin/zsh', bash: '/bin/bash', fish: '/opt/homebrew/bin/fish' }

export function resolveShell(name: string) {
  if (process.platform === 'win32') return name || 'powershell.exe'
  return SHELLS[name] || name || process.env.SHELL || '/bin/zsh'
}

/** Real shells (node-pty) per terminal tab; output is kept so names and history survive restarts. */
export class Terminals {
  private live = new Map<string, Live>()

  constructor(private repo: Repo, private send: (channel: string, payload: unknown) => void) {}

  create(forkId: string) {
    const id = randomUUID()
    const n = this.repo.listTerminals(forkId).length + 1
    this.repo.addTerminal(id, forkId, `zsh ${n}`)
    return id
  }

  /** Start the shell if needed; returns what was printed before (to repaint the view). */
  attach(id: string, cwd: string, shell: string, cols = 100, rows = 30, command?: { file: string; args: string[]; env?: Record<string, string | undefined> }) {
    const existing = this.live.get(id)
    if (existing) return existing.buffer
    const saved = this.repo.terminalBuffer(id)
    const file = command?.file ?? resolveShell(shell)
    const args = command?.args ?? (process.platform === 'win32' ? [] : ['-l'])
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color', cols, rows, cwd,
      env: childEnv({ TERM: 'xterm-256color', COLORTERM: 'truecolor', ...(command?.env ?? {}) }),
    })
    const entry: Live = { proc, buffer: saved ? saved + '\r\n' : '', save: null }
    this.live.set(id, entry)
    proc.onData((data) => {
      entry.buffer = (entry.buffer + data).slice(-200_000)
      this.send('term:data', { id, data })
      if (!entry.save) entry.save = setTimeout(() => { entry.save = null; this.persist(id) }, 1000)
    })
    proc.onExit(({ exitCode }) => {
      this.persist(id)
      this.live.delete(id)
      this.send('term:exit', { id, exitCode })
    })
    return entry.buffer
  }

  write = (id: string, data: string) => this.live.get(id)?.proc.write(data)

  resize(id: string, cols: number, rows: number) {
    try {
      this.live.get(id)?.proc.resize(Math.max(cols, 2), Math.max(rows, 2))
    } catch {
      /* the shell may have just exited */
    }
  }

  persist(id: string) {
    const e = this.live.get(id)
    if (e && !id.startsWith('login:')) this.repo.setTerminalBuffer(id, e.buffer)
  }

  kill(id: string) {
    const e = this.live.get(id)
    if (!e) return
    this.persist(id)
    this.live.delete(id)
    e.proc.kill()
  }

  close(id: string) {
    this.kill(id)
    this.repo.removeTerminal(id)
  }

  killAll() {
    for (const id of [...this.live.keys()]) this.kill(id)
  }
}
