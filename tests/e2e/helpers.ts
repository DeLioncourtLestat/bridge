import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ROOT = path.resolve(__dirname, '../..')
const gitEnv = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
export const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...gitEnv }, encoding: 'utf8' })

/** A sandbox: fake home with two Claude accounts, data folder, and repos with a bare remote. */
export function makeSandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-')))
  const home = path.join(base, 'home')
  for (const [name, email] of [['personal', 'personal@example.com'], ['work', 'work@example.com']]) {
    fs.mkdirSync(path.join(home, `.claude-${name}`), { recursive: true })
    fs.writeFileSync(path.join(home, `.claude-${name}`, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }))
  }
  const projects = path.join(base, 'projects')
  const mkRepo = (name: string) => {
    const dir = path.join(projects, name)
    const remote = path.join(base, 'remotes', `${name}.git`)
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(remote, { recursive: true })
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(dir, 'init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nSample project.\n`)
    fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), "export const answer = 42\n\nexport function hello(name: string) {\n  return `Hello, ${name}`\n}\n")
    fs.writeFileSync(path.join(dir, 'src', 'lib', 'util.ts'), 'export const twice = (n: number) => n * 2\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'Initial commit')
    git(dir, 'remote', 'add', 'origin', remote)
    git(dir, 'push', '-q', '-u', 'origin', 'main')
    git(dir, 'branch', 'feature/existing')
    return dir
  }
  return {
    base,
    home,
    userData: path.join(base, 'userData'),
    fakeLog: path.join(base, 'fake-claude.log'),
    repoA: mkRepo('easy-calendar'),
    repoB: mkRepo('shop-api'),
    plainDir: (() => { const d = path.join(projects, 'plain-folder'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'a.txt'), 'x'); return d })(),
    readLog(): any[] {
      return fs.existsSync(this.fakeLog) ? fs.readFileSync(this.fakeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    },
  }
}
export type Sandbox = ReturnType<typeof makeSandbox>

export async function launch(sb: Sandbox, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: {
      ...process.env,
      ...gitEnv,
      BRIDGE_USER_DATA: sb.userData,
      BRIDGE_HOME: sb.home,
      BRIDGE_CLAUDE_BIN: path.join(ROOT, 'tests/fixtures/fake-claude.cjs'),
      BRIDGE_FAKE_LOG: sb.fakeLog,
      ...extraEnv,
    },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.shell')
  return { app, page }
}

/** Make the native folder picker return `dir`. */
export async function stubFolder(app: ElectronApplication, dir: string) {
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as any }, dir)
}

/** Click + in Tasks/Notes and wait until the new, empty item is the open one. */
export async function newItem(page: Page, kind: 'task' | 'note') {
  const before = await page.locator(kind === 'task' ? '.ti' : '.ni').count()
  await page.click(kind === 'task' ? '#addTask' : '#addNote')
  await page.locator(kind === 'task' ? '.ti' : '.ni').nth(before).waitFor()
  await page.waitForFunction((id) => (document.getElementById(id) as HTMLInputElement | null)?.value === '', kind === 'task' ? 'tTitle' : 'nTitle')
}

export async function addProject(app: ElectronApplication, page: Page, dir: string) {
  await stubFolder(app, dir)
  await page.click('#addProj')
}
