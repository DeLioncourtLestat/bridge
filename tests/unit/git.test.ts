import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as g from '../../src/main/git'
import { repo, sh } from './tmp'

describe('git service', () => {
  it('puts fork folders in a sibling <project>_worktrees folder', () => {
    expect(g.worktreeDir('/a/b/easy-calendar', 'agent/export-json')).toBe('/a/b/easy-calendar_worktrees/export-json')
  })

  it('creates worktrees on new and existing branches, and git refuses a busy branch', async () => {
    const { dir } = repo()
    const wt = g.worktreeDir(dir, 'agent/one')
    await g.addWorktree(dir, wt, 'agent/one', true)
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true)
    expect(await g.currentBranch(wt)).toBe('agent/one')
    const wt2 = g.worktreeDir(dir, 'feature/x')
    await g.addWorktree(dir, wt2, 'feature/x', false)
    expect(await g.currentBranch(wt2)).toBe('feature/x')
    await expect(g.addWorktree(dir, wt2 + '-again', 'feature/x', false)).rejects.toThrow(/already (checked out|used by worktree)/)
    await expect(g.addWorktree(dir, wt + '-main', 'main', false)).rejects.toThrow()
    const trees = await g.listWorktrees(dir)
    expect(trees.map((t) => t.branch).sort()).toEqual(['agent/one', 'feature/x', 'main'])
    expect(await g.listBranches(dir)).toEqual(expect.arrayContaining(['main', 'feature/x', 'agent/one']))
  })

  it('reports changes with line counts, lists files and diffs', async () => {
    const { dir } = repo()
    fs.appendFileSync(path.join(dir, 'README.md'), 'added\n')
    fs.writeFileSync(path.join(dir, 'src', 'new.ts'), 'a\nb\n')
    fs.rmSync(path.join(dir, 'src', 'a.ts'))
    fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'ignored')
    const st = await g.status(dir)
    expect(st).toEqual([
      { path: 'README.md', kind: 'M', add: 1, del: 0 },
      { path: 'src/a.ts', kind: 'D', add: 0, del: 1 },
      { path: 'src/new.ts', kind: 'A', add: 2, del: 0 },
    ])
    expect(await g.listFiles(dir)).toEqual(['.gitignore', 'README.md', 'src/new.ts'])
    const ops = await g.fileDiff(dir, 'README.md')
    expect(ops.filter((o) => o.t === '+').map((o) => o.s)).toEqual(['added'])
  })

  it('reads and writes inside the worktree only', async () => {
    const { dir } = repo()
    await g.writeFile(dir, 'src/deep/new.txt', 'hi')
    expect(await g.readFile(dir, 'src/deep/new.txt')).toBe('hi')
    expect(await g.fileAtHead(dir, 'README.md')).toContain('second line')
    expect(await g.fileAtHead(dir, 'nope.md')).toBeNull()
    expect(() => g.safePath(dir, '../outside.txt')).toThrow(/outside/)
    await expect(g.writeFile(dir, '../../etc.txt', 'x')).rejects.toThrow(/outside/)
  })

  it('commits only the selected files and tracks unpushed commits', async () => {
    const { dir, remote } = repo()
    fs.appendFileSync(path.join(dir, 'README.md'), 'one\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
    const hash = await g.commit(dir, ['b.txt'], 'Add b\n\nbody')
    expect(hash).toMatch(/^[0-9a-f]{7,}$/)
    expect((await g.status(dir)).map((c) => c.path)).toEqual(['README.md'])
    let log = await g.log(dir)
    expect(log[0]).toMatchObject({ subject: 'Add b', pushed: false })
    expect(log[1]).toMatchObject({ subject: 'second', pushed: true })
    expect(await g.aheadCount(dir)).toBe(1)
    const detail = await g.commitDetail(dir, log[0].hash)
    expect(detail).toEqual([{ path: 'b.txt', add: 1, del: 0, ops: [{ t: '+', s: 'b', b: 1 }] }])
    await expect(g.commit(dir, [], 'x')).rejects.toThrow(/Nothing selected/)
    await expect(g.commit(dir, ['README.md'], '  ')).rejects.toThrow(/empty/)
    expect(await g.push(dir)).toMatch(/Pushed main to origin/)
    log = await g.log(dir)
    expect(log[0].pushed).toBe(true)
    expect(sh(remote, 'log', '--format=%s', '-1', 'main').trim()).toBe('Add b')
    expect(await g.pull(dir)).toBe('Already up to date')
  })

  it('pushes a new fork branch with upstream, pull needs an upstream', async () => {
    const { dir, remote } = repo()
    const wt = g.worktreeDir(dir, 'agent/p')
    await g.addWorktree(dir, wt, 'agent/p', true)
    await expect(g.pull(wt)).rejects.toThrow(/no upstream/)
    fs.writeFileSync(path.join(wt, 'x.txt'), 'x\n')
    await g.commit(wt, ['x.txt'], 'x')
    expect((await g.log(wt))[0].pushed).toBe(false)
    expect(await g.push(wt)).toMatch(/Pushed agent\/p/)
    expect(sh(remote, 'branch', '--list', 'agent/p').trim()).toBe('agent/p')
    expect((await g.log(wt))[0].pushed).toBe(true)
  })

  it('renames a branch and moves its worktree', async () => {
    const { dir } = repo()
    const wt = g.worktreeDir(dir, 'agent/fork-1')
    await g.addWorktree(dir, wt, 'agent/fork-1', true)
    await g.renameBranch(wt, 'agent/fork-1', 'agent/better')
    const to = g.worktreeDir(dir, 'agent/better')
    await g.moveWorktree(dir, wt, to)
    expect(await g.currentBranch(to)).toBe('agent/better')
    expect(fs.existsSync(wt)).toBe(false)
  })

  it('fails clearly when there is no remote', async () => {
    const { dir } = repo()
    sh(dir, 'remote', 'remove', 'origin')
    await expect(g.push(dir)).rejects.toThrow(/no remote/)
    expect(await g.isRepo(dir)).toBe(true)
    expect(await g.isRepo(path.dirname(path.dirname(dir)))).toBe(false)
  })
})
