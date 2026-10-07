import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, AgentEvent, Fork, Instruction, Note, Project, Settings, Task } from '../../shared/types'
import { bridge, svc } from './api'
import { AccountMenu } from './components/AccountMenu'
import { ForkModal } from './components/ForkModal'
import { ForkView } from './components/ForkView'
import { InstructionsView } from './components/InstructionsView'
import { NotesView } from './components/NotesView'
import { SettingsModal } from './components/Settings'
import { TasksView } from './components/TasksView'
import { ProjectIconModal, TileContent, tileStyle } from './components/ProjectIcon'
import { SearchPopup, type SearchMode } from './components/Search'
import { applySettings, keyRecording, OPEN_FILE_EVENT } from './settings'
import { Icon, UiProvider, useOutside, useUi } from './ui'

/** What each project remembers about how you left it. */
export type ProjectUi = {
  tab: string // 'tasks' | 'notes' | 'instructions' | fork id
  task: number | null
  note: number | null
  instr: number | null
  taskFilter: 'all' | 'active' | 'done'
  taskSort: 'status' | 'prio'
}
const DEFAULT_UI: ProjectUi = { tab: 'tasks', task: null, note: null, instr: null, taskFilter: 'all', taskSort: 'status' }

/** Fork tab state: spinner while the agent works, a check once it finished and you haven't looked yet. */
function StateMark({ state }: { state: Fork['state'] }) {
  if (state === 'run') return <span className="sq run" role="img" aria-label="Agent is working" title="Agent is working"><i className="spin" /></span>
  if (state === 'wait') return <span className="sq wait" role="img" aria-label="Agent finished" title="Agent finished — not seen yet">{Icon.check}</span>
  return <span className="sq idle" />
}

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
  const [pmenu, setPmenu] = useState<{ p: Project; x: number; y: number } | null>(null)
  const [iconFor, setIconFor] = useState<Project | null>(null)
  const [search, setSearch] = useState<SearchMode | null>(null)
  const pmenuRef = useRef<HTMLDivElement>(null)
  useOutside(pmenuRef, () => setPmenu(null), !!pmenu)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [instrs, setInstrs] = useState<Instruction[]>([])
  const [forksByProject, setForksByProject] = useState<Record<string, Fork[]>>({})
  const [pui, setPui] = useState<ProjectUi>(DEFAULT_UI)
  const [modal, setModal] = useState<null | 'fork' | 'settings'>(null)
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
  const reloadInstrs = useCallback(async () => { if (!pid) return; const l = await svc.listInstructions(pid); if (pidRef.current === pid) setInstrs(l) }, [pid])
  const reloadAccounts = useCallback(async () => setAccounts(await svc.listAccounts()), [])
  // the agent added or changed tasks / notes through its Bridge tools
  useEffect(() => bridge().on('data:changed', (e: { projectId: string }) => { if (e.projectId === pidRef.current) { reloadTasks(); reloadNotes() } }), [reloadTasks, reloadNotes])

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
      setInstrs([])
      const [t, n, ins, u] = await Promise.all([svc.listTasks(pid), svc.listNotes(pid), svc.listInstructions(pid), svc.getUi(pid)])
      if (!alive) return
      setTasks(t)
      setNotes(n)
      setInstrs(ins)
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
  const tab = activeFork ? activeFork.id : pui.tab === 'notes' || pui.tab === 'instructions' ? pui.tab : 'tasks'

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

  // a notification was clicked: show that fork
  useEffect(() => bridge().on('open-fork', (e: { projectId: string; forkId: string }) => {
    if (e.projectId === pidRef.current) { reloadForks(); updatePui({ tab: e.forkId }) }
    else setPid(e.projectId)
  }), [reloadForks, updatePui])

  // app menu
  const menuRef = useRef<(name: string) => void>(() => {})
  menuRef.current = (name) => {
    if (keyRecording.on) return // Settings is capturing a new shortcut
    if (name === 'open-project') addProject()
    else if (name === 'settings') setModal('settings')
    else if (!project) return
    else if (name === 'new-fork') setModal('fork')
    else if (name === 'tasks' || name === 'notes' || name === 'instructions') updatePui({ tab: name })
    else if (name === 'find-in-files') setSearch('text')
    else if (name === 'go-to-file') setSearch('files')
  }
  useEffect(() => bridge().on('menu', (n: string) => menuRef.current(n)), [])

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
            <button key={p.id} className="pj" data-proj={p.id} aria-current={p.id === pid} style={tileStyle(p)} title={`${p.name}\n${p.path}`} onClick={() => setPid(p.id)}
              onContextMenu={(e) => { e.preventDefault(); setPmenu({ p, x: e.clientX, y: e.clientY }) }}>
              <TileContent p={p} />
              {st && <span className={`st ${st}`} title={st === 'run' ? 'An agent is working' : 'An agent finished'}>{st === 'run' ? <i className="spin" /> : Icon.check}</span>}
            </button>
          )
        })}
        <button className="addp" id="addProj" title="Open project (⌘O)" aria-label="Open project" onClick={addProject}>+</button>
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
              <button className="tab" role="tab" data-tab="instructions" aria-selected={tab === 'instructions'} onClick={() => updatePui({ tab: 'instructions' })}>
                Instructions <span className="n">{instrs.length}</span>
              </button>
              {forks.filter((f) => f.open).map((f) => (
                <button key={f.id} className="tab" role="tab" data-tab={f.id} aria-selected={tab === f.id} title={f.branch} onClick={() => updatePui({ tab: f.id })}>
                  <StateMark state={f.state} />
                  {f.ghost && <span className="ghi" title="Ghost: works in the project folder">{Icon.ghost}</span>}
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
          ) : tab === 'instructions' ? (
            <InstructionsView key={project.id} pid={project.id} items={instrs} ui={pui} setUi={updatePui} reload={reloadInstrs} />
          ) : activeFork ? (
            <ForkView
              key={activeFork.id}
              fork={activeFork}
              tasks={tasks}
              notes={notes}
              instructions={instrs}
              reloadInstructions={reloadInstrs}
              settings={settings}
              onForkChanged={reloadForks}
              onTasksChanged={reloadTasks}
            />
          ) : null}
        </div>
      </div>

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
      {pmenu && (
        <div className="ctx" role="menu" ref={pmenuRef} style={{ left: pmenu.x, top: pmenu.y }} onKeyDown={(e) => e.key === 'Escape' && setPmenu(null)}>
          <div className="ph">{pmenu.p.name}</div>
          <button role="menuitem" id="pmIcon" onClick={() => { setIconFor(pmenu.p); setPmenu(null) }}><span className="chk" />Project icon…</button>
          <button role="menuitem" onClick={() => { bridge().reveal(pmenu.p.path); setPmenu(null) }}><span className="chk" />Show in folder</button>
        </div>
      )}
      {search && project && (
        <SearchPopup
          key={search}
          mode={search}
          target={{ projectId: project.id, forkId: activeFork?.id ?? null }}
          where={activeFork ? `${activeFork.title} · ${activeFork.ghost ? 'project folder' : activeFork.branch}` : project.name}
          canOpen={!!activeFork}
          onClose={() => setSearch(null)}
          onOpen={(file, line) => {
            setSearch(null)
            window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { forkId: activeFork!.id, file, line } }))
          }}
        />
      )}
      {iconFor && <ProjectIconModal project={iconFor} onClose={() => setIconFor(null)} onSaved={reloadProjects} />}
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
