import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Account } from '../shared/types'
import { slug } from '../shared/util'
import type { Repo } from './db'
import { home } from './env'

/** Read who is signed in from a Claude config folder (null → ~/.claude.json). */
async function signedIn(configDir: string | null): Promise<{ connected: boolean; email: string | null }> {
  const file = configDir ? path.join(configDir, '.claude.json') : path.join(home(), '.claude.json')
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'))
    const email = data.oauthAccount?.emailAddress ?? null
    return { connected: !!(data.oauthAccount || data.primaryApiKey), email }
  } catch {
    return { connected: false, email: null }
  }
}

/**
 * Accounts = Claude config folders. Found automatically: ~/.claude-<name> (the usual
 * CLAUDE_CONFIG_DIR convention) and the plain ~/.claude login. Added in Bridge: stored in the db.
 */
export async function listAccounts(repo: Repo): Promise<Account[]> {
  const h = home()
  const found: Account[] = []
  let entries: string[] = []
  try {
    entries = await fs.readdir(h)
  } catch {
    /* no home */
  }
  for (const name of entries.sort()) {
    const m = name.match(/^\.claude-(.+)$/)
    if (!m) continue
    const dir = path.join(h, name)
    if (!(await fs.stat(dir).then((s) => s.isDirectory(), () => false))) continue
    found.push({ id: `dir:${m[1]}`, label: m[1], configDir: dir, detected: true, ...(await signedIn(dir)) })
  }
  const plain = await signedIn(null)
  if (plain.connected || (await fs.stat(path.join(h, '.claude')).then(() => true, () => false)))
    found.push({ id: 'default', label: 'claude', configDir: null, detected: true, ...plain })

  for (const a of repo.listAddedAccounts()) {
    const same = found.find((f) => f.configDir === a.configDir)
    if (same) same.detected = false
    else found.push({ id: a.id, label: a.label, configDir: a.configDir, detected: false, ...(await signedIn(a.configDir)) })
  }
  const hidden = new Set(repo.getKv<string[]>('hiddenAccounts', []))
  return found.filter((a) => !hidden.has(a.id))
}

/** New account = new config folder next to the others: ~/.claude-<label>. */
export async function addAccount(repo: Repo, label: string) {
  const name = slug(label) || `account-${Date.now().toString(36)}`
  const dir = path.join(home(), `.claude-${name}`)
  await fs.mkdir(dir, { recursive: true })
  const id = `dir:${name}`
  if (!repo.listAddedAccounts().some((a) => a.id === id)) repo.addAccount(id, name, dir)
  repo.setKv('hiddenAccounts', repo.getKv<string[]>('hiddenAccounts', []).filter((h) => h !== id))
  return id
}

/** Bridge stops listing the account; its config folder is left alone. */
export function removeAccount(repo: Repo, id: string) {
  repo.removeAccount(id)
  const hidden = new Set(repo.getKv<string[]>('hiddenAccounts', []))
  hidden.add(id)
  repo.setKv('hiddenAccounts', [...hidden])
}

/** The account a project runs under: its own pick, else the default, else the first signed-in one. */
export function resolveAccount(accounts: Account[], projectAccount: string | null, defaultAccount: string | null) {
  return (
    accounts.find((a) => a.id === projectAccount) ||
    accounts.find((a) => a.id === defaultAccount) ||
    accounts.find((a) => a.connected) ||
    accounts[0] ||
    null
  )
}
