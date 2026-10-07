import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runBridgeTool, ToolError } from './bridgeTools'
import type { Repo } from './db'

export type BridgeApi = { url: string; token: string; close: () => Promise<void> }

/**
 * Local endpoint for the agent's MCP server: POST /tool {projectId, name, args} with the bearer token.
 * Listens on 127.0.0.1 only, on a random port, with a random token per app run.
 */
export function startBridgeApi(repo: Repo, onChanged: (projectId: string) => void): Promise<BridgeApi> {
  const token = randomBytes(24).toString('hex')
  const server: Server = createServer((req, res) => {
    const reply = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method !== 'POST' || req.url !== '/tool') return reply(404, { ok: false, error: 'Not found' })
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { ok: false, error: 'Unauthorized' })
    let raw = ''
    req.on('data', (d: Buffer) => { raw += d.toString(); if (raw.length > 1_000_000) req.destroy() })
    req.on('end', () => {
      try {
        const { projectId, name, args } = JSON.parse(raw)
        const text = runBridgeTool(repo, String(projectId), String(name), args && typeof args === 'object' ? args : {})
        if (!/^list_/.test(name)) onChanged(String(projectId))
        reply(200, { ok: true, text })
      } catch (e) {
        reply(200, { ok: false, error: e instanceof ToolError ? e.message : `Bridge error: ${(e as Error).message}` })
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${port}`, token, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}
