export type TaskStatus = 'open' | 'progress' | 'done'
export type Priority = 'high' | 'med' | 'low'
export type ForkState = 'idle' | 'run' | 'wait'

export type Project = {
  id: string
  name: string
  path: string
  short: string
  color: string
  account: string | null // null → default account
  sort: number
}

export type Task = {
  id: number
  projectId: string
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  createdAt: number
}

export type Note = {
  id: number
  projectId: string
  title: string
  body: string
  createdAt: number
}

/** A fork = git worktree folder + its branch + an agent session. */
export type Fork = {
  id: string
  projectId: string
  title: string
  branch: string
  path: string
  open: boolean
  sessionId: string
  sessionStarted: boolean
  state: ForkState
  autoNamed: boolean
  autoBranch: boolean
  createdAt: number
}

export type Ref = { kind: 'task' | 'note'; id: number; title?: string }

export type ChatMessage = {
  id: number
  forkId: string
  role: 'user' | 'agent' | 'error'
  text: string
  tools: string[]
  refs: Ref[]
  createdAt: number
}

export type TerminalInfo = { id: string; forkId: string; name: string; sort: number }

export type Account = {
  id: string
  label: string
  configDir: string | null // null → the CLI's own default (~/.claude)
  detected: boolean // found on disk rather than added in Bridge
  connected: boolean
  email: string | null
}

export type Settings = {
  accent: string
  radius: number
  compact: boolean
  uiFont: string
  uiSize: number
  codeFont: string
  codeSize: number
  lineNumbers: boolean
  highlightChanges: boolean
  tabSize: number
  shell: string
  defaultAccount: string | null
  permissionMode: 'acceptEdits' | 'auto' | 'bypassPermissions'
}

export type FileChange = { path: string; kind: 'A' | 'M' | 'D'; add: number; del: number }

export type Commit = { hash: string; short: string; author: string; when: string; subject: string; pushed: boolean }

export type DiffOp = { t: ' ' | '+' | '-'; s: string; a?: number; b?: number }

export type AssistantAction =
  | { type: 'create_task'; title: string; description?: string; priority?: Priority }
  | { type: 'create_note'; title: string; body?: string }
  | { type: 'list_tasks' }

export type AssistantMessage = {
  id: number
  projectId: string
  role: 'user' | 'assistant'
  text: string
  tools: string[]
  open: Ref | null
  createdAt: number
}

export type AgentEvent =
  | { forkId: string; kind: 'start'; messageId: number }
  | { forkId: string; kind: 'update'; message: ChatMessage }
  | { forkId: string; kind: 'done'; state: ForkState; error?: string }
