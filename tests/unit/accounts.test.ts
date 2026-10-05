import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { addAccount, listAccounts, resolveAccount } from '../../src/main/accounts'
import { openDb } from '../../src/main/db'
import { tmp } from './tmp'

let home: string
beforeEach(() => {
  home = tmp('home-')
  process.env.BRIDGE_HOME = home
})

const mk = (name: string, email?: string) => {
  fs.mkdirSync(path.join(home, name), { recursive: true })
  if (email) fs.writeFileSync(path.join(home, name, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }))
}

describe('accounts', () => {
  it('finds ~/.claude-* folders and who is signed in', async () => {
    mk('.claude-personal', 'me@example.com')
    mk('.claude-import')
    fs.writeFileSync(path.join(home, '.claude-file'), 'not a folder')
    const db = openDb(path.join(tmp(), 'a.db'))
    const list = await listAccounts(db)
    expect(list.map((a) => [a.id, a.label, a.connected, a.email])).toEqual([
      ['dir:import', 'import', false, null],
      ['dir:personal', 'personal', true, 'me@example.com'],
    ])
    expect(list[1].configDir).toBe(path.join(home, '.claude-personal'))
  })
  it('includes the plain ~/.claude login when present', async () => {
    mk('.claude')
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'x@y.z' } }))
    const list = await listAccounts(openDb(path.join(tmp(), 'a.db')))
    expect(list).toEqual([{ id: 'default', label: 'claude', configDir: null, detected: true, connected: true, email: 'x@y.z' }])
  })
  it('adds an account as a new config folder', async () => {
    const db = openDb(path.join(tmp(), 'a.db'))
    const id = await addAccount(db, 'Client Acme')
    expect(id).toBe('dir:client-acme')
    expect(fs.existsSync(path.join(home, '.claude-client-acme'))).toBe(true)
    const list = await listAccounts(db)
    expect(list.filter((a) => a.id === id)).toHaveLength(1)
  })
  it('resolves project account, then default, then first signed in', () => {
    const accs = [
      { id: 'a', label: 'a', configDir: '/a', detected: true, connected: false, email: null },
      { id: 'b', label: 'b', configDir: '/b', detected: true, connected: true, email: null },
    ]
    expect(resolveAccount(accs, 'a', 'b')!.id).toBe('a')
    expect(resolveAccount(accs, null, 'a')!.id).toBe('a')
    expect(resolveAccount(accs, 'gone', null)!.id).toBe('b')
    expect(resolveAccount([], null, null)).toBeNull()
  })
})

describe('removing accounts', () => {
  it('hides the account but keeps its folder; adding it again shows it', async () => {
    const { removeAccount } = await import('../../src/main/accounts')
    fs.mkdirSync(path.join(home, '.claude-old'))
    const db = openDb(path.join(tmp(), 'a.db'))
    expect((await listAccounts(db)).map((a) => a.id)).toEqual(['dir:old'])
    removeAccount(db, 'dir:old')
    expect(await listAccounts(db)).toEqual([])
    expect(fs.existsSync(path.join(home, '.claude-old'))).toBe(true)
    await addAccount(db, 'old')
    expect((await listAccounts(db)).map((a) => [a.id, a.detected])).toEqual([['dir:old', false]])
  })
})
