import { parseAssistant } from '../shared/assistantParse'
import type { Account, AssistantAction, Task } from '../shared/types'
import { findClaude, spawnCli } from './agent'

export const ASSISTANT_PROMPT = `You are the project assistant inside Bridge, a project manager for coding work.
You do not edit code. You only manage the project's tasks and notes.
Reply with ONLY a JSON object, no prose around it:
{"reply": "<one or two short sentences for the user>",
 "actions": [ {"type":"create_task","title":"...","description":"...","priority":"high|med|low"}
            | {"type":"create_note","title":"...","body":"<markdown>"}
            | {"type":"list_tasks"} ]}
Use "actions": [] when nothing needs to change. Write titles in the user's language. Keep titles short.`

/** Pull the first JSON object out of a model reply (tolerates ```json fences). */
export function extractJson(text: string): any | null {
  const t = text.replace(/```(?:json)?/g, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch {
    return null
  }
}

function sanitize(actions: any[]): AssistantAction[] {
  const out: AssistantAction[] = []
  for (const a of Array.isArray(actions) ? actions : []) {
    if (a?.type === 'create_task' && a.title)
      out.push({ type: 'create_task', title: String(a.title).slice(0, 200), description: String(a.description ?? ''), priority: ['high', 'med', 'low'].includes(a.priority) ? a.priority : 'med' })
    else if (a?.type === 'create_note' && a.title) out.push({ type: 'create_note', title: String(a.title).slice(0, 200), body: String(a.body ?? '') })
    else if (a?.type === 'list_tasks') out.push({ type: 'list_tasks' })
  }
  return out
}

/**
 * Ask the agent (no tools, short model) what to do. Falls back to the built-in
 * phrase parser when the CLI is missing or fails.
 */
export async function askAssistant(
  text: string,
  cwd: string,
  account: Account | null,
  openTasks: Task[],
): Promise<{ reply: string | null; actions: AssistantAction[]; offline: boolean }> {
  const bin = findClaude()
  if (bin) {
    const context = openTasks.length ? `\n\nOpen tasks right now:\n${openTasks.map((t) => `- ${t.title} (${t.priority})`).join('\n')}` : ''
    const args = ['-p', text, '--output-format', 'json', '--system-prompt', ASSISTANT_PROMPT + context, '--model', 'haiku', '--tools', '', '--no-session-persistence']
    const out = await new Promise<string | null>((resolve) => {
      const child = spawnCli(bin, args, cwd, account)
      let stdout = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), 90_000)
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      child.on('error', () => { clearTimeout(timer); resolve(null) })
      child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? stdout : null) })
    })
    if (out) {
      const envelope = extractJson(out)
      const inner = envelope && typeof envelope.result === 'string' ? extractJson(envelope.result) : envelope?.structured_output ?? null
      if (inner) return { reply: typeof inner.reply === 'string' ? inner.reply : null, actions: sanitize(inner.actions), offline: false }
    }
  }
  return { reply: null, actions: parseAssistant(text), offline: true }
}
