import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { listAccounts } from './accounts'
import { findClaude } from './agent'
import { openDb } from './db'
import { loadShellPath } from './env'
import { COMMANDS, shortcut, type CommandId } from '../shared/keymap'
import { startBridgeApi, type BridgeApi } from './bridgeApi'
import { doneNotice, unseenCount } from './notify'
import { createService, UserError } from './service'
import { Terminals } from './terminals'

// Tests run against their own data folder.
if (process.env.BRIDGE_USER_DATA) app.setPath('userData', process.env.BRIDGE_USER_DATA)
app.setName('Bridge')

let win: BrowserWindow | null = null
const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 560,
    show: false,
    backgroundColor: '#0e0e10',
    title: 'Bridge',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null })
}

function buildMenu(keys: Record<string, string>) {
  const cmd = (name: string) => () => send('menu', name)
  const item = (id: CommandId, label?: string): Electron.MenuItemConstructorOptions => ({
    label: label ?? COMMANDS.find((c) => c.id === id)!.label, accelerator: shortcut(keys, id) || undefined, click: cmd(id),
  })
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ label: 'Bridge', submenu: [{ role: 'about' }, { type: 'separator' }, item('settings', 'Settings…'), { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as Electron.MenuItemConstructorOptions]
      : []),
    { label: 'File', submenu: [item('open-project', 'Open Project…'), item('new-fork', 'New Fork or Ghost…'), ...(process.platform === 'darwin' ? [] : [item('settings', 'Settings…')]), { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'Go', submenu: [item('go-to-file', 'Go to File…'), item('find-in-files', 'Find in Files…')] },
    { label: 'View', submenu: [item('tasks', 'Tasks'), item('notes', 'Notes'), item('instructions', 'Instructions'), { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const repo = openDb(path.join(app.getPath('userData'), 'bridge.db'))
  // the agent's tasks-and-notes tools call back into this process
  let api: BridgeApi | null = null
  // an agent finished: dock badge, and a notification when Bridge isn't in front
  const badge = () => app.dock?.setBadge(unseenCount(repo) ? String(unseenCount(repo)) : '')
  const emit = (channel: string, payload: any) => {
    send(channel, payload)
    if (channel !== 'agent:event' || payload.kind !== 'done') return
    badge()
    // tests set BRIDGE_NOTIFY_LOG: notices go to that file, whatever the focus, instead of the screen
    const testLog = process.env.BRIDGE_NOTIFY_LOG
    if (!repo.getSettings().notify || !win || (!testLog && (win.isFocused() || !Notification.isSupported()))) return
    const n = doneNotice(repo, payload.forkId, payload.error)
    if (!n) return
    if (testLog) return appendFileSync(testLog, JSON.stringify({ ...n, forkId: payload.forkId }) + '\n')
    const note = new Notification({ title: n.title, body: n.body })
    note.on('click', () => {
      // remember the fork as the project's open tab, then show it
      repo.setKv(`ui:${n.projectId}`, { ...repo.getKv<Record<string, unknown>>(`ui:${n.projectId}`, {}), tab: payload.forkId })
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
      send('open-fork', { projectId: n.projectId, forkId: payload.forkId })
    })
    note.show()
  }
  const svc = createService(repo, emit, () => api && {
    node: process.execPath, script: path.join(__dirname, 'mcp.js'), url: api.url, token: api.token, env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  api = await startBridgeApi(repo, (projectId) => send('data:changed', { projectId }))
  const terms = new Terminals(repo, send)
  loadShellPath()

  // One channel for the service; errors come back as values so the UI can show them.
  const methods = new Set(Object.keys(svc).filter((k) => typeof (svc as any)[k] === 'function'))
  ipcMain.handle('call', async (_e, method: string, args: unknown[]) => {
    if (!methods.has(method)) return { ok: false, error: `Unknown method ${method}` }
    try {
      const value = await (svc as any)[method](...args)
      if (method === 'setSettings') buildMenu(repo.getSettings().keys)
      if (method === 'markSeen') badge()
      return { ok: true, value }
    } catch (e) {
      return { ok: false, error: (e as Error).message, user: e instanceof UserError }
    }
  })

  ipcMain.handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Open project', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('cliInfo', () => ({ claude: findClaude() }))
  ipcMain.handle('menu:suspend', (_e, on: boolean) => buildMenu(on ? Object.fromEntries(COMMANDS.map((c) => [c.id, ''])) : repo.getSettings().keys))

  // terminals
  ipcMain.handle('term:list', (_e, forkId: string) => repo.listTerminals(forkId))
  ipcMain.handle('term:create', (_e, forkId: string) => terms.create(forkId))
  ipcMain.handle('term:attach', (_e, id: string, cols: number, rows: number) => {
    const t = repo.raw.prepare('SELECT fork_id FROM terminals WHERE id = ?').get(id) as { fork_id: string } | undefined
    const f = t && repo.getFork(t.fork_id)
    if (!f) return ''
    return terms.attach(id, f.path, repo.getSettings().shell, cols, rows)
  })
  ipcMain.handle('term:rename', (_e, id: string, name: string) => repo.renameTerminal(id, name))
  ipcMain.handle('term:close', (_e, id: string) => terms.close(id))
  ipcMain.on('term:write', (_e, id: string, data: string) => terms.write(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => terms.resize(id, cols, rows))

  // sign in to an account: run `claude` in a terminal with that account's config folder
  ipcMain.handle('account:login', async (_e, accountId: string, cols: number, rows: number) => {
    const acc = (await listAccounts(repo)).find((a) => a.id === accountId)
    const bin = findClaude()
    if (!acc || !bin) return { error: bin ? 'Account not found' : 'Claude Code CLI not found' }
    const id = `login:${accountId}:${Date.now()}`
    const buffer = terms.attach(id, app.getPath('home'), 'zsh', cols, rows, {
      file: /\.c?js$/.test(bin) ? process.execPath : bin,
      args: /\.c?js$/.test(bin) ? [bin] : [],
      env: { CLAUDE_CONFIG_DIR: acc.configDir ?? undefined, ELECTRON_RUN_AS_NODE: /\.c?js$/.test(bin) ? '1' : undefined },
    })
    return { id, buffer }
  })
  ipcMain.handle('account:loginClose', (_e, id: string) => terms.kill(id))

  buildMenu(repo.getSettings().keys)
  createWindow()

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  app.on('before-quit', () => {
    terms.killAll()
    svc.agents.stopAll()
    repo.close()
  })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.BRIDGE_USER_DATA) app.quit() })
