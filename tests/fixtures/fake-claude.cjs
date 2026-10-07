#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests: same flags, same stream-json shape, no network.
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const log = (o) => process.env.BRIDGE_FAKE_LOG && fs.appendFileSync(process.env.BRIDGE_FAKE_LOG, JSON.stringify(o) + '\n')
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const prompt = opt('-p')

;(async () => {
  if (prompt === undefined) {
    // interactive mode (sign-in terminal)
    process.stdout.write('Fake Claude CLI. Type /login\r\n> ')
    process.stdin.setRawMode?.(true)
    let line = ''
    process.stdin.on('data', (d) => {
      for (const ch of d.toString()) {
        if (ch === '\r' || ch === '\n') {
          if (line.trim() === '/login') {
            const dir = process.env.CLAUDE_CONFIG_DIR
            fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'new@example.com' } }))
            process.stdout.write('\r\nLogged in as new@example.com\r\n> ')
          } else process.stdout.write('\r\n> ')
          line = ''
        } else { line += ch; process.stdout.write(ch) }
      }
    })
    return
  }

  // agent turn
  const session = opt('--session-id') || opt('--resume')
  log({ mode: 'agent', cwd: process.cwd(), prompt, config: process.env.CLAUDE_CONFIG_DIR || null, session, resume: args.includes('--resume'), permission: opt('--permission-mode'), mcp: opt('--mcp-config') || null, allowed: opt('--allowedTools') || null, hint: opt('--append-system-prompt') || null })
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd() })
  if (prompt.includes('SLOW')) await sleep(4000)
  if (prompt.includes('FAIL')) {
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Simulated failure' })
    process.exit(1)
  }
  if (prompt.includes('BRIDGE')) {
    // talk MCP to the server Bridge passed in --mcp-config, like Claude Code does
    const conf = JSON.parse(opt('--mcp-config')).mcpServers.bridge
    const { spawn } = require('child_process')
    const srv = spawn(conf.command, conf.args, { env: { ...process.env, ...conf.env }, stdio: ['pipe', 'pipe', 'inherit'] })
    let buf = ''
    const waiting = new Map()
    srv.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); waiting.delete(m.id) }
    })
    let n = 0
    const rpc = (method, params) => new Promise((r) => { const id = ++n; waiting.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } })
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
    const use = async (name, input) => {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: `mcp__bridge__${name}`, input }] } })
      return (await rpc('tools/call', { name, arguments: input })).result.content[0].text
    }
    const a = await use('create_note', { title: 'Decision', body: 'Use SQLite' })
    const b = await use('create_task', { title: 'Add import', priority: 'high' })
    const id = Number(b.match(/#(\d+)/)[1])
    const c = await use('update_task', { id, status: 'progress' })
    const d = await use('update_task', { id: 99999, status: 'done' })
    srv.kill()
    out({ type: 'assistant', message: { content: [{ type: 'text', text: [`Tools: ${tools.join(', ')}`, a, b, c, d].join('\n\n') }] } })
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })
    return
  }
  if (prompt.includes('RICH')) {
    // a markdown-heavy reply with tools in between, for chat rendering
    const say = (text) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
    say("I'll look at how the export works first.")
    for (const [name, input] of [['Read', { file_path: 'src/app.ts' }], ['Grep', { pattern: 'export' }], ['Bash', { command: 'npm test' }], ['Edit', { file_path: 'src/app.ts' }]])
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
    say('## Summary\n\nAdded **JSON export** with `exportAll()`:\n\n1. Collects tasks and notes\n   - skips *archived* items\n2. Writes a file\n\n| File | Change |\n|---|---|\n| `src/app.ts` | new `exportAll` |\n| `README.md` | docs |\n\n```ts\nexport function exportAll(db: Db): string {\n  // stable key order\n  return JSON.stringify({ tasks: db.tasks, notes: db.notes }, null, 2)\n}\n```\n\n> Import is next.\n\n- [x] Export\n- [ ] Import\n\n<script>alert(1)</script> See [docs](https://example.com).')
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })
    return
  }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(process.cwd(), 'README.md') } }] } })
  fs.writeFileSync(path.join(process.cwd(), 'AGENT_WORK.md'), `# Agent work\n\n${prompt}\n`)
  fs.appendFileSync(path.join(process.cwd(), 'README.md'), `\nEdited by the agent.\n`)
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(process.cwd(), 'AGENT_WORK.md') } }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(process.cwd(), 'README.md') } }] } })
  await sleep(150)
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done. I wrote AGENT_WORK.md and updated README.md.' }] } })
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done. I wrote AGENT_WORK.md and updated README.md.' })
})()
