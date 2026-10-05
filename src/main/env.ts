import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/** Home folder; tests point it at a temp dir. */
export const home = () => process.env.BRIDGE_HOME || os.homedir()

let shellPath: string | null = null

/**
 * Apps started from Finder/Dock get a minimal PATH. Ask the user's login shell once
 * so agents and terminals find node, npm, brew tools, etc.
 */
export function loadShellPath(): Promise<void> {
  if (process.platform === 'win32' || shellPath !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const sh = process.env.SHELL || '/bin/zsh'
    execFile(sh, ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 5000 }, (err, out) => {
      const m = !err && out.match(/__P__(.*)__P__/)
      shellPath = m ? m[1] : ''
      resolve()
    })
  })
}

export function childEnv(extra: Record<string, string | undefined> = {}) {
  const extraDirs = [path.join(home(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  const parts = [shellPath, process.env.PATH, ...extraDirs].filter(Boolean).join(path.delimiter).split(path.delimiter)
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PATH: [...new Set(parts)].join(path.delimiter) }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
