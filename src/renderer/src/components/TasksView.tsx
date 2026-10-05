import { useEffect, useMemo, useRef, useState } from 'react'
import type { Priority, Task, TaskStatus } from '../../../shared/types'
import { svc } from '../api'
import type { ProjectUi } from '../App'
import { PRIO, STATUS, useUi } from '../ui'
import { useSaver } from './useDebounced'

const ORDER = { progress: 0, open: 1, done: 2 }
const PR = { high: 0, med: 1, low: 2 }

type Props = { pid: string; tasks: Task[]; ui: ProjectUi; setUi: (p: Partial<ProjectUi>) => void; reload: () => Promise<void> }

export function TasksView({ pid, tasks, ui, setUi, reload }: Props) {
  const { confirm, fail } = useUi()
  // local copy so typing shows up in the list right away
  const [local, setLocal] = useState(tasks)
  useEffect(() => setLocal(tasks), [tasks])
  const saver = useSaver<{ id: number; title: string; description: string }>((v) => svc.updateTask(v.id, v).then(() => reload(), fail))
  const titleRef = useRef<HTMLInputElement>(null)

  const list = useMemo(
    () =>
      local
        .filter((t) => ui.taskFilter === 'all' || (ui.taskFilter === 'active' ? t.status !== 'done' : t.status === 'done'))
        .sort((a, b) =>
          ui.taskSort === 'prio'
            ? Number(a.status === 'done') - Number(b.status === 'done') || PR[a.priority] - PR[b.priority] || ORDER[a.status] - ORDER[b.status]
            : ORDER[a.status] - ORDER[b.status] || PR[a.priority] - PR[b.priority],
        ),
    [local, ui.taskFilter, ui.taskSort],
  )
  const cur = local.find((t) => t.id === ui.task) ?? list[0] ?? null

  const edit = (patch: Partial<Task>) => {
    if (!cur) return
    const next = { ...cur, ...patch }
    setLocal((l) => l.map((t) => (t.id === cur.id ? next : t)))
    saver.push({ id: cur.id, title: next.title, description: next.description })
  }
  const setProp = async (patch: { status?: TaskStatus; priority?: Priority }) => {
    if (!cur) return
    saver.flush()
    setLocal((l) => l.map((t) => (t.id === cur.id ? { ...t, ...patch } : t)))
    await svc.updateTask(cur.id, patch).catch(fail)
    reload()
  }
  const add = async () => {
    saver.flush()
    const t = await svc.createTask(pid, {})
    setLocal((l) => [t, ...l])
    setUi({ task: t.id, taskFilter: ui.taskFilter === 'done' ? 'all' : ui.taskFilter })
    await reload()
    setTimeout(() => titleRef.current?.focus())
  }
  const remove = async () => {
    if (!cur) return
    if (!(await confirm({ title: 'Delete task?', text: `“${cur.title || 'Untitled'}” will be removed. This can’t be undone.` }))) return
    await svc.removeTask(cur.id)
    setUi({ task: null })
    reload()
  }

  return (
    <div className="notes">
      <aside className="nlist">
        <div className="top"><span>Tasks</span><button className="plus" id="addTask" title="New task" onClick={add}>+</button></div>
        <div className="tctl">
          <div className="seg">
            {([['all', 'All'], ['active', 'Active'], ['done', 'Done']] as const).map(([k, l]) => (
              <button key={k} data-f={k} aria-pressed={ui.taskFilter === k} onClick={() => setUi({ taskFilter: k })}>{l}</button>
            ))}
          </div>
          <label className="tsort">Sort
            <select className="sel" id="tSort" aria-label="Sort tasks" value={ui.taskSort} onChange={(e) => setUi({ taskSort: e.target.value as ProjectUi['taskSort'] })}>
              <option value="status">Status</option>
              <option value="prio">Priority</option>
            </select>
          </label>
        </div>
        {list.length ? list.map((t) => (
          <button key={t.id} className={`ni ti ${t.status}`} data-task={t.id} aria-current={t.id === cur?.id} onClick={() => { saver.flush(); setUi({ task: t.id }) }}>
            <b>{t.title || 'Untitled'}</b>
            <span className="tmeta"><span className={`stat ${t.status}`}>{STATUS[t.status]}</span><span className={`prio ${t.priority}`}><i />{PRIO[t.priority]}</span></span>
          </button>
        )) : <div className="hint" style={{ padding: 8 }}>{local.length ? 'Nothing here.' : 'No tasks yet. Press + to add one.'}</div>}
      </aside>
      {cur ? (
        <section className="nedit" key={cur.id}>
          <div className="trow1">
            <input id="tTitle" ref={titleRef} placeholder="Title" value={cur.title} onChange={(e) => edit({ title: e.target.value })} />
            <button className="btn red" id="tDel" onClick={remove}>Delete</button>
          </div>
          <div className="tprops">
            <span className="lbl">Status</span>
            <div className="seg" data-seg="status">
              {(Object.keys(STATUS) as TaskStatus[]).map((k) => <button key={k} data-val={k} aria-pressed={cur.status === k} onClick={() => setProp({ status: k })}>{STATUS[k]}</button>)}
            </div>
            <span className="lbl">Priority</span>
            <div className="seg" data-seg="prio">
              {(Object.keys(PRIO) as Priority[]).map((k) => <button key={k} data-val={k} aria-pressed={cur.priority === k} onClick={() => setProp({ priority: k })}>{PRIO[k]}</button>)}
            </div>
          </div>
          <textarea id="tDesc" placeholder="Description" value={cur.description} onChange={(e) => edit({ description: e.target.value })} />
        </section>
      ) : (
        <div className="empty"><b>No task selected</b>Create one with +.</div>
      )}
    </div>
  )
}
