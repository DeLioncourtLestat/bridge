import type { AssistantAction, Priority } from './types'

/** Offline fallback for the assistant when no agent CLI is available. */
export function parseAssistant(text: string): AssistantAction[] {
  const t = text.trim()
  const low = t.toLowerCase()
  const priority: Priority = /\b(urgent|high|important)\b|срочн|важн|высок/.test(low)
    ? 'high'
    : /\b(low|someday)\b|низк|когда-нибудь/.test(low)
      ? 'low'
      : 'med'
  const clean = (x: string) =>
    x
      .replace(/\s*[,(]?\s*(priority\s+)?(urgent|high|low|important|срочно|важно|высокий|низкий)\s*\)?\s*$/i, '')
      .replace(/^[\s:—-]+|[\s.]+$/g, '')
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  let m: RegExpMatchArray | null
  if (
    (m = t.match(/^(?:please\s+)?(?:create|add|new|make)\s+(?:a\s+)?task\s*[:—-]?\s*(.+)$/is)) ||
    (m = t.match(/^(?:task|задача)\s*[:—-]\s*(.+)$/is)) ||
    (m = t.match(/^(?:созда\S*|добав\S*)\s+(?:задач\S*)\s*[:—-]?\s*(.+)$/is))
  ) {
    const [title, ...rest] = clean(m[1]).split(/\s*[.;]\s+|\s+—\s+/)
    return [{ type: 'create_task', title: cap(title), description: rest.join('. '), priority }]
  }
  if (
    (m = t.match(/^(?:please\s+)?(?:write|add|create|save|new)\s+(?:a\s+)?note\s*[:—-]?\s*(.+)$/is)) ||
    (m = t.match(/^(?:note|заметка)\s*[:—-]\s*(.+)$/is)) ||
    (m = t.match(/^(?:запиш\S*|созда\S*|добав\S*|сохран\S*)\s+(?:в\s+)?(?:заметк\S*|note)\s*[:—-]?\s*(.+)$/is))
  ) {
    const body = m[1].trim()
    const [first, ...more] = body.split(/\s*[:\n]\s*|(?<=\.)\s+|\s+[—–-]\s+/)
    const title = first.replace(/\.$/, '').slice(0, 60)
    return [{ type: 'create_note', title: cap(title), body: more.join('\n').trim() || body }]
  }
  if (/\b(open|todo|what'?s left|tasks)\b|какие задачи|что осталось|открыт/.test(low)) return [{ type: 'list_tasks' }]
  return []
}
