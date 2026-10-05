import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db'
import { worktreeDir } from '../../src/main/git'
import { createService } from '../../src/main/service'
import type { AgentEvent } from '../../src/shared/types'
import { repo, sh, tmp } from './tmp'

const FAKE = path.resolve(__dirname, '../fixtures/fake-claude.cjs')
let log: string
let home: string

beforeEach(() => {
  home = tmp('home-')
  for (const n of ['personal', 'work']) {
    fs.mkdirSync(path.join(home, `.claude-${n}`))
    fs.writeFileSync(path.join(home, `.claude-${n}`, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: `${n}@x.y` } }))
  }
  log = path.join(tmp(), 'fake.log')
  Object.assign(process.env, { BRIDGE_HOME: home, BRIDGE_CLAUDE_BIN: FAKE, BRIDGE_FAKE_LOG: log })
})

const readLog = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])

function setup() {
  const events: AgentEvent[] = []
  const svc = createService(openDb(path.join(tmp(), 's.db')), (ch, p) => { if (ch === 'agent:event') events.push(p as AgentEvent) })
  const done = (forkId: string, n = 1) =>
    new Promise<void>((resolve, reject) => {
      const t = Date.now()
      const tick = () => {
        if (events.filter((e) => e.forkId === forkId && e.kind === 'done').length >= n) return resolve()
        if (Date.now() - t > 15000) return reject(new Error('agent did not finish'))
        setTimeout(tick, 50)
      }
      tick()
    })
  return { svc, events, done }
}

