/**
 * Bridge's MCP server for the agent: tasks and notes of the project the fork belongs to.
 * Claude Code starts it over stdio (see `--mcp-config` in agent.ts); every tool call is forwarded to the
 * running Bridge app on 127.0.0.1, which writes the database and refreshes the UI.
 * No dependencies: newline-delimited JSON-RPC 2.0, as the MCP stdio transport specifies.
 */
import { createInterface } from 'node:readline'
import { BRIDGE_TOOLS } from './bridgeTools'

const API = process.env.BRIDGE_API ?? ''
const TOKEN = process.env.BRIDGE_TOKEN ?? ''
const PROJECT = process.env.BRIDGE_PROJECT ?? ''
const FORK = process.env.BRIDGE_FORK ?? ''

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')

async function call(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
  try {
    const r = await fetch(`${API}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ projectId: PROJECT, forkId: FORK || null, name, args }),
    })
    const body = (await r.json()) as { ok: boolean; text?: string; error?: string }
    return body.ok ? { text: body.text ?? 'Done.', isError: false } : { text: body.error ?? 'Failed', isError: true }
  } catch {
    return { text: 'Bridge is not running, so tasks and notes cannot be changed right now.', isError: true }
  }
}

async function handle(msg: { id?: number | string; method?: string; params?: any }) {
  const { id, method, params } = msg
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'bridge', version: '1.0.0' } } })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: BRIDGE_TOOLS } })
  if (method === 'tools/call') {
    const r = await call(String(params?.name ?? ''), params?.arguments ?? {})
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }], isError: r.isError } })
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
  void handle(msg)
})
