import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db'
import { worktreeDir } from '../../src/main/git'
import { startBridgeApi } from '../../src/main/bridgeApi'
import { doneNotice, unseenCount } from '../../src/main/notify'
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
    expect((await svc.listForks(p.id)).find((x) => x.id === g.id)!.open).toBe(false)
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
    expect((await svc.listForks(p.id))[0]).toMatchObject({ state: 'wait', sessionStarted: true })
    expect(events.some((e) => e.kind === 'update')).toBe(true)
    expect((await svc.status(f.id)).map((c) => c.path)).toEqual(['AGENT_WORK.md', 'README.md'])
    // second turn resumes the same session
    await svc.send(f.id, 'More', [])
    await done(f.id, 2)
    expect(readLog()[1]).toMatchObject({ session: f.sessionId, resume: true })
    svc.markSeen(f.id)
    expect((await svc.listForks(p.id))[0].state).toBe('idle')
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
    const after = (await svc.listForks(p.id))[0]
    expect(after).toMatchObject({ title: 'Recurring events', branch: 'agent/recurring-events', path: worktreeDir(dir, 'agent/recurring-events') })
    expect(fs.existsSync(f.path)).toBe(false)
    await done(f.id)
    expect(fs.realpathSync(readLog()[0].cwd)).toBe(fs.realpathSync(after.path))
  })

  it('ghosts run in the project folder on its branch, several at once, and follow branch switches', async () => {
    const { svc, done } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const a = await svc.createGhost(p.id)
    const b = await svc.createGhost(p.id, { title: 'Header' })
    expect(a).toMatchObject({ title: 'Ghost 1', ghost: true, path: dir, branch: 'main' })
    expect(b).toMatchObject({ title: 'Header', ghost: true, path: dir, branch: 'main' })
    await svc.send(a.id, 'one', [])
    await svc.send(b.id, 'two', [])
    await Promise.all([done(a.id), done(b.id)])
    const log = readLog()
    expect(log.map((l) => fs.realpathSync(l.cwd))).toEqual([fs.realpathSync(dir), fs.realpathSync(dir)])
    expect(log[0].prompt).toMatch(/^Note: you work directly in the main project folder/)
    expect(new Set(log.map((l) => l.session)).size).toBe(2)
    sh(dir, 'checkout', '-q', '-b', 'feature/ghosts')
    expect((await svc.listForks(p.id)).map((f) => f.branch)).toEqual(['feature/ghosts', 'feature/ghosts'])
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
    expect((await svc.listForks(p.id))[0].state).toBe('idle')
    await svc.send(f.id, 'SLOW job', [])
    await expect(svc.send(f.id, 'again', [])).rejects.toThrow(/still working/)
    svc.stop(f.id)
    await done(f.id, 2)
    expect(svc.agents.isRunning(f.id)).toBe(false)
  })

  it('searches file names and text in the project folder or a fork', async () => {
    const { svc } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'Untracked Needle here\n')
    fs.writeFileSync(path.join(dir, 'node_modules'), 'needle ignored\n')
    const t = { projectId: p.id }
    expect(await svc.searchFiles(t)).toEqual(expect.arrayContaining(['README.md', 'src/a.ts', 'notes.txt']))
    expect((await svc.grep(t, 'needle')).hits).toEqual([{ file: 'notes.txt', line: 1, text: 'Untracked Needle here' }])
    expect((await svc.grep(t, 'needle', { caseSensitive: true })).hits).toEqual([])
    expect((await svc.grep(t, 'const a = \\d', { regex: true })).hits).toMatchObject([{ file: 'src/a.ts', line: 1 }])
    expect((await svc.grep(t, '   ')).hits).toEqual([])
    await expect(svc.grep(t, '(', { regex: true })).rejects.toThrow(/Invalid search/)
    expect(await svc.peekFile(t, 'src/a.ts')).toBe('export const a = 1\n')
    const f = await svc.createFork(p.id, { title: 'x', branch: 'agent/x', newBranch: true })
    expect((await svc.grep({ projectId: p.id, forkId: f.id }, 'needle')).hits).toEqual([])
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

  it('gives the agent Bridge tools through --mcp-config when the API is up', async () => {
    const events: AgentEvent[] = []
    const svc = createService(openDb(path.join(tmp(), 't.db')), (ch, p) => { if (ch === 'agent:event') events.push(p as AgentEvent) },
      () => ({ node: '/bin/node', script: '/app/mcp.js', url: 'http://127.0.0.1:1', token: 'tok', env: { ELECTRON_RUN_AS_NODE: '1' } }))
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const g = await svc.createGhost(p.id)
    await svc.send(g.id, 'hi', [])
    await new Promise<void>((r) => { const t = () => (events.some((e) => e.kind === 'done') ? r() : setTimeout(t, 50)); t() })
    const call = readLog()[0]
    expect(call.allowed).toBe('mcp__bridge')
    expect(call.hint).toMatch(/mcp__bridge__\* tools manage this project/)
    expect(JSON.parse(call.mcp)).toEqual({ mcpServers: { bridge: { type: 'stdio', command: '/bin/node', args: ['/app/mcp.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', BRIDGE_API: 'http://127.0.0.1:1', BRIDGE_TOKEN: 'tok', BRIDGE_PROJECT: p.id, BRIDGE_FORK: g.id } } } })
  })

  it('instructions: project ones for every fork unless switched off there, plus the fork’s own, sent to the agent', async () => {
    const { svc, done } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const rspec = svc.createInstruction(p.id, { title: 'Tests', body: 'Use RSpec, not Minitest.' })
    const lang = svc.createInstruction(p.id, { title: 'Language', body: 'Answer in Russian.' })
    svc.createInstruction(p.id, {}) // empty ones are skipped
    const a = await svc.createFork(p.id, { title: 'a', branch: 'agent/a', newBranch: true })
    const b = await svc.createGhost(p.id)
    svc.createInstruction(p.id, { forkId: a.id, title: 'Scope', body: 'Only touch app/models.' })
    svc.setInstructionOn(a.id, lang.id, false)
    expect(svc.instructionsFor(a.id)).toBe("The user's standing instructions for this project (set in Bridge). Follow them in everything you do here, unless the user says otherwise in the chat.\n\n## Tests\n\nUse RSpec, not Minitest.\n\n## Scope\n\nOnly touch app/models.")
    expect(svc.instructionsFor(b.id)).toContain('## Language')
    expect(svc.instructionsFor(b.id)).not.toContain('Scope')
    expect(svc.listForkInstructions(b.id)).toEqual([])
    expect(svc.listInstructions(p.id).map((i) => i.title)).toEqual(['Tests', 'Language', ''])
    // the run gets them as the appended system prompt
    await svc.send(a.id, 'go', [])
    await done(a.id)
    expect(readLog()[0].hint).toContain('Use RSpec, not Minitest.')
    expect(readLog()[0].hint).not.toContain('Russian')
    svc.setInstructionOn(a.id, lang.id, true)
    svc.updateInstruction(rspec.id, { body: 'Use RSpec 3.' })
    expect(svc.instructionsFor(a.id)).toContain('Use RSpec 3.\n\n## Language')
    svc.removeInstruction(rspec.id)
    expect(svc.instructionsFor(a.id)).not.toContain('RSpec')
    expect(() => svc.createInstruction(p.id, { forkId: 'nope' })).toThrow('Fork not found')
  })

  it('a resumed session gets the instructions again in the message, only when they changed', async () => {
    const { svc, done } = setup()
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const g = await svc.createGhost(p.id)
    const turn = async (text: string, n: number) => { await svc.send(g.id, text, []); await done(g.id, n); return readLog()[n - 1] }
    // first turn: new session, nothing set yet
    let c = await turn('one', 1)
    expect(c.resume).toBe(false)
    expect(c.prompt).toBe('Note: you work directly in the main project folder. Other agents may be editing files here at the same time. Do not revert, reformat or stash changes you did not make, and do not switch branches.\n\none')
    // an instruction added mid-session reaches the resumed session through the message
    const inc = svc.createInstruction(p.id, { title: 'Incidents', body: 'You handle import incidents.' })
    c = await turn('find the incidents instruction', 2)
    expect(c.resume).toBe(true)
    expect(c.prompt).toMatch(/^<bridge-instructions>\nThe standing instructions changed\. These replace any earlier ones from Bridge:\n\n.*## Incidents\n\nYou handle import incidents\.\n<\/bridge-instructions>\n\nNote: you work/s)
    // unchanged → not repeated
    c = await turn('three', 3)
    expect(c.prompt).not.toContain('bridge-instructions')
    // switched off here → the session is told
    svc.setInstructionOn(g.id, inc.id, false)
    c = await turn('four', 4)
    expect(c.prompt).toMatch(/^<bridge-instructions>\nThe user removed all standing instructions in Bridge/)
    // the chat shows only what the user typed
    expect(svc.messages(g.id).filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['one', 'find the incidents instruction', 'three', 'four'])
  })

  it('the done notice names the fork and quotes the reply; unseen forks are counted', async () => {
    const db = openDb(path.join(tmp(), 'n.db'))
    const events: AgentEvent[] = []
    const svc = createService(db, (ch, p) => { if (ch === 'agent:event') events.push(p as AgentEvent) })
    const { dir } = repo()
    const p = await svc.addProject(dir)
    const f = await svc.createFork(p.id, { title: 'Export', branch: 'agent/e', newBranch: true })
    const g = await svc.createGhost(p.id, { title: 'Header' })
    expect(unseenCount(db)).toBe(0)
    await svc.send(f.id, 'go', [])
    await new Promise<void>((r) => { const t = () => (events.some((e) => e.kind === 'done') ? r() : setTimeout(t, 50)); t() })
    expect(doneNotice(db, f.id)).toEqual({ title: `Fork “Export” · ${p.name}`, body: 'Done. I wrote AGENT_WORK.md and updated README.md.', projectId: p.id })
    expect(doneNotice(db, g.id, 'Simulated failure\nstack')).toMatchObject({ title: `Ghost “Header” · ${p.name}`, body: 'Failed: Simulated failure' })
    expect(doneNotice(db, g.id)!.body).toBe('The agent finished.')
    expect(doneNotice(db, 'nope')).toBeNull()
    expect(unseenCount(db)).toBe(1)
    svc.markSeen(f.id)
    expect(unseenCount(db)).toBe(0)
  })

  it('Bridge tools create and change tasks and notes of one project over the local API', async () => {
    const db = openDb(path.join(tmp(), 'a.db'))
    const changed: string[] = []
    const api = await startBridgeApi(db, (pid) => changed.push(pid))
    db.addProject({ id: 'p', name: 'p', path: '/p', short: 'P', color: '#000', account: null })
    db.addProject({ id: 'q', name: 'q', path: '/q', short: 'Q', color: '#000', account: null })
    const call = async (name: string, args: object, token = api.token, projectId = 'p') =>
      (await fetch(`${api.url}/tool`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ projectId, name, args }) })).json()
    expect(await call('create_task', { title: 'Add import', priority: 'high' })).toEqual({ ok: true, text: 'Created task #1 “Add import” (high).' })
    expect(await call('update_task', { id: 1, status: 'done' })).toMatchObject({ ok: true })
    expect(db.getTask(1)).toMatchObject({ status: 'done', priority: 'high' })
    expect((await call('list_tasks', {})).text).toBe('No tasks.')
    expect((await call('list_tasks', { status: 'all' })).text).toBe('#1 [done] (high) Add import')
    expect(await call('create_note', { title: 'Decision', body: 'Use SQLite' })).toMatchObject({ ok: true, text: 'Saved note #1 “Decision”.' })
    await call('update_note', { id: 1, append: '- and WAL' })
    expect(db.getNote(1)!.body).toBe('Use SQLite\n\n- and WAL')
    expect((await call('list_notes', { id: 1 })).text).toBe('# Decision\n\nUse SQLite\n\n- and WAL')
    // another project's items and bad input are refused
    expect(await call('update_task', { id: 1, status: 'open' }, api.token, 'q')).toEqual({ ok: false, error: 'No task 1 in this project. Call list_tasks for ids.' })
    expect(await call('create_task', {})).toEqual({ ok: false, error: 'title is required' })
    expect(await call('drop_table', {})).toEqual({ ok: false, error: 'Unknown tool drop_table' })
    expect((await fetch(`${api.url}/tool`, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).status).toBe(401)
    db.createInstruction('p', null, { title: 'Incidents', body: 'Handle imports.' })
    expect((await call('list_instructions', {})).text).toBe('## Incidents\n\nHandle imports.')
    expect(changed).toEqual(['p', 'p', 'p', 'p'])
    await api.close()
  })
})
