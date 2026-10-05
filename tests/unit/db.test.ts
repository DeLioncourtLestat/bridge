import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, openDb } from '../../src/main/db'
import { tmp } from './tmp'

const fresh = () => openDb(path.join(tmp(), 'b.db'))

describe('database', () => {
  it('stores projects in order and updates them', () => {
    const db = fresh()
    db.addProject({ id: 'a', name: 'a', path: '/x/a', short: 'A', color: '#000', account: null })
    db.addProject({ id: 'b', name: 'b', path: '/x/b', short: 'B', color: '#000', account: null })
    expect(db.listProjects().map((p) => p.id)).toEqual(['a', 'b'])
    db.updateProject('b', { account: 'dir:work', color: '#fff' })
    expect(db.getProject('b')).toMatchObject({ account: 'dir:work', color: '#fff' })
    expect(() => db.addProject({ id: 'c', name: 'a', path: '/x/a', short: 'A', color: '#000', account: null })).toThrow()
  })

  it('creates, updates and removes tasks and notes per project', () => {
    const db = fresh()
    const t = db.createTask('p1', { title: 'One', priority: 'high' })
    db.createTask('p2', { title: 'Other project' })
    expect(t).toMatchObject({ title: 'One', status: 'open', priority: 'high', description: '' })
    db.updateTask(t.id, { status: 'done', description: 'x', bogus: 1 } as any)
    expect(db.getTask(t.id)).toMatchObject({ status: 'done', description: 'x' })
    expect(db.listTasks('p1')).toHaveLength(1)
    db.removeTask(t.id)
    expect(db.listTasks('p1')).toHaveLength(0)
    const n = db.createNote('p1', { title: 'N', body: '# hi' })
    db.updateNote(n.id, { body: 'changed' })
    expect(db.getNote(n.id)!.body).toBe('changed')
  })

  it('keeps forks, chat messages, terminals and the assistant log', () => {
    const db = fresh()
    db.addFork({ id: 'f', projectId: 'p', title: 'F', branch: 'agent/f', path: '/w/f', open: true, sessionId: 's', sessionStarted: false, state: 'idle', autoNamed: false, autoBranch: false, createdAt: 1 })
    db.updateFork('f', { open: false, state: 'wait', sessionStarted: true })
    expect(db.getFork('f')).toMatchObject({ open: false, state: 'wait', sessionStarted: true })
    const m = db.addMessage('f', 'user', 'hi', [{ kind: 'task', id: 1, title: 'T' }])
    const a = db.addMessage('f', 'agent', '')
    db.updateMessage(a.id, 'done', ['Read a.ts'])
    expect(db.listMessages('f').map((x) => [x.role, x.text, x.tools, x.refs])).toEqual([['user', 'hi', [], [{ kind: 'task', id: 1, title: 'T' }]], ['agent', 'done', ['Read a.ts'], []]])
    expect(m.id).toBeLessThan(a.id)
    db.addTerminal('t1', 'f', 'zsh 1')
    db.addTerminal('t2', 'f', 'zsh 2')
    db.renameTerminal('t1', 'server')
    db.setTerminalBuffer('t1', 'x'.repeat(250_000))
    expect(db.listTerminals('f').map((t) => t.name)).toEqual(['server', 'zsh 2'])
    expect(db.terminalBuffer('t1')).toHaveLength(200_000)
    db.removeTerminal('t2')
    expect(db.listTerminals('f')).toHaveLength(1)
    db.addAssistant('p', 'assistant', 'ok', ['create_task()'], { kind: 'task', id: 3 })
    expect(db.listAssistant('p')[0]).toMatchObject({ text: 'ok', tools: ['create_task()'], open: { kind: 'task', id: 3 } })
  })

  it('removing a project removes everything under it', () => {
    const db = fresh()
    db.addProject({ id: 'p', name: 'p', path: '/p', short: 'P', color: '#000', account: null })
    db.createTask('p', {}); db.createNote('p', {})
    db.addFork({ id: 'f', projectId: 'p', title: 'F', branch: 'b', path: '/w', open: true, sessionId: 's', sessionStarted: false, state: 'idle', autoNamed: false, autoBranch: false, createdAt: 1 })
    db.addMessage('f', 'user', 'x'); db.addTerminal('t', 'f', 'zsh')
    db.removeProject('p')
    expect([db.listProjects(), db.listTasks('p'), db.listNotes('p'), db.listForks('p'), db.listMessages('f'), db.listTerminals('f')].every((l) => l.length === 0)).toBe(true)
  })

  it('merges settings over defaults and keeps UI state', () => {
    const db = fresh()
    expect(db.getSettings()).toEqual(DEFAULT_SETTINGS)
    db.setSettings({ accent: 'Green', radius: 6 })
    expect(db.getSettings()).toMatchObject({ accent: 'Green', radius: 6, tabSize: 2 })
    db.setKv('ui:p', { tab: 'notes' })
    expect(db.getKv('ui:p', {})).toEqual({ tab: 'notes' })
    expect(db.getKv('ui:none', { a: 1 })).toEqual({ a: 1 })
  })

  it('survives reopening the file', () => {
    const file = path.join(tmp(), 'b.db')
    const a = openDb(file)
    a.createTask('p', { title: 'persist' })
    a.close()
    expect(openDb(file).listTasks('p')[0].title).toBe('persist')
  })
})
