import Database from 'better-sqlite3'
import type {
  AssistantMessage,
  ChatMessage,
  Fork,
  Note,
  Project,
  Ref,
  Settings,
  Task,
  TerminalInfo,
} from '../shared/types'

export const DEFAULT_SETTINGS: Settings = {
  accent: 'Blue',
  radius: 2,
  compact: false,
  uiFont: 'System',
  uiSize: 14,
  codeFont: 'System mono',
  codeSize: 12.5,
  lineNumbers: true,
  highlightChanges: true,
  tabSize: 2,
  shell: process.platform === 'win32' ? 'powershell.exe' : 'zsh',
  defaultAccount: null,
  permissionMode: 'acceptEdits',
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, short TEXT NOT NULL,
  color TEXT NOT NULL, account TEXT, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'med',
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS forks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, branch TEXT NOT NULL, path TEXT NOT NULL,
  open INTEGER NOT NULL DEFAULT 1, session_id TEXT NOT NULL, session_started INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'idle', auto_named INTEGER NOT NULL DEFAULT 0, auto_branch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fork_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]', refs TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY, fork_id TEXT NOT NULL, name TEXT NOT NULL, buffer TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]', open_ref TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, label TEXT NOT NULL, config_dir TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS forks_project ON forks(project_id);
