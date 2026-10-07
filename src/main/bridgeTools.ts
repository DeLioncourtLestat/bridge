import { createHash } from 'node:crypto'
import type { Fork, Priority, TaskStatus } from '../shared/types'
import type { Repo } from './db'

/** Tools the agent gets for the project's tasks and notes (served by mcp.ts as `mcp__bridge__*`). */
export const BRIDGE_TOOLS = [
  {
    name: 'list_tasks',
    description: 'List the tasks of this project in Bridge, with id, status, priority and title. Use before changing a task to find its id.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'progress', 'done', 'all'], description: 'Filter; default: everything not done' } } },
  },
  {
    name: 'create_task',
    description: 'Create a task in this project’s Bridge task list. Use when the user asks to add, create or remember a task, todo or bug. Write titles in the user’s language.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title' },
        description: { type: 'string', description: 'Details, markdown allowed' },
        priority: { type: 'string', enum: ['high', 'med', 'low'], description: 'Default med; high for urgent' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Change a task: title, description, status (open, progress, done) or priority. Mark a task done when the user says it is finished.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['open', 'progress', 'done'] },
        priority: { type: 'string', enum: ['high', 'med', 'low'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_instructions',
    description: 'Show the standing instructions from Bridge that apply to you right now (project ones enabled for this fork, plus fork-only ones). Use when the user asks about instructions, rules or guidelines set in Bridge.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_notes',
    description: 'List the notes of this project in Bridge (id, title, first line). Pass id to read one note in full.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Read this note in full' } } },
  },
  {
    name: 'create_note',
    description: 'Save a note in this project’s Bridge notes: decisions, findings, how-tos, links. Use when the user asks to write down, note or save something.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string', description: 'Markdown; checklists as "- [ ] item"' } },
      required: ['title'],
    },
  },
  {
    name: 'update_note',
    description: 'Change a note’s title or body, or append text to its end (append keeps what is there).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, title: { type: 'string' }, body: { type: 'string', description: 'Replaces the body' }, append: { type: 'string', description: 'Added after the body' } },
      required: ['id'],
    },
  },
] as const

export class ToolError extends Error {}

/** What a fork's agent must follow: the project's instructions not switched off there, then the fork's own. '' when none. */
export function forkInstructions(repo: Repo, f: Fork) {
  const list = [
    ...repo.listInstructions(f.projectId, null).filter((i) => !f.instrOff.includes(i.id)),
    ...repo.listInstructions(f.projectId, f.id),
  ].filter((i) => i.title.trim() || i.body.trim())
  if (!list.length) return ''
  return (
    "The user's standing instructions for this project (set in Bridge). Follow them in everything you do here, unless the user says otherwise in the chat.\n\n" +
    list.map((i) => `## ${i.title.trim() || 'Instruction'}\n\n${i.body.trim()}`).join('\n\n')
  )
}

/** Short signature of an instructions text, to tell whether a session already has it. */
export const instructionsSig = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16)

/**
 * A resumed Claude session keeps the system prompt it started with (a new --append-system-prompt is ignored),
 * so changed instructions travel in the message itself.
 */
export function instructionsUpdate(text: string) {
  return text
    ? `<bridge-instructions>\nThe standing instructions changed. These replace any earlier ones from Bridge:\n\n${text}\n</bridge-instructions>`
    : '<bridge-instructions>\nThe user removed all standing instructions in Bridge; earlier ones no longer apply.\n</bridge-instructions>'
}

const STATUSES: TaskStatus[] = ['open', 'progress', 'done']
const PRIORITIES: Priority[] = ['high', 'med', 'low']
const str = (v: unknown, max = 10_000) => (typeof v === 'string' ? v.slice(0, max) : undefined)

