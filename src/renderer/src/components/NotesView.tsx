import type { Note } from '../../../shared/types'
import { svc } from '../api'
import type { ProjectUi } from '../App'
import { DocsView } from './Docs'

type Props = { pid: string; notes: Note[]; ui: ProjectUi; setUi: (p: Partial<ProjectUi>) => void; reload: () => Promise<void> }

export function NotesView({ pid, notes, ui, setUi, reload }: Props) {
  return (
    <DocsView
      kind="note"
      label="Note"
      items={notes}
      cur={ui.note}
      select={(id) => setUi({ note: id })}
      create={async () => { const n = await svc.createNote(pid, {}); await reload(); return n }}
      save={async (d) => { await svc.updateNote(d.id, { title: d.title, body: d.body }); await reload() }}
      remove={async (id) => { await svc.removeNote(id); await reload() }}
      emptyList="No notes yet. Press + to add one."
      emptyHint="Create one with +."
      placeholder="Write something… Markdown works: # heading, **bold**, - list, - [ ] todo, `code`"
    />
  )
}
