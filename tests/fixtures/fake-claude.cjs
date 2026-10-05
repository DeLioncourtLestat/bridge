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

  if (args.includes('--system-prompt')) {
    // assistant: reply with the JSON envelope of --output-format json
    log({ mode: 'assistant', prompt, config: process.env.CLAUDE_CONFIG_DIR || null, model: opt('--model'), tools: opt('--tools') })
    const low = prompt.toLowerCase()
    let actions = []
    let reply = 'Nothing to do.'
    let m
    if ((m = prompt.match(/task[:\s]+(.+)/i))) {
      const title = m[1].replace(/,?\s*(urgent|high)\s*$/i, '').trim()
      actions = [{ type: 'create_task', title: title[0].toUpperCase() + title.slice(1), description: 'from assistant', priority: /urgent|high/.test(low) ? 'high' : 'med' }]
      reply = 'Added it.'
    } else if ((m = prompt.match(/note[:\s]+(.+?)\s+[—-]\s+(.+)/i))) {
      actions = [{ type: 'create_note', title: m[1].trim(), body: `- ${m[2].trim()}` }]
      reply = 'Saved.'
    } else if (/open/.test(low)) actions = [{ type: 'list_tasks' }]
    out({ type: 'result', subtype: 'success', is_error: false, result: '```json\n' + JSON.stringify({ reply, actions }) + '\n```' })
    return
  }

  // agent turn
  const session = opt('--session-id') || opt('--resume')
  log({ mode: 'agent', cwd: process.cwd(), prompt, config: process.env.CLAUDE_CONFIG_DIR || null, session, resume: args.includes('--resume'), permission: opt('--permission-mode') })
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd() })
  if (prompt.includes('SLOW')) await sleep(4000)
  if (prompt.includes('FAIL')) {
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Simulated failure' })
    process.exit(1)
  }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(process.cwd(), 'README.md') } }] } })
  fs.writeFileSync(path.join(process.cwd(), 'AGENT_WORK.md'), `# Agent work\n\n${prompt}\n`)
  fs.appendFileSync(path.join(process.cwd(), 'README.md'), `\nEdited by the agent.\n`)
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(process.cwd(), 'AGENT_WORK.md') } }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(process.cwd(), 'README.md') } }] } })
  await sleep(150)
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done. I wrote AGENT_WORK.md and updated README.md.' }] } })
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done. I wrote AGENT_WORK.md and updated README.md.' })
})()
