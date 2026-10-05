import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Account, ChatMessage, Fork, Note, Ref, Task } from '../shared/types'
import { childEnv, home } from './env'

/** Locate the Claude Code CLI. Tests set BRIDGE_CLAUDE_BIN to a fake. */
export function findClaude(): string | null {
  if (process.env.BRIDGE_CLAUDE_BIN) return process.env.BRIDGE_CLAUDE_BIN
  const h = home()
  const candidates =
    process.platform === 'win32'
      ? [path.join(h, '.local/bin/claude.exe'), path.join(h, 'AppData/Roaming/npm/claude.cmd')]
      : [path.join(h, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(h, '.claude/local/claude')]
  return candidates.find((c) => existsSync(c)) ?? null
}

/** Spawn the CLI; a `.js`/`.cjs` path (test fake) runs through Electron's own Node. */
export function spawnCli(bin: string, args: string[], cwd: string, account: Account | null): ChildProcess {
  const env = childEnv({ CLAUDE_CONFIG_DIR: account?.configDir ?? undefined })
  if (/\.c?js$/.test(bin)) return spawn(process.execPath, [bin, ...args], { cwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
  return spawn(bin, args, { cwd, env, shell: process.platform === 'win32' && bin.endsWith('.cmd') })
}

/** One line of a tool call, the way it shows in the chat. */
export function toolSummary(name: string, input: any, cwd: string): string {
  const rel = (p?: string) => (p ? (path.isAbsolute(p) ? path.relative(cwd, p) || p : p) : '')
  const cut = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  switch (name) {
    case 'Read': return `Read ${rel(input?.file_path)}`
    case 'Write': return `Wrote ${rel(input?.file_path)}`
    case 'Edit':
    case 'MultiEdit': return `Edited ${rel(input?.file_path)}`
    case 'Bash': return `Ran ${cut(String(input?.command ?? '').split('\n')[0])}`
    case 'Grep': return `Searched “${cut(String(input?.pattern ?? ''), 40)}”`
    case 'Glob': return `Listed ${input?.pattern ?? ''}`
    case 'TodoWrite': return 'Updated the plan'
    case 'WebFetch': return `Fetched ${input?.url ?? ''}`
    case 'WebSearch': return `Searched the web for “${cut(String(input?.query ?? ''), 40)}”`
    default: return name
  }
}

export type StreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'result'; isError: boolean; text: string }

/** Parse one line of `--output-format stream-json`. Unknown lines are ignored. */
export function parseStreamLine(line: string): StreamEvent[] {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return []
  }
  if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) return [{ kind: 'session', sessionId: msg.session_id }]
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    return msg.message.content.flatMap((c: any): StreamEvent[] => {
      if (c.type === 'text' && c.text) return [{ kind: 'text', text: c.text }]
      if (c.type === 'tool_use') return [{ kind: 'tool', name: c.name, input: c.input }]
      return []
    })
  }
  if (msg.type === 'result') return [{ kind: 'result', isError: !!msg.is_error, text: String(msg.result ?? '') }]
  return []
}

/** The prompt sent to the agent: what the user wrote plus attached tasks and notes. */
export function buildPrompt(text: string, tasks: Task[], notes: Note[]) {
  const blocks: string[] = []
  for (const t of tasks)
    blocks.push(`Task: ${t.title}\nPriority: ${t.priority}. Status: ${t.status}.${t.description ? `\n${t.description}` : ''}`)
  for (const n of notes) blocks.push(`Note: ${n.title}\n${n.body}`)
  const ctx = blocks.length ? `Context from the project:\n\n${blocks.join('\n\n---\n\n')}\n\n` : ''
  return `${ctx}${text.trim() || 'Work on the attached task.'}`
}

type RunOptions = {
  fork: Fork
  account: Account | null
  prompt: string
  permissionMode: string
  onUpdate: (text: string, tools: string[]) => void
  onSession: () => void
}

/** Runs and tracks agent processes, one per fork. */
export class AgentRunner {
  private procs = new Map<string, ChildProcess>()

  isRunning = (forkId: string) => this.procs.has(forkId)

  stop(forkId: string) {
    this.procs.get(forkId)?.kill('SIGTERM')
  }

  stopAll() {
    for (const p of this.procs.values()) p.kill('SIGTERM')
  }

  run(opts: RunOptions): Promise<{ ok: boolean; error?: string }> {
    const bin = findClaude()
    if (!bin) return Promise.resolve({ ok: false, error: 'Claude Code CLI not found. Install it, or set its path in Settings.' })
    const { fork } = opts
    const args = [
      '-p', opts.prompt,
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', opts.permissionMode,
      ...(fork.sessionStarted ? ['--resume', fork.sessionId] : ['--session-id', fork.sessionId]),
    ]
    const child = spawnCli(bin, args, fork.path, opts.account)
    this.procs.set(fork.id, child)
    let text = ''
    const tools: string[] = []
    let result: { isError: boolean; text: string } | null = null
    let stderr = ''
    let buf = ''
    const handle = (line: string) => {
      for (const ev of parseStreamLine(line)) {
        if (ev.kind === 'session') opts.onSession()
        else if (ev.kind === 'text') text += (text ? '\n\n' : '') + ev.text
        else if (ev.kind === 'tool') tools.push(toolSummary(ev.name, ev.input, fork.path))
        else result = ev
        if (ev.kind !== 'session') opts.onUpdate(text, tools)
      }
    }
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        handle(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    return new Promise((resolve) => {
      const finish = (code: number | null, err?: Error) => {
        if (buf.trim()) handle(buf)
        this.procs.delete(fork.id)
        const r = result as { isError: boolean; text: string } | null
        if (r && !r.isError && !text && r.text) {
          text = r.text
          opts.onUpdate(text, tools)
        }
        if (err) resolve({ ok: false, error: err.message })
        else if (r?.isError) resolve({ ok: false, error: r.text || 'The agent reported an error' })
        else if (code !== 0 && !r) resolve({ ok: false, error: stderr.trim().split('\n').slice(-3).join('\n') || `Agent exited with code ${code}` })
        else resolve({ ok: true })
      }
      child.on('error', (e) => finish(null, e))
      child.on('close', (code) => finish(code))
    })
  }
}

export const refTitles = (refs: Ref[], tasks: Task[], notes: Note[]): Ref[] =>
  refs.map((r) => ({ ...r, title: (r.kind === 'task' ? tasks.find((t) => t.id === r.id) : notes.find((n) => n.id === r.id))?.title }))

export type { ChatMessage }