CREATE INDEX IF NOT EXISTS messages_fork ON messages(fork_id);
`

const TERM_BUFFER_MAX = 200_000

type Row = Record<string, any>

const toProject = (r: Row): Project => ({ id: r.id, name: r.name, path: r.path, short: r.short, color: r.color, account: r.account, sort: r.sort })
const toTask = (r: Row): Task => ({
  id: r.id, projectId: r.project_id, title: r.title, description: r.description, status: r.status, priority: r.priority, createdAt: r.created_at,
})
const toNote = (r: Row): Note => ({ id: r.id, projectId: r.project_id, title: r.title, body: r.body, createdAt: r.created_at })
const toFork = (r: Row): Fork => ({
  id: r.id, projectId: r.project_id, title: r.title, branch: r.branch, path: r.path, open: !!r.open, sessionId: r.session_id,
  sessionStarted: !!r.session_started, state: r.state, autoNamed: !!r.auto_named, autoBranch: !!r.auto_branch, createdAt: r.created_at,
})
const toMessage = (r: Row): ChatMessage => ({
  id: r.id, forkId: r.fork_id, role: r.role, text: r.text, tools: JSON.parse(r.tools), refs: JSON.parse(r.refs), createdAt: r.created_at,
})
const toAssistant = (r: Row): AssistantMessage => ({
  id: r.id, projectId: r.project_id, role: r.role, text: r.text, tools: JSON.parse(r.tools),
  open: r.open_ref ? JSON.parse(r.open_ref) : null, createdAt: r.created_at,
})

/** Patch helper: only known columns, mapped from camelCase. */
function update(db: Database.Database, table: string, id: string | number, patch: Row, cols: Record<string, string>) {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(patch)) {
    const col = cols[k]
    if (!col || v === undefined) continue
    sets.push(`${col} = ?`)
    vals.push(typeof v === 'boolean' ? Number(v) : v)
  }
  if (sets.length) db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
}

export function openDb(file: string) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  const now = () => Date.now()

  const repo = {
    raw: db,
    close: () => db.close(),

    // projects
    listProjects: (): Project[] => (db.prepare('SELECT * FROM projects ORDER BY sort, rowid').all() as Row[]).map(toProject),
    getProject: (id: string): Project | undefined => {
      const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
      return r && toProject(r)
    },
    addProject: (p: Omit<Project, 'sort'>): Project => {
      const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM projects').get() as Row).s
      db.prepare('INSERT INTO projects (id, name, path, short, color, account, sort) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        p.id, p.name, p.path, p.short, p.color, p.account, sort,
      )
      return repo.getProject(p.id)!
    },
    updateProject: (id: string, patch: Partial<Project>) =>
      update(db, 'projects', id, patch, { name: 'name', short: 'short', color: 'color', account: 'account' }),
    removeProject: (id: string) => {
      const forks = db.prepare('SELECT id FROM forks WHERE project_id = ?').all(id) as Row[]
      db.transaction(() => {
        for (const f of forks) {
          db.prepare('DELETE FROM messages WHERE fork_id = ?').run(f.id)
          db.prepare('DELETE FROM terminals WHERE fork_id = ?').run(f.id)
        }
        for (const t of ['tasks', 'notes', 'forks', 'assistant_messages']) db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(id)
        db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      })()
    },

    // tasks
    listTasks: (projectId: string): Task[] =>
      (db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id DESC').all(projectId) as Row[]).map(toTask),
    getTask: (id: number): Task | undefined => {
      const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
      return r && toTask(r)
    },
    createTask: (projectId: string, t: Partial<Task> = {}): Task => {
      const info = db
        .prepare('INSERT INTO tasks (project_id, title, description, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(projectId, t.title ?? '', t.description ?? '', t.status ?? 'open', t.priority ?? 'med', now())
      return repo.getTask(Number(info.lastInsertRowid))!
    },
    updateTask: (id: number, patch: Partial<Task>) =>
      update(db, 'tasks', id, patch, { title: 'title', description: 'description', status: 'status', priority: 'priority' }),
    removeTask: (id: number) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id),

    // notes
    listNotes: (projectId: string): Note[] =>
      (db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY id DESC').all(projectId) as Row[]).map(toNote),
    getNote: (id: number): Note | undefined => {
      const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
      return r && toNote(r)
    },
    createNote: (projectId: string, n: Partial<Note> = {}): Note => {
      const info = db
        .prepare('INSERT INTO notes (project_id, title, body, created_at) VALUES (?, ?, ?, ?)')
        .run(projectId, n.title ?? '', n.body ?? '', now())
      return repo.getNote(Number(info.lastInsertRowid))!
    },
    updateNote: (id: number, patch: Partial<Note>) => update(db, 'notes', id, patch, { title: 'title', body: 'body' }),
    removeNote: (id: number) => db.prepare('DELETE FROM notes WHERE id = ?').run(id),

    // forks
    listForks: (projectId: string): Fork[] =>
      (db.prepare('SELECT * FROM forks WHERE project_id = ? ORDER BY created_at, rowid').all(projectId) as Row[]).map(toFork),
    getFork: (id: string): Fork | undefined => {
      const r = db.prepare('SELECT * FROM forks WHERE id = ?').get(id) as Row | undefined
      return r && toFork(r)
    },
    addFork: (f: Fork) => {
      db.prepare(
        `INSERT INTO forks (id, project_id, title, branch, path, open, session_id, session_started, state, auto_named, auto_branch, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(f.id, f.projectId, f.title, f.branch, f.path, Number(f.open), f.sessionId, Number(f.sessionStarted), f.state,
        Number(f.autoNamed), Number(f.autoBranch), f.createdAt)
      return repo.getFork(f.id)!
    },
    updateFork: (id: string, patch: Partial<Fork>) =>
      update(db, 'forks', id, patch, {
        title: 'title', branch: 'branch', path: 'path', open: 'open', sessionStarted: 'session_started', state: 'state',
        autoNamed: 'auto_named', autoBranch: 'auto_branch',
      }),

    // chat messages
    listMessages: (forkId: string): ChatMessage[] =>
      (db.prepare('SELECT * FROM messages WHERE fork_id = ? ORDER BY id').all(forkId) as Row[]).map(toMessage),
    addMessage: (forkId: string, role: ChatMessage['role'], text: string, refs: Ref[] = [], tools: string[] = []): ChatMessage => {
      const info = db
        .prepare('INSERT INTO messages (fork_id, role, text, tools, refs, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(forkId, role, text, JSON.stringify(tools), JSON.stringify(refs), now())
      return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid) as Row)
    },
    updateMessage: (id: number, text: string, tools: string[]) => {
      db.prepare('UPDATE messages SET text = ?, tools = ? WHERE id = ?').run(text, JSON.stringify(tools), id)
      return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row)
    },

    // terminals
    listTerminals: (forkId: string): TerminalInfo[] =>
      (db.prepare('SELECT id, fork_id, name, sort FROM terminals WHERE fork_id = ? ORDER BY sort').all(forkId) as Row[]).map(
        (r) => ({ id: r.id, forkId: r.fork_id, name: r.name, sort: r.sort }),
      ),
    addTerminal: (id: string, forkId: string, name: string) => {
      const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM terminals WHERE fork_id = ?').get(forkId) as Row).s
      db.prepare('INSERT INTO terminals (id, fork_id, name, sort) VALUES (?, ?, ?, ?)').run(id, forkId, name, sort)
    },
    renameTerminal: (id: string, name: string) => db.prepare('UPDATE terminals SET name = ? WHERE id = ?').run(name, id),
    removeTerminal: (id: string) => db.prepare('DELETE FROM terminals WHERE id = ?').run(id),
    terminalBuffer: (id: string): string => ((db.prepare('SELECT buffer FROM terminals WHERE id = ?').get(id) as Row)?.buffer ?? ''),
    setTerminalBuffer: (id: string, buffer: string) =>
      db.prepare('UPDATE terminals SET buffer = ? WHERE id = ?').run(buffer.slice(-TERM_BUFFER_MAX), id),

    // assistant
    listAssistant: (projectId: string): AssistantMessage[] =>
      (db.prepare('SELECT * FROM assistant_messages WHERE project_id = ? ORDER BY id').all(projectId) as Row[]).map(toAssistant),
    addAssistant: (projectId: string, role: AssistantMessage['role'], text: string, tools: string[] = [], open: Ref | null = null) => {
      const info = db
        .prepare('INSERT INTO assistant_messages (project_id, role, text, tools, open_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(projectId, role, text, JSON.stringify(tools), open ? JSON.stringify(open) : null, now())
      return toAssistant(db.prepare('SELECT * FROM assistant_messages WHERE id = ?').get(info.lastInsertRowid) as Row)
    },

    // accounts added in Bridge (detected ones live on disk)
    listAddedAccounts: () =>
      (db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map((r) => ({ id: r.id as string, label: r.label as string, configDir: r.config_dir as string | null })),
    addAccount: (id: string, label: string, configDir: string) =>
      db.prepare('INSERT INTO accounts (id, label, config_dir, created_at) VALUES (?, ?, ?, ?)').run(id, label, configDir, now()),
    removeAccount: (id: string) => db.prepare('DELETE FROM accounts WHERE id = ?').run(id),

    // key/value: settings and per-project UI state
    getKv: <T>(key: string, fallback: T): T => {
      const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as Row | undefined
      return r ? (JSON.parse(r.value) as T) : fallback
    },
    setKv: (key: string, value: unknown) =>
      db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)),
    getSettings: (): Settings => ({ ...DEFAULT_SETTINGS, ...repo.getKv<Partial<Settings>>('settings', {}) }),
    setSettings: (patch: Partial<Settings>): Settings => {
      const next = { ...repo.getSettings(), ...patch }
      repo.setKv('settings', next)
      return next
    },
  }
  return repo
}

export type Repo = ReturnType<typeof openDb>
