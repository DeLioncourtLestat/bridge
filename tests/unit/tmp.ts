import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const gitEnv = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' }
Object.assign(process.env, gitEnv)

export const tmp = (p = 'bridge-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)))
export const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

/** Repo with two commits on main, a bare origin and an extra branch. */
export function repo(name = 'proj') {
  const base = tmp()
  const dir = path.join(base, name)
  const remote = path.join(base, 'origin.git')
  fs.mkdirSync(dir)
  fs.mkdirSync(remote)
  sh(remote, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n\nline\n')
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'first')
  fs.appendFileSync(path.join(dir, 'README.md'), 'second line\n')
  sh(dir, 'commit', '-qam', 'second')
  sh(dir, 'remote', 'add', 'origin', remote)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  sh(dir, 'branch', 'feature/x')
  return { base, dir, remote }
}
