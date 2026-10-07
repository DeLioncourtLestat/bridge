import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { diffStats, lineDiff } from '../shared/diff'
import type { Commit, DiffOp, FileChange } from '../shared/types'

export class GitError extends Error {}

/** Run git and return stdout; throws GitError with git's own message on failure. */
export function git(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (err) reject(new GitError((stderr || err.message).trim()))
        else resolve(stdout)
      },
    )
    if (input !== undefined) child.stdin?.end(input)
  })
}

export async function isRepo(dir: string) {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

export const repoRoot = async (dir: string) => (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
export const currentBranch = async (dir: string) => (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

export async function listBranches(repo: string): Promise<string[]> {
  const out = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return out.split('\n').filter(Boolean)
}

export type Worktree = { path: string; branch: string | null }

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  const out = await git(repo, ['worktree', 'list', '--porcelain'])
  const res: Worktree[] = []
  let cur: Worktree | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), branch: null }
      res.push(cur)
    } else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
  }
  return res
}

/** Folder for a fork: a sibling `<project>_worktrees/<last part of branch>` next to the project. */
export function worktreeDir(projectPath: string, branch: string) {
  const parent = path.dirname(projectPath)
  return path.join(parent, `${path.basename(projectPath)}_worktrees`, branch.split('/').pop()!)
}

/**
 * Create a worktree. New branches start from the project's checked-out branch.
 * Git itself refuses a branch that is already checked out in another worktree.
 */
export async function addWorktree(repo: string, dir: string, branch: string, newBranch: boolean) {
  await fs.mkdir(path.dirname(dir), { recursive: true })
  if (newBranch) await git(repo, ['worktree', 'add', '-b', branch, dir, 'HEAD'])
  else await git(repo, ['worktree', 'add', dir, branch])
}

export async function moveWorktree(repo: string, from: string, to: string) {
  await git(repo, ['worktree', 'move', from, to])
}

export const renameBranch = (repo: string, from: string, to: string) => git(repo, ['branch', '-m', from, to])

/** Uncommitted changes vs HEAD, with line counts. */
export async function status(cwd: string): Promise<FileChange[]> {
  const out = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const entries = out.split('\0').filter(Boolean)
  const res: FileChange[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const code = e.slice(0, 2)
    let file = e.slice(3)
    if (code[0] === 'R' || code[0] === 'C') i++ // the next entry is the old path
    const kind: FileChange['kind'] = code === '??' || code.includes('A') ? 'A' : code.includes('D') ? 'D' : 'M'
    const { add, del } = diffStats(await fileDiff(cwd, file))
    if (file.endsWith('/')) file = file.slice(0, -1)
    res.push({ path: file, kind, add, del })
  }
  return res.sort((a, b) => a.path.localeCompare(b.path))
}

/** Tracked + untracked files that aren't ignored. */
export async function listFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  const files = new Set(out.split('\0').filter(Boolean))
  // deleted files are still listed by --cached; hide the ones gone from disk
  const present = await Promise.all([...files].map(async (f) => ((await exists(path.join(cwd, f))) ? f : null)))
  return present.filter((f): f is string => !!f).sort()
}

const exists = (p: string) => fs.access(p).then(() => true, () => false)

export async function fileAtHead(cwd: string, file: string): Promise<string | null> {
  try {
    return await git(cwd, ['show', `HEAD:${file}`])
  } catch {
    return null
  }
}

/** Resolve a repo-relative path and refuse anything outside the worktree. */
export function safePath(cwd: string, file: string) {
  const full = path.resolve(cwd, file)
  if (full !== cwd && !full.startsWith(cwd + path.sep)) throw new GitError(`Path outside the fork: ${file}`)
  return full
}

export type GrepHit = { file: string; line: number; text: string }

/** Search tracked and untracked (not ignored) text files. Plain text unless `regex` (Perl syntax, or extended
 *  POSIX where git lacks PCRE); case-insensitive unless `caseSensitive`. */
export async function grep(cwd: string, query: string, opts: { caseSensitive?: boolean; regex?: boolean } = {}, limit = 500) {
  if (!opts.regex) return grepWith(cwd, query, '-F', opts.caseSensitive, limit)
  try {
    return await grepWith(cwd, query, '-P', opts.caseSensitive, limit)
  } catch (e) {
    if (/pcre|not built|unsupported|support for perl/i.test((e as Error).message)) return grepWith(cwd, query, '-E', opts.caseSensitive, limit)
    throw e
  }
}