describe('service', () => {
  it('adds git projects, refuses plain folders and repos without commits', async () => {
    const { svc } = setup()
    const { dir } = repo('easy-calendar')
    const p = await svc.addProject(path.join(dir, 'src'))
    expect(p).toMatchObject({ name: 'easy-calendar', path: dir, short: 'EC', account: null })
    expect((await svc.addProject(dir)).id).toBe(p.id)
    const plain = tmp()
    await expect(svc.addProject(plain)).rejects.toThrow('NOT_GIT')
    const empty = tmp()
    sh(empty, 'init', '-q')
    await expect(svc.addProject(empty)).rejects.toThrow(/no commits/)
    const inited = await svc.initRepo(plain)
    expect(inited.path).toBe(fs.realpathSync(plain))
    await expect(svc.addProject('/definitely/not/here')).rejects.toThrow(/not found/)
  })

  it('creates forks on new and existing branches and reports busy branches', async () => {
    const { svc } = setup()
    const { dir } = repo('easy-calendar')
    const p = await svc.addProject(dir)
    const f = await svc.createFork(p.id, { title: 'Export', branch: 'agent/export', newBranch: true })
    expect(f).toMatchObject({ title: 'Export', branch: 'agent/export', path: worktreeDir(dir, 'agent/export'), open: true, state: 'idle', autoNamed: false })
    expect(fs.existsSync(path.join(f.path, 'README.md'))).toBe(true)
    await expect(svc.createFork(p.id, { branch: 'agent/export', newBranch: true })).rejects.toThrow(/already exists/)
    await expect(svc.createFork(p.id, { branch: 'bad..name', newBranch: true })).rejects.toThrow(/letters, digits/)
    await expect(svc.createFork(p.id, { branch: 'nope', newBranch: false })).rejects.toThrow(/doesn’t exist/)
    await expect(svc.createFork(p.id, { branch: 'main', newBranch: false })).rejects.toThrow()
    const b = await svc.branches(p.id)
    expect(b.find((x) => x.name === 'main')!.usedBy).toBe('checked out in the project folder')
    expect(b.find((x) => x.name === 'agent/export')!.usedBy).toBe('used by “Export”')
    expect(b.find((x) => x.name === 'feature/x')!.usedBy).toBeNull()
    const g = await svc.createFork(p.id, { branch: 'feature/x', newBranch: false })
    expect(g).toMatchObject({ title: 'Fork 2', branch: 'feature/x', autoNamed: true, autoBranch: false })
    svc.setForkOpen(g.id, false)
    expect(svc.listForks(p.id).find((x) => x.id === g.id)!.open).toBe(false)
    // folder name collision gets a suffix
    fs.mkdirSync(worktreeDir(dir, 'agent/clash'), { recursive: true })
    expect((await svc.createFork(p.id, { branch: 'agent/clash', newBranch: true })).path).toBe(worktreeDir(dir, 'agent/clash') + '-2')
  })

  it('sends work to the agent under the project account and resumes the session', async () => {
    const { svc, events, done } = setup()
    const { dir } = repo('shop-api')
    const p = await svc.addProject(dir)
    svc.updateProject(p.id, { account: 'dir:work' })
    const task = svc.createTask(p.id, { title: 'Index orders', description: 'by status' })
    const note = svc.createNote(p.id, { title: 'ADR', body: 'Stripe only' })
    const f = await svc.createFork(p.id, { title: 'Orders', branch: 'agent/orders', newBranch: true })
    const res = await svc.send(f.id, 'Add an index', [{ kind: 'task', id: task.id }, { kind: 'note', id: note.id }])
    expect(res.user.refs).toEqual([{ kind: 'task', id: task.id, title: 'Index orders' }, { kind: 'note', id: note.id, title: 'ADR' }])
    expect(svc.listTasks(p.id)[0].status).toBe('progress')
    await done(f.id)
    const [call] = readLog()
    expect(call).toMatchObject({ mode: 'agent', config: path.join(home, '.claude-work'), session: f.sessionId, resume: false, permission: 'acceptEdits' })
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(f.path))
    expect(call.prompt).toContain('Task: Index orders')
    expect(call.prompt).toContain('Note: ADR\nStripe only')
    const msgs = svc.messages(f.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'agent'])
    expect(msgs[1].tools).toEqual(['Read README.md', 'Wrote AGENT_WORK.md', 'Edited README.md'])
    expect(msgs[1].text).toContain('Done.')
    expect(svc.listForks(p.id)[0]).toMatchObject({ state: 'wait', sessionStarted: true })
    expect(events.some((e) => e.kind === 'update')).toBe(true)
    expect((await svc.status(f.id)).map((c) => c.path)).toEqual(['AGENT_WORK.md', 'README.md'])
    // second turn resumes the same session
    await svc.send(f.id, 'More', [])
    await done(f.id, 2)
    expect(readLog()[1]).toMatchObject({ session: f.sessionId, resume: true })
    svc.markSeen(f.id)
    expect(svc.listForks(p.id)[0].state).toBe('idle')
  })

  it('uses the default account when the project has none', async () => {
    const { svc, done } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    svc.setSettings({ defaultAccount: 'dir:personal' })
    const f = await svc.createFork(p.id, { title: 'x', branch: 'agent/x', newBranch: true })
    await svc.send(f.id, 'go', [])
    await done(f.id)
    expect(readLog()[0].config).toBe(path.join(home, '.claude-personal'))
  })

  it('names an unnamed fork from its first task, branch and folder included', async () => {
    const { svc, done } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const t = svc.createTask(p.id, { title: 'Recurring events' })
    const f = await svc.createFork(p.id, { branch: 'agent/fork-1', newBranch: true })
    expect(f).toMatchObject({ title: 'Fork 1', autoNamed: true, autoBranch: true })
    await svc.send(f.id, '', [{ kind: 'task', id: t.id }])
    const after = svc.listForks(p.id)[0]
    expect(after).toMatchObject({ title: 'Recurring events', branch: 'agent/recurring-events', path: worktreeDir(dir, 'agent/recurring-events') })
    expect(fs.existsSync(f.path)).toBe(false)
    await done(f.id)
    expect(fs.realpathSync(readLog()[0].cwd)).toBe(fs.realpathSync(after.path))
  })

  it('reports agent failures and lets you stop a run', async () => {
    const { svc, done } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const f = await svc.createFork(p.id, { title: 'x', branch: 'agent/x', newBranch: true })
    await svc.send(f.id, 'FAIL please', [])
    await done(f.id)
    expect(svc.messages(f.id).map((m) => m.role)).toEqual(['user', 'error'])
    expect(svc.messages(f.id)[1].text).toBe('Simulated failure')
    expect(svc.listForks(p.id)[0].state).toBe('idle')
    await svc.send(f.id, 'SLOW job', [])
    await expect(svc.send(f.id, 'again', [])).rejects.toThrow(/still working/)
    svc.stop(f.id)
    await done(f.id, 2)
    expect(svc.agents.isRunning(f.id)).toBe(false)
  })

  it('reads, writes, commits and pushes inside a fork', async () => {
    const { svc } = setup()
    const { dir, remote } = repo()
    const p = await svc.addProject(dir)
    const f = await svc.createFork(p.id, { title: 'x', branch: 'agent/x', newBranch: true })
    await svc.writeFile(f.id, 'src/a.ts', 'export const a = 2\n')
    expect(await svc.readFile(f.id, 'src/a.ts')).toEqual({ content: 'export const a = 2\n', head: 'export const a = 1\n' })
    expect(await svc.status(f.id)).toEqual([{ path: 'src/a.ts', kind: 'M', add: 1, del: 1 }])
    await svc.commit(f.id, ['src/a.ts'], 'Bump a')
    expect(await svc.ahead(f.id)).toBe(1)
    await svc.push(f.id)
    expect(sh(remote, 'log', '--format=%s', '-1', 'agent/x').trim()).toBe('Bump a')
    expect(await svc.ahead(f.id)).toBe(0)
    expect(sh(dir, 'log', '--format=%s', '-1').trim()).toBe('second') // main untouched
  })

  it('the assistant turns requests into tasks and notes', async () => {
    const { svc } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    svc.updateProject(p.id, { account: 'dir:work' })
    const a = await svc.assistantSend(p.id, 'Create task fix week start, urgent')
    expect(a.tools).toEqual(['create_task(title: "Fix week start", priority: high)'])
    expect(a.open).toMatchObject({ kind: 'task' })
    expect(svc.listTasks(p.id)[0]).toMatchObject({ title: 'Fix week start', priority: 'high', description: 'from assistant' })
    await svc.assistantSend(p.id, 'Note: Supabase — keep tokens server-side')
    expect(svc.listNotes(p.id)[0]).toMatchObject({ title: 'Supabase', body: '- keep tokens server-side' })
    const l = await svc.assistantSend(p.id, 'what is open')
    expect(l.text).toContain('1 open: **Fix week start**')
    const call = readLog()[0]
    expect(call).toMatchObject({ mode: 'assistant', config: path.join(home, '.claude-work'), model: 'haiku', tools: '' })
    expect(svc.assistantHistory(p.id).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
  })

  it('the assistant falls back to the offline parser when the CLI fails', async () => {
    const broken = path.join(tmp(), 'broken.cjs')
    fs.writeFileSync(broken, 'process.exit(3)')
    process.env.BRIDGE_CLAUDE_BIN = broken
    const { svc } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    await svc.assistantSend(p.id, 'Создай задачу проверить офлайн, срочно')
    expect(svc.listTasks(p.id)[0]).toMatchObject({ title: 'Проверить офлайн', priority: 'high' })
    const r = await svc.assistantSend(p.id, 'hello')
    expect(r.text).toMatch(/I can add tasks and notes/)
  })
})
