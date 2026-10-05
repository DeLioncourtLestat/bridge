import { useEffect, useRef, useState } from 'react'
import { mdRender, mdSnippet, toggleCheckbox } from '../../../shared/markdown'
import type { Note } from '../../../shared/types'
import { svc } from '../api'
import type { ProjectUi } from '../App'
import { useUi } from '../ui'
import { useSaver } from './useDebounced'

type Props = { pid: string; notes: Note[]; ui: ProjectUi; setUi: (p: Partial<ProjectUi>) => void; reload: () => Promise<void> }

export function NotesView({ pid, notes, ui, setUi, reload }: Props) {
  const { confirm, fail } = useUi()
  const [local, setLocal] = useState(notes)
  useEffect(() => setLocal(notes), [notes])
  const [editing, setEditing] = useState(false)
  const saver = useSaver<{ id: number; title: string; body: string }>((v) => svc.updateNote(v.id, v).then(() => reload(), fail))
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const cur = local.find((n) => n.id === ui.note) ?? local[0] ?? null

  const startEdit = () => setEditing(true)

  const edit = (patch: Partial<Note>) => {
    if (!cur) return
    const next = { ...cur, ...patch }
    setLocal((l) => l.map((n) => (n.id === cur.id ? next : n)))
    saver.push({ id: cur.id, title: next.title, body: next.body })
  }
  const select = (id: number) => { saver.flush(); setEditing(false); setUi({ note: id }) }
  const add = async () => {
    saver.flush()
    const n = await svc.createNote(pid, {})
    setLocal((l) => [n, ...l])
    setUi({ note: n.id })
    await reload()
    setEditing(true)
    setTimeout(() => titleRef.current?.focus())
  }
  const remove = async () => {
    if (!cur) return
    if (!(await confirm({ title: 'Delete note?', text: `“${cur.title || 'Untitled'}” will be removed. This can’t be undone.` }))) return
    await svc.removeNote(cur.id)
    setUi({ note: null })
    reload()
  }
  const onViewClick = (e: React.MouseEvent) => {
    const cb = (e.target as HTMLElement).closest('.cb') as HTMLElement | null
    if (cb && cur) return edit({ body: toggleCheckbox(cur.body, Number(cb.dataset.line)) })
    if ((e.target as HTMLElement).closest('a')) return
    startEdit()
  }

  return (
    <div className="notes">
      <aside className="nlist">
        <div className="top"><span>Notes</span><button className="plus" id="addNote" title="New note" onClick={add}>+</button></div>
        {local.length ? local.map((n) => (
          <button key={n.id} className="ni" data-note={n.id} aria-current={n.id === cur?.id} onClick={() => select(n.id)}>
            <b>{n.title || 'Untitled'}</b>
            <span>{mdSnippet(n.body) || 'Empty'}</span>
          </button>
        )) : <div className="hint" style={{ padding: 8 }}>No notes yet. Press + to add one.</div>}
      </aside>
      {cur ? (
        <section className="nedit" key={cur.id}>
          <div className="trow1">
            <input id="nTitle" ref={titleRef} placeholder="Title" value={cur.title} onChange={(e) => edit({ title: e.target.value })} />
            <button className="btn red" id="nDel" onClick={remove}>Delete</button>
          </div>
          {editing ? (
            <textarea
              id="nDesc"
              ref={bodyRef}
              autoFocus
              onFocus={(e) => { const t = e.currentTarget; t.setSelectionRange(t.value.length, t.value.length) }}
              placeholder="Write something… Markdown works: # heading, **bold**, - list, - [ ] todo, `code`"
              value={cur.body}
              onChange={(e) => edit({ body: e.target.value })}
              onBlur={(e) => { saver.flush(); if ((e.relatedTarget as HTMLElement | null)?.id !== 'nTitle') setEditing(false) }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() } }}
            />
          ) : (
            <div
              className="md"
              id="nView"
              tabIndex={0}
              title="Click to edit"
              onClick={onViewClick}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startEdit() } }}
              dangerouslySetInnerHTML={{ __html: cur.body.trim() ? mdRender(cur.body) : '<p class="mdempty">Empty. Click to write.</p>' }}
            />
          )}
        </section>
      ) : (
        <div className="empty"><b>No note selected</b>Create one with +.</div>
      )}
    </div>
  )
}