/** Run one tool for a project; returns the text the agent sees. Throws ToolError for bad input. */
export function runBridgeTool(repo: Repo, projectId: string, name: string, a: Record<string, unknown>, forkId?: string | null): string {
  if (!repo.getProject(projectId)) throw new ToolError('Unknown project')
  const task = (id: unknown) => {
    const t = repo.getTask(Number(id))
    if (!t || t.projectId !== projectId) throw new ToolError(`No task ${id} in this project. Call list_tasks for ids.`)
    return t
  }
  const note = (id: unknown) => {
    const n = repo.getNote(Number(id))
    if (!n || n.projectId !== projectId) throw new ToolError(`No note ${id} in this project. Call list_notes for ids.`)
    return n
  }
  switch (name) {
    case 'list_tasks': {
      const s = str(a.status)
      const list = repo.listTasks(projectId).filter((t) => (s === 'all' ? true : s ? t.status === s : t.status !== 'done'))
      return list.length ? list.map((t) => `#${t.id} [${t.status}] (${t.priority}) ${t.title}${t.description ? ` — ${t.description.split('\n')[0].slice(0, 120)}` : ''}`).join('\n') : 'No tasks.'
    }
    case 'create_task': {
      const title = str(a.title, 200)?.trim()
      if (!title) throw new ToolError('title is required')
      const priority = PRIORITIES.includes(a.priority as Priority) ? (a.priority as Priority) : 'med'
      const t = repo.createTask(projectId, { title, description: str(a.description) ?? '', priority })
      return `Created task #${t.id} “${t.title}” (${t.priority}).`
    }
    case 'update_task': {
      const t = task(a.id)
      const patch: Record<string, string> = {}
      if (str(a.title, 200)?.trim()) patch.title = str(a.title, 200)!.trim()
      if (str(a.description) !== undefined) patch.description = str(a.description)!
      if (STATUSES.includes(a.status as TaskStatus)) patch.status = a.status as string
      if (PRIORITIES.includes(a.priority as Priority)) patch.priority = a.priority as string
      if (!Object.keys(patch).length) throw new ToolError('Nothing to change')
      repo.updateTask(t.id, patch)
      const u = repo.getTask(t.id)!
      return `Updated task #${u.id} “${u.title}”: ${Object.keys(patch).join(', ')} (${u.status}, ${u.priority}).`
    }
    case 'list_instructions': {
      const f = forkId ? repo.getFork(forkId) : undefined
      if (f && f.projectId === projectId) return forkInstructions(repo, f) || 'No standing instructions are set for this fork.'
      const list = repo.listInstructions(projectId, null)
      return list.length ? list.map((i) => `## ${i.title || 'Instruction'}\n\n${i.body}`).join('\n\n') : 'No standing instructions in this project.'
    }
    case 'list_notes': {
      if (a.id !== undefined) { const n = note(a.id); return `# ${n.title}\n\n${n.body}` }
      const list = repo.listNotes(projectId)
      return list.length ? list.map((n) => `#${n.id} ${n.title}${n.body ? ` — ${n.body.split('\n').find((l) => l.trim())?.slice(0, 120) ?? ''}` : ''}`).join('\n') : 'No notes.'
    }
    case 'create_note': {
      const title = str(a.title, 200)?.trim()
      if (!title) throw new ToolError('title is required')
      const n = repo.createNote(projectId, { title, body: str(a.body, 100_000) ?? '' })
      return `Saved note #${n.id} “${n.title}”.`
    }
    case 'update_note': {
      const n = note(a.id)
      const patch: Record<string, string> = {}
      if (str(a.title, 200)?.trim()) patch.title = str(a.title, 200)!.trim()
      if (str(a.body, 100_000) !== undefined) patch.body = str(a.body, 100_000)!
      if (str(a.append, 100_000)) patch.body = `${(patch.body ?? n.body).replace(/\s+$/, '')}\n\n${str(a.append, 100_000)}`.replace(/^\n+/, '')
      if (!Object.keys(patch).length) throw new ToolError('Nothing to change')
      repo.updateNote(n.id, patch)
      return `Updated note #${n.id} “${patch.title ?? n.title}”.`
    }
    default:
      throw new ToolError(`Unknown tool ${name}`)
  }
}

/** How a Bridge tool call reads in the chat. */
export function bridgeToolSummary(name: string, input: any): string {
  const q = (s: unknown) => `“${String(s ?? '').slice(0, 60)}”`
  switch (name) {
    case 'create_task': return `Created task ${q(input?.title)}`
    case 'update_task': return input?.status === 'done' ? `Completed task #${input?.id}` : `Updated task #${input?.id}`
    case 'list_tasks': return 'Listed tasks'
    case 'create_note': return `Saved note ${q(input?.title)}`
    case 'update_note': return `Updated note #${input?.id}`
    case 'list_notes': return input?.id !== undefined ? `Read note #${input.id}` : 'Listed notes'
    case 'list_instructions': return 'Read instructions'
    default: return name
  }
}
