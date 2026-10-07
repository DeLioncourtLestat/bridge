export type TaskStatus = 'open' | 'progress' | 'done'
export type Priority = 'high' | 'med' | 'low'
export type ForkState = 'idle' | 'run' | 'wait'

export type Project = {
  id: string
  name: string
  path: string
  short: string
  color: string
  /** null → initials on the color; 'preset:<name>' → built-in glyph; 'data:image/…' → custom image */
  icon: string | null
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

/** A fork = git worktree folder + its branch + an agent session.
 *  A ghost has no worktree: it runs in the project folder on whatever branch is checked out there, alongside other ghosts. */
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
  ghost: boolean
  /** Project instructions switched off for this fork. */
  instrOff: number[]
  createdAt: number
}

/** Standing instructions the agent always follows: project-wide (forkId null) or for one fork. */
export type Instruction = {
  id: number
  projectId: string
  forkId: string | null
  title: string
  body: string
  createdAt: number
}

export type Ref = { kind: 'task' | 'note'; id: number; title?: string }

export type ChatMessage = {
  id: number
  forkId: string
  role: 'user' | 'agent' | 'error'
  text: string
  tools: string[]
  /** Text length at the moment each tool was called, so tools show between the right paragraphs. */
  marks: number[]
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

export type Theme = 'dark' | 'light' | 'system'

export type Settings = {
  theme: Theme
  /** Code colors: VS Code (Dark+/Light+) or JetBrains (Darcula/IntelliJ Light). */
  syntax: 'vscode' | 'jetbrains'
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
  /** System notification when an agent finishes while Bridge isn't focused. */
  notify: boolean
  /** Shortcut overrides by command id; '' turns one off. Missing ids use the defaults. */
  keys: Record<string, string>
}

export type FileChange = { path: string; kind: 'A' | 'M' | 'D'; add: number; del: number }

export type Commit = { hash: string; short: string; author: string; when: string; subject: string; pushed: boolean }

export type DiffOp = { t: ' ' | '+' | '-'; s: string; a?: number; b?: number }

export type AgentEvent =
  | { forkId: string; kind: 'start'; messageId: number }
  | { forkId: string; kind: 'update'; message: ChatMessage }
  | { forkId: string; kind: 'done'; state: ForkState; error?: string }
