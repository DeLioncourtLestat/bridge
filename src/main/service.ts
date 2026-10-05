import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentEvent, Fork, Ref, Settings } from '../shared/types'
import { colorFor, initials, slug, validBranch } from '../shared/util'
import { addAccount, listAccounts, removeAccount, resolveAccount } from './accounts'
import { AgentRunner, buildPrompt, refTitles } from './agent'
import { askAssistant } from './assistant'
import type { Repo } from './db'
import * as g from './git'

export class UserError extends Error {}

/** Everything the window can ask for. Kept free of Electron so tests can drive it directly. */
export function createService(repo: Repo, emit: (channel: string, payload: unknown) => void) {
  const agents = new AgentRunner()
  const emitAgent = (e: AgentEvent) => emit('agent:event', e)

  const project = (id: string) => {
    const p = repo.getProject(id)
    if (!p) throw new UserError('Project not found')
    return p
  }
  const fork = (id: string) => {
    const f = repo.getFork(id)
    if (!f) throw new UserError('Fork not found')
    return f
  }

  async function accountFor(projectId: string) {
    const accounts = await listAccounts(repo)
    return resolveAccount(accounts, project(projectId).account, repo.getSettings().defaultAccount)
  }

  const svc = {
    agents,

    // ---------- projects ----------
    listProjects: () => repo.listProjects(),

    async addProject(dir: string) {
      if (!existsSync(dir)) throw new UserError(`Folder not found: ${dir}`)
      if (!(await g.isRepo(dir))) throw new UserError('NOT_GIT')
      const root = await g.repoRoot(dir)
      const known = repo.listProjects().find((p) => p.path === root)
      if (known) return known
      try {
        await g.git(root, ['rev-parse', 'HEAD'])
      } catch {
        throw new UserError('This repository has no commits yet. Make a first commit, then add it again.')
      }
      const name = path.basename(root)
      return repo.addProject({ id: randomUUID(), name, path: root, short: initials(name), color: colorFor(name), account: null })
    },

    /** Turn a plain folder into a repo with one empty commit, so forks can branch from it. */
    async initRepo(dir: string) {
      await g.git(dir, ['init', '-q'])
      await g.git(dir, ['commit', '-q', '--allow-empty', '-m', 'Initial commit'])
      return svc.addProject(dir)
    },

    updateProject: (id: string, patch: { account?: string | null; color?: string; short?: string; name?: string }) => {
      repo.updateProject(id, patch)
      return project(id)
    },

    removeProject: (id: string) => {
      for (const f of repo.listForks(id)) agents.stop(f.id)
      repo.removeProject(id)
    },

    // ---------- tasks & notes ----------
    listTasks: (pid: string) => repo.listTasks(pid),
    createTask: (pid: string, data: Parameters<Repo['createTask']>[1]) => repo.createTask(pid, data),
    updateTask: (id: number, patch: Parameters<Repo['updateTask']>[1]) => { repo.updateTask(id, patch); return repo.getTask(id) },
    removeTask: (id: number) => repo.removeTask(id),
    listNotes: (pid: string) => repo.listNotes(pid),
    createNote: (pid: string, data: Parameters<Repo['createNote']>[1]) => repo.createNote(pid, data),
    updateNote: (id: number, patch: Parameters<Repo['updateNote']>[1]) => { repo.updateNote(id, patch); return repo.getNote(id) },
    removeNote: (id: number) => repo.removeNote(id),

    // ---------- forks ----------
    listForks: (pid: string) => repo.listForks(pid),

    /** Every local branch and why it can't be used (already checked out somewhere). */
    async branches(pid: string) {
      const p = project(pid)
      const [names, trees] = await Promise.all([g.listBranches(p.path), g.listWorktrees(p.path)])
      const forks = repo.listForks(pid)
      return names.map((name) => {
        const wt = trees.find((t) => t.branch === name)
        let usedBy: string | null = null
        if (wt) {
          const f = forks.find((x) => path.resolve(x.path) === path.resolve(wt.path))
          usedBy = path.resolve(wt.path) === path.resolve(p.path) ? 'checked out in the project folder' : f ? `used by “${f.title}”` : `checked out in ${wt.path}`
        }
        return { name, usedBy }
      })
    },

    async createFork(pid: string, opts: { title?: string; branch: string; newBranch: boolean }) {
      const p = project(pid)
      const branch = opts.branch.trim()
      if (!branch) throw new UserError('Pick a branch.')
      const existing = await g.listBranches(p.path)
      if (opts.newBranch) {
        if (!validBranch(branch)) throw new UserError('Branch names can use letters, digits, “-”, “_”, “.” and “/”.')
        if (existing.includes(branch)) throw new UserError(`Branch ${branch} already exists. Pick it under Existing branch.`)
      } else if (!existing.includes(branch)) throw new UserError(`Branch ${branch} doesn’t exist.`)
      let dir = g.worktreeDir(p.path, branch)
      for (let i = 2; existsSync(dir); i++) dir = g.worktreeDir(p.path, branch) + `-${i}`
      try {
        await g.addWorktree(p.path, dir, branch, opts.newBranch)
      } catch (e) {
        throw new UserError((e as Error).message.replace(/^fatal:\s*/, ''))
      }
      const n = repo.listForks(pid).length + 1
      const title = opts.title?.trim()
      const f: Fork = {
        id: randomUUID(), projectId: pid, title: title || `Fork ${n}`, branch, path: dir, open: true, sessionId: randomUUID(),
        sessionStarted: false, state: 'idle', autoNamed: !title, autoBranch: opts.newBranch && !!opts.branch.match(/^agent\/fork-\d+$/),
        createdAt: Date.now(),
      }
      return repo.addFork(f)
    },

    setForkOpen: (id: string, open: boolean) => { repo.updateFork(id, { open }); return fork(id) },

    // ---------- chat with the agent ----------
    messages: (forkId: string) => repo.listMessages(forkId),

    async send(forkId: string, text: string, refs: Ref[]) {
      let f = fork(forkId)
      if (agents.isRunning(forkId)) throw new UserError('The agent is still working on the previous message.')
      const tasks = refs.filter((r) => r.kind === 'task').map((r) => repo.getTask(r.id)).filter((t): t is NonNullable<typeof t> => !!t)
      const notes = refs.filter((r) => r.kind === 'note').map((r) => repo.getNote(r.id)).filter((n): n is NonNullable<typeof n> => !!n)

      // A fork created without a name takes it (and, if auto, its branch) from its first task.
      if (f.autoNamed && tasks[0] && !repo.listMessages(forkId).length) {
        const patch: Partial<Fork> = { title: tasks[0].title.slice(0, 40), autoNamed: false }
        const next = `agent/${slug(tasks[0].title)}`
        const p = project(f.projectId)
        if (f.autoBranch && slug(tasks[0].title) && !(await g.listBranches(p.path)).includes(next)) {
          const dir = g.worktreeDir(p.path, next)
          if (!existsSync(dir)) {
            await g.renameBranch(f.path, f.branch, next)
            await g.moveWorktree(p.path, f.path, dir)
            Object.assign(patch, { branch: next, path: dir, autoBranch: false })
          }
        }
        repo.updateFork(forkId, patch)
        f = fork(forkId)
      }
      for (const t of tasks) if (t.status === 'open') repo.updateTask(t.id, { status: 'progress' })

      const userMsg = repo.addMessage(forkId, 'user', text, refTitles(refs, tasks, notes))
      const agentMsg = repo.addMessage(forkId, 'agent', '')
      repo.updateFork(forkId, { state: 'run' })
      emitAgent({ forkId, kind: 'start', messageId: agentMsg.id })
      const settings = repo.getSettings()
      const account = await accountFor(f.projectId)

      agents
        .run({
          fork: f,
          account,
          prompt: buildPrompt(text, tasks, notes),
          permissionMode: settings.permissionMode,
          onSession: () => repo.updateFork(forkId, { sessionStarted: true }),
          onUpdate: (t, tools) => emitAgent({ forkId, kind: 'update', message: repo.updateMessage(agentMsg.id, t, tools) }),
        })
        .then((res) => {
          if (!res.ok) repo.addMessage(forkId, 'error', res.error || 'The agent failed')
          const cur = repo.listMessages(forkId).find((m) => m.id === agentMsg.id)
          if (cur && !cur.text && !cur.tools.length) repo.raw.prepare('DELETE FROM messages WHERE id = ?').run(agentMsg.id)
          const state = res.ok ? 'wait' : 'idle'
          repo.updateFork(forkId, { state })
          emitAgent({ forkId, kind: 'done', state, error: res.error })
        })
      return { user: userMsg, fork: fork(forkId) }
    },

    stop: (forkId: string) => agents.stop(forkId),
    markSeen: (forkId: string) => {
      const f = fork(forkId)
      if (f.state === 'wait') repo.updateFork(forkId, { state: 'idle' })
    },

    // ---------- git inside a fork ----------
    status: (forkId: string) => g.status(fork(forkId).path),
    files: (forkId: string) => g.listFiles(fork(forkId).path),
    async readFile(forkId: string, file: string) {
      const dir = fork(forkId).path
      return { content: await g.readFile(dir, file), head: await g.fileAtHead(dir, file) }
    },
    writeFile: (forkId: string, file: string, content: string) => g.writeFile(fork(forkId).path, file, content),
    fileDiff: (forkId: string, file: string) => g.fileDiff(fork(forkId).path, file),
    commit: (forkId: string, files: string[], message: string) => g.commit(fork(forkId).path, files, message),
    log: (forkId: string) => g.log(fork(forkId).path),
    commitDetail: (forkId: string, hash: string) => g.commitDetail(fork(forkId).path, hash),
    push: (forkId: string) => g.push(fork(forkId).path),
    pull: (forkId: string) => g.pull(fork(forkId).path),
    ahead: (forkId: string) => g.aheadCount(fork(forkId).path),

    // ---------- assistant ----------
    assistantHistory: (pid: string) => repo.listAssistant(pid),

    async assistantSend(pid: string, text: string) {
      const p = project(pid)
      repo.addAssistant(pid, 'user', text)
      const open = repo.listTasks(pid).filter((t) => t.status !== 'done')
      const res = await askAssistant(text, p.path, await accountFor(pid), open)
      const tools: string[] = []
      const lines: string[] = []
      let openRef: Ref | null = null
      for (const a of res.actions) {
        if (a.type === 'create_task') {
          const t = repo.createTask(pid, { title: a.title, description: a.description ?? '', priority: a.priority ?? 'med' })
          tools.push(`create_task(title: "${t.title}", priority: ${t.priority})`)
          lines.push(`Created task **${t.title}** · ${({ high: 'high', med: 'medium', low: 'low' } as const)[t.priority]} priority.`)
          openRef ??= { kind: 'task', id: t.id, title: t.title }
        } else if (a.type === 'create_note') {
          const n = repo.createNote(pid, { title: a.title, body: a.body ?? '' })
          tools.push(`create_note(title: "${n.title}")`)
          lines.push(`Saved note **${n.title}**.`)
          openRef ??= { kind: 'note', id: n.id, title: n.title }
        } else {
          const list = repo.listTasks(pid).filter((t) => t.status !== 'done')
          tools.push('list_tasks(status: open)')
          lines.push(list.length ? `${list.length} open: ${list.map((t) => `**${t.title}**`).join(', ')}.` : 'No open tasks.')
        }
      }
      let reply = lines.join('\n')
      if (!res.offline && res.reply && !res.actions.some((a) => a.type === 'list_tasks')) reply = lines.length ? reply : res.reply
      if (!reply)
        reply = res.offline
          ? 'I can add tasks and notes here. Try “Create task fix week start, urgent” or “Note: Supabase — keep tokens server-side”.'
          : res.reply || 'Done.'
      return repo.addAssistant(pid, 'assistant', reply, tools, openRef)
    },

    // ---------- accounts & settings ----------
    listAccounts: () => listAccounts(repo),
    addAccount: (label: string) => addAccount(repo, label),
    removeAccount: (id: string) => removeAccount(repo, id),
    projectAccount: (pid: string) => accountFor(pid),
    getSettings: () => repo.getSettings(),
    setSettings: (patch: Partial<Settings>) => repo.setSettings(patch),
    getUi: (key: string) => repo.getKv<Record<string, unknown>>(`ui:${key}`, {}),
    setUi: (key: string, value: Record<string, unknown>) => repo.setKv(`ui:${key}`, value),

    async folderExists(dir: string) {
      return fs.stat(dir).then((s) => s.isDirectory(), () => false)
    },
  }
  return svc
}

export type Service = ReturnType<typeof createService>
