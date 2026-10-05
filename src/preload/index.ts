import { contextBridge, ipcRenderer } from 'electron'

/** Calls into the main-process service; rejects with the service's own message. */
async function call(method: string, ...args: unknown[]) {
  const r = await ipcRenderer.invoke('call', method, args)
  if (!r.ok) {
    const err = new Error(r.error)
    ;(err as Error & { user?: boolean }).user = r.user
    throw err
  }
  return r.value
}

const on = (channel: string, fn: (payload: any) => void) => {
  const h = (_e: unknown, p: unknown) => fn(p)
  ipcRenderer.on(channel, h)
  return () => { ipcRenderer.removeListener(channel, h) }
}

const api = {
  call,
  on,
  platform: process.platform,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pickFolder'),
  reveal: (p: string) => ipcRenderer.invoke('reveal', p),
  cliInfo: (): Promise<{ claude: string | null }> => ipcRenderer.invoke('cliInfo'),
  term: {
    list: (forkId: string) => ipcRenderer.invoke('term:list', forkId),
    create: (forkId: string): Promise<string> => ipcRenderer.invoke('term:create', forkId),
    attach: (id: string, cols: number, rows: number): Promise<string> => ipcRenderer.invoke('term:attach', id, cols, rows),
    rename: (id: string, name: string) => ipcRenderer.invoke('term:rename', id, name),
    close: (id: string) => ipcRenderer.invoke('term:close', id),
    write: (id: string, data: string) => ipcRenderer.send('term:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('term:resize', id, cols, rows),
  },
  login: (accountId: string, cols: number, rows: number): Promise<{ id?: string; buffer?: string; error?: string }> =>
    ipcRenderer.invoke('account:login', accountId, cols, rows),
  loginClose: (id: string) => ipcRenderer.invoke('account:loginClose', id),
}

contextBridge.exposeInMainWorld('bridge', api)
export type BridgeApi = typeof api
