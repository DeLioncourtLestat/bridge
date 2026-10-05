import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, AgentEvent, Fork, Note, Project, Ref, Settings, Task } from '../../shared/types'
import { bridge, svc } from './api'
import { AccountMenu } from './components/AccountMenu'
import { AssistantPanel } from './components/Assistant'
import { ForkModal } from './components/ForkModal'
import { ForkView } from './components/ForkView'
import { NotesView } from './components/NotesView'
import { SettingsModal } from './components/Settings'
import { TasksView } from './components/TasksView'
import { applySettings } from './settings'
import { Icon, UiProvider, useUi } from './ui'

/** What each project remembers about how you left it. */
export type ProjectUi = {
  tab: string // 'tasks' | 'notes' | fork id
  task: number | null
  note: number | null
  taskFilter: 'all' | 'active' | 'done'
  taskSort: 'status' | 'prio'
}
const DEFAULT_UI: ProjectUi = { tab: 'tasks', task: null, note: null, taskFilter: 'all', taskSort: 'status' }

export function App() {
  return (
    <UiProvider>
      <Main />
    </UiProvider>
  )
}

function Main() {
  const ui = useUi()
  const [projects, setProjects] = useState<Project[]>([])
  const [pid, setPid] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [forksByProject, setForksByProject] = useState<Record<string, Fork[]>>({})
  const [pui, setPui] = useState<ProjectUi>(DEFAULT_UI)
  const [modal, setModal] = useState<null | 'fork' | 'settings'>(null)
  const [helperOpen, setHelperOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const project = projects.find((p) => p.id === pid) ?? null
  const forks = useMemo(() => (pid ? forksByProject[pid] ?? [] : []), [forksByProject, pid])

  const reloadProjects = useCallback(async () => {
    const list = await svc.listProjects()
    setProjects(list)
    return list
  }, [])
  const reloadForks = useCallback(async () => {
    const list = await svc.listProjects()
    const entries = await Promise.all(list.map(async (p) => [p.id, await svc.listForks(p.id)] as const))
    setForksByProject(Object.fromEntries(entries))
  }, [])
  // late answers for a project you already left are dropped
  const pidRef = useRef(pid)
  pidRef.current = pid
  const reloadTasks = useCallback(async () => { if (!pid) return; const l = await svc.listTasks(pid); if (pidRef.current === pid) setTasks(l) }, [pid])
  const reloadNotes = useCallback(async () => { if (!pid) return; const l = await svc.listNotes(pid); if (pidRef.current === pid) setNotes(l) }, [pid])
  const reloadAccounts = useCallback(async () => setAccounts(await svc.listAccounts()), [])

  // first load
  useEffect(() => {
    ;(async () => {
      const [list, st, appUi] = await Promise.all([reloadProjects(), svc.getSettings(), svc.getUi('app')])
      setSettings(st)
      applySettings(st)
      await Promise.all([reloadForks(), reloadAccounts()])
      const last = appUi.pid as string | undefined
      setPid(list.find((p) => p.id === last)?.id ?? list[0]?.id ?? null)
      setLoaded(true)
    })()
  }, [reloadProjects, reloadForks, reloadAccounts])

  // project switch: its data and remembered UI
  useEffect(() => {
    if (!pid) return
    let alive = true
    ;(async () => {
      setTasks([])
      setNotes([])
      const [t, n, u] = await Promise.all([svc.listTasks(pid), svc.listNotes(pid), svc.getUi(pid)])
      if (!alive) return
      setTasks(t)
      setNotes(n)
      setPui({ ...DEFAULT_UI, ...(u as Partial<ProjectUi>) })
    })()
    svc.setUi('app', { pid })
    return () => { alive = false }
  }, [pid])

  const updatePui = useCallback((patch: Partial<ProjectUi>) => {
    setPui((cur) => {
      const next = { ...cur, ...patch }
      if (pid) svc.setUi(pid, next)
      return next
    })
  }, [pid])

  // a closed or missing fork tab falls back to Tasks
  const activeFork = forks.find((f) => f.id === pui.tab && f.open) ?? null
  const tab = activeFork ? activeFork.id : pui.tab === 'notes' ? 'notes' : 'tasks'

  // agent progress → fork states (tab squares, rail dots)
  useEffect(() => bridge().on('agent:event', (e: AgentEvent) => { if (e.kind !== 'update') reloadForks() }), [reloadForks])

  const addProject = useCallback(async () => {
    const dir = await bridge().pickFolder()
    if (!dir) return
    try {
      const p = await svc.addProject(dir)
      await Promise.all([reloadProjects(), reloadForks()])
      setPid(p.id)
    } catch (e) {
      if ((e as Error).message !== 'NOT_GIT') return ui.fail(e)
      const ok = await ui.confirm({ title: 'Not a git repository', text: `Bridge uses git branches for forks. Initialize a repository in “${dir.split('/').pop()}”?`, ok: 'Initialize git' })
      if (!ok) return
      try {
        const p = await svc.initRepo(dir)
        await Promise.all([reloadProjects(), reloadForks()])
        setPid(p.id)
      } catch (err) {
        ui.fail(err)
      }
    }
  }, [reloadProjects, reloadForks, ui])

  // app menu
  const menuRef = useRef<(name: string) => void>(() => {})
  menuRef.current = (name) => {
    if (name === 'open-project') addProject()
    else if (name === 'settings') setModal('settings')
    else if (!project) return
    else if (name === 'new-fork') setModal('fork')
    else if (name === 'tasks' || name === 'notes') updatePui({ tab: name })
    else if (name === 'assistant') setHelperOpen((v) => !v)
  }
  useEffect(() => bridge().on('menu', (n: string) => menuRef.current(n)), [])

  const openRef = (r: Ref) => (r.kind === 'task' ? updatePui({ tab: 'tasks', task: r.id, taskFilter: 'all' }) : updatePui({ tab: 'notes', note: r.id }))

  const closeFork = async (f: Fork) => {
    await svc.setForkOpen(f.id, false)
    if (tab === f.id) updatePui({ tab: 'tasks' })
    reloadForks()
  }

  if (!loaded || !settings) return <div className="shell" />

  const openTasks = tasks.filter((t) => t.status !== 'done').length

  return (
    <div className="shell">
      <nav className="rail" aria-label="Projects">
        {projects.map((p) => {
          const states = (forksByProject[p.id] ?? []).map((f) => f.state)
          const st = states.includes('wait') ? 'wait' : states.includes('run') ? 'run' : ''
          return (
            <button key={p.id} className="pj" data-proj={p.id} aria-current={p.id === pid} style={{ background: p.color }} title={`${p.name}\n${p.path}`} onClick={() => setPid(p.id)}>
              {p.short}
              {st && <span className={`st ${st}`} />}
            </button>
          )
        })}
        <button className="addp" id="addProj" title="Open project (⌘O)" aria-label="Open project" onClick={addProject}>+</button>
        {project && (
          <button className="hbtn" id="openHelper" title="Assistant (⌘J)" aria-label="Assistant" aria-pressed={helperOpen} onClick={() => setHelperOpen((v) => !v)}>
            {Icon.spark}
          </button>
        )}
      </nav>

      <div className="app">
        <header className="bar">
          {project && (
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" data-tab="tasks" aria-selected={tab === 'tasks'} onClick={() => updatePui({ tab: 'tasks' })}>
                Tasks <span className="n">{openTasks}</span>
              </button>
              <button className="tab" role="tab" data-tab="notes" aria-selected={tab === 'notes'} onClick={() => updatePui({ tab: 'notes' })}>
                Notes <span className="n">{notes.length}</span>
              </button>
              {forks.filter((f) => f.open).map((f) => (
                <button key={f.id} className="tab" role="tab" data-tab={f.id} aria-selected={tab === f.id} title={f.branch} onClick={() => updatePui({ tab: f.id })}>
                  <span className={`sq ${f.state}`} style={f.state === 'idle' ? { background: 'var(--faint)' } : undefined} />
                  {f.title}
                  <span className="x" role="button" aria-label="Close fork" onClick={(e) => { e.stopPropagation(); closeFork(f) }}>×</span>
                </button>
              ))}
              <button className="plus" id="newFork" title="New or existing fork (⌘N)" onClick={() => setModal('fork')}>+ Fork</button>
            </div>
          )}
          <div className="spacer" />
          {project && <AccountMenu project={project} accounts={accounts} settings={settings} onChange={async (account) => { await svc.updateProject(project.id, { account }); await reloadProjects() }} onManage={() => setModal('settings')} />}
          <button className="gear" id="openSettings" title="Settings (⌘,)" aria-label="Settings" onClick={() => setModal('settings')}>{Icon.gear}</button>
        </header>

        <div className="view">
          {!project ? (
            <div className="empty">
              <b>Open a project</b>
              Pick a folder with a git repository. Tasks, notes and agent forks are kept per project.
              <button className="btn pri" onClick={addProject}>Open project folder</button>
            </div>
          ) : tab === 'tasks' ? (
            <TasksView key={project.id} pid={project.id} tasks={tasks} ui={pui} setUi={updatePui} reload={reloadTasks} />
          ) : tab === 'notes' ? (
            <NotesView key={project.id} pid={project.id} notes={notes} ui={pui} setUi={updatePui} reload={reloadNotes} />
          ) : activeFork ? (
            <ForkView
              key={activeFork.id}
              fork={activeFork}
              tasks={tasks}
              notes={notes}
              settings={settings}
              onForkChanged={reloadForks}
              onTasksChanged={reloadTasks}
            />
          ) : null}
        </div>
      </div>

      {project && helperOpen && (
        <AssistantPanel
          project={project}
          accounts={accounts}
          settings={settings}
          onClose={() => setHelperOpen(false)}
          onChanged={() => { reloadTasks(); reloadNotes() }}
          onOpen={openRef}
        />
      )}
      {modal === 'fork' && project && (
        <ForkModal
          project={project}
          forks={forks}
          accounts={accounts}
          settings={settings}
          onClose={() => setModal(null)}
          onOpened={async (f) => { setModal(null); await reloadForks(); updatePui({ tab: f.id }) }}
        />
      )}
      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          accounts={accounts}
          projects={projects}
          project={project}
          onSettings={(st) => { setSettings(st); applySettings(st) }}
          reloadAccounts={reloadAccounts}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