function grepWith(cwd: string, query: string, mode: string, caseSensitive: boolean | undefined, limit: number): Promise<{ hits: GrepHit[]; truncated: boolean }> {
  const args = ['grep', '-n', '-I', '--untracked', '--no-color', '--null', mode]
  if (!caseSensitive) args.push('-i')
  args.push('-e', query, '--')
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => {
      // exit code 1 just means "no matches"
      if (err && (err as { code?: number }).code !== 1) return reject(new GitError((stderr || err.message).trim().replace(/^fatal:\s*/, '')))
      const hits: GrepHit[] = []
      const lines = stdout.split('\n')
      for (const l of lines) {
        if (hits.length >= limit) break
        const [file, num, ...rest] = l.split('\0')
        if (!file || !num) continue
        const text = rest.join('\0')
        hits.push({ file, line: Number(num), text: text.length > 300 ? text.slice(0, 300) + '…' : text })
      }
      resolve({ hits, truncated: lines.filter(Boolean).length > hits.length })
    })
  })
}

export async function readFile(cwd: string, file: string): Promise<string | null> {
  try {
    return await fs.readFile(safePath(cwd, file), 'utf8')
  } catch {
    return null
  }
}

export async function writeFile(cwd: string, file: string, content: string) {
  const full = safePath(cwd, file)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
}

export async function fileDiff(cwd: string, file: string): Promise<DiffOp[]> {
  return lineDiff(await fileAtHead(cwd, file), await readFile(cwd, file))
}

/** Commit exactly the given files (new, modified or deleted). */
export async function commit(cwd: string, files: string[], message: string) {
  if (!files.length) throw new GitError('Nothing selected to commit')
  if (!message.trim()) throw new GitError('Commit message is empty')
  await git(cwd, ['reset', '-q'])
  await git(cwd, ['add', '-A', '--', ...files])
  await git(cwd, ['commit', '-q', '-F', '-'], message)
  return (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
}

async function hasUpstream(cwd: string) {
  try {
    await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    return true
  } catch {
    return false
  }
}

async function unpushed(cwd: string): Promise<Set<string>> {
  try {
    const args = (await hasUpstream(cwd)) ? ['rev-list', '@{u}..HEAD'] : ['rev-list', 'HEAD', '--not', '--remotes']
    return new Set((await git(cwd, args)).split('\n').filter(Boolean))
  } catch {
    return new Set()
  }
}

export async function log(cwd: string, limit = 100): Promise<Commit[]> {
  let out: string
  try {
    out = await git(cwd, ['log', `-n${limit}`, '--format=%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e'])
  } catch {
    return [] // no commits yet
  }
  const local = await unpushed(cwd)
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, short, author, when, subject] = r.split('\x1f')
      return { hash, short, author, when, subject, pushed: !local.has(hash) }
    })
}

export async function commitDetail(cwd: string, hash: string) {
  const out = await git(cwd, ['show', '--numstat', '--format=', hash])
  const files = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split('\t')
      return { path: p.join('\t'), add: Number(a) || 0, del: Number(d) || 0 }
    })
  const show = async (rev: string, f: string) => {
    try {
      return await git(cwd, ['show', `${rev}:${f}`])
    } catch {
      return null
    }
  }
  return Promise.all(files.map(async (f) => ({ ...f, ops: lineDiff(await show(`${hash}^`, f.path), await show(hash, f.path)) })))
}

export async function aheadCount(cwd: string) {
  return (await unpushed(cwd)).size
}

export async function push(cwd: string) {
  const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean)
  if (!remotes.length) throw new GitError('This repository has no remote to push to')
  const branch = await currentBranch(cwd)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  await git(cwd, ['push', '-u', remote, branch])
  return `Pushed ${branch} to ${remote}`
}

export async function pull(cwd: string) {
  if (!(await hasUpstream(cwd))) throw new GitError('This branch has no upstream yet. Push it first.')
  const out = await git(cwd, ['pull', '--ff-only'])
  return /up to date/i.test(out) ? 'Already up to date' : 'Pulled new commits'
}
