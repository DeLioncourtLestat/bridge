import { useEffect, useRef, useState, type ReactNode } from 'react'
import { mdRender, mdSnippet, toggleCheckbox } from '../../../shared/markdown'
import { useUi } from '../ui'
import { useSaver } from './useDebounced'

type Doc = { id: number; title: string; body: string }

/** Element ids per kind, so notes keep the ids they always had. */
export const DOC_IDS = {
  note: { add: 'addNote', title: 'nTitle', body: 'nDesc', view: 'nView', del: 'nDel', item: 'data-note' },
  instr: { add: 'addInstr', title: 'iTitle', body: 'iBody', view: 'iView', del: 'iDel', item: 'data-instr' },
} as const
export type DocKind = keyof typeof DOC_IDS

/** Title + markdown body: shows rendered markdown, click to edit, saves as you type. */
export function DocEditor({ doc, kind, placeholder, onSave, onRemove, banner, autoEdit }: {
  doc: Doc; kind: DocKind; placeholder: string; onSave: (d: Doc) => void; onRemove: () => void; banner?: ReactNode; autoEdit?: boolean
}) {
  const ids = DOC_IDS[kind]
  const [cur, setCur] = useState(doc)
  const [editing, setEditing] = useState(!!autoEdit)
  const saver = useSaver<Doc>(onSave)
  const titleRef = useRef<HTMLInputElement>(null)
  // a new doc opens with the title focused; after that, entering edit mode focuses the body
  const bodyFocus = useRef(!autoEdit)
  const startEdit = () => { bodyFocus.current = true; setEditing(true) }
  useEffect(() => { if (autoEdit) titleRef.current?.focus() }, [autoEdit])
  // pick up changes made elsewhere (e.g. by the agent) while not typing here
  useEffect(() => { if (!editing) setCur(doc) }, [doc.title, doc.body]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (patch: Partial<Doc>) => {
    const next = { ...cur, ...patch }
    setCur(next)
    saver.push(next)
  }
  const onViewClick = (e: React.MouseEvent) => {
    const cb = (e.target as HTMLElement).closest('.cb') as HTMLElement | null
    if (cb) return edit({ body: toggleCheckbox(cur.body, Number(cb.dataset.line)) })
    if ((e.target as HTMLElement).closest('a')) return
    startEdit()
  }
  return (
    <section className="nedit">
      {banner}
      <div className="trow1">
        <input id={ids.title} ref={titleRef} placeholder="Title" value={cur.title} onChange={(e) => edit({ title: e.target.value })} />
        <button className="btn red" id={ids.del} onClick={() => { saver.flush(); onRemove() }}>Delete</button>
      </div>
      {editing ? (
        <textarea
          id={ids.body}
          autoFocus={bodyFocus.current}
          onFocus={(e) => { const t = e.currentTarget; t.setSelectionRange(t.value.length, t.value.length) }}
          placeholder={placeholder}
          value={cur.body}
          onChange={(e) => edit({ body: e.target.value })}
          onBlur={(e) => { saver.flush(); if ((e.relatedTarget as HTMLElement | null)?.id !== ids.title) setEditing(false) }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() } }}
        />
      ) : (
        <div
          className="md"
          id={ids.view}
          tabIndex={0}
          title="Click to edit"
          onClick={onViewClick}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startEdit() } }}
          dangerouslySetInnerHTML={{ __html: cur.body.trim() ? mdRender(cur.body) : '<p class="mdempty">Empty. Click to write.</p>' }}
        />
      )}
    </section>
  )
}

/** A list of markdown docs on the left and the open one on the right (Notes, Instructions). */
export function DocsView<T extends Doc>({ kind, items, cur, select, create, save, remove, label, emptyList, emptyHint, placeholder, banner, note }: {
  kind: DocKind; items: T[]; cur: number | null; select: (id: number | null) => void
  create: () => Promise<T>; save: (d: Doc) => Promise<unknown>; remove: (id: number) => Promise<unknown>
  label: string; emptyList: string; emptyHint: string; placeholder: string; banner?: ReactNode; note?: ReactNode
}) {
  const { confirm, fail } = useUi()
  const ids = DOC_IDS[kind]
  const [fresh, setFresh] = useState<number | null>(null)
  const doc = items.find((n) => n.id === cur) ?? items[0] ?? null
  const add = async () => {
    try { const n = await create(); setFresh(n.id); select(n.id) } catch (e) { fail(e) }
  }
  const del = async () => {
    if (!doc) return
    if (!(await confirm({ title: `Delete ${label.toLowerCase()}?`, text: `“${doc.title || 'Untitled'}” will be removed. This can’t be undone.` }))) return
    await remove(doc.id)
    select(null)
  }
  return (
    <div className="notes">
      <aside className="nlist">
        <div className="top"><span>{label === 'Note' ? 'Notes' : 'Instructions'}</span><button className="plus" id={ids.add} title={`New ${label.toLowerCase()}`} onClick={add}>+</button></div>
        {note}
        {items.length ? items.map((n) => (
          <button key={n.id} className="ni" {...{ [ids.item]: n.id }} aria-current={n.id === doc?.id} onClick={() => select(n.id)}>
            <b>{n.title || 'Untitled'}</b>
            <span>{mdSnippet(n.body) || 'Empty'}</span>
          </button>
        )) : <div className="hint" style={{ padding: 8 }}>{emptyList}</div>}
      </aside>
      {doc ? (
        <DocEditor key={doc.id} doc={doc} kind={kind} placeholder={placeholder} banner={banner} autoEdit={fresh === doc.id}
          onSave={(d) => { save(d).catch(fail) }} onRemove={del} />
      ) : (
        <div className="empty"><b>Nothing selected</b>{emptyHint}</div>
      )}
    </div>
  )
}
