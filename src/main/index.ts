import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { listAccounts } from './accounts'
import { findClaude } from './agent'
import { openDb } from './db'
import { loadShellPath } from './env'
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

function buildMenu() {
  const cmd = (name: string) => () => send('menu', name)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ label: 'Bridge', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as Electron.MenuItemConstructorOptions]
      : []),
    { label: 'File', submenu: [{ label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: cmd('open-project') }, { label: 'New Fork…', accelerator: 'CmdOrCtrl+N', click: cmd('new-fork') }, { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ label: 'Tasks', accelerator: 'CmdOrCtrl+1', click: cmd('tasks') }, { label: 'Notes', accelerator: 'CmdOrCtrl+2', click: cmd('notes') }, { label: 'Assistant', accelerator: 'CmdOrCtrl+J', click: cmd('assistant') }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const repo = openDb(path.join(app.getPath('userData'), 'bridge.db'))
  const svc = createService(repo, send)
  const terms = new Terminals(repo, send)
  loadShellPath()

  // One channel for the service; errors come back as values so the UI can show them.
  const methods = new Set(Object.keys(svc).filter((k) => typeof (svc as any)[k] === 'function'))
  ipcMain.handle('call', async (_e, method: string, args: unknown[]) => {
    if (!methods.has(method)) return { ok: false, error: `Unknown method ${method}` }
    try {
      return { ok: true, value: await (svc as any)[method](...args) }
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

  buildMenu()
  createWindow()

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  app.on('before-quit', () => {
    terms.killAll()
    svc.agents.stopAll()
    repo.close()
  })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.BRIDGE_USER_DATA) app.quit() })
