import type { Instruction } from '../../../shared/types'
import { svc } from '../api'
import type { ProjectUi } from '../App'
import { DocsView } from './Docs'

export const INSTR_PLACEHOLDER = 'What the agent should always do here, in markdown. E.g. “Use RSpec, not Minitest”, “Answer in Russian”, “Run bin/rubocop before you finish”.'

/** Project-wide instructions: every agent in this project follows them (each fork can switch some off). */
export function InstructionsView({ pid, items, ui, setUi, reload }: {
  pid: string; items: Instruction[]; ui: ProjectUi; setUi: (p: Partial<ProjectUi>) => void; reload: () => Promise<void>
}) {
  return (
    <DocsView
      kind="instr"
      label="Instruction"
      items={items}
      cur={ui.instr}
      select={(id) => setUi({ instr: id })}
      create={async () => { const n = await svc.createInstruction(pid, {}); await reload(); return n }}
      save={async (d) => { await svc.updateInstruction(d.id, { title: d.title, body: d.body }); await reload() }}
      remove={async (id) => { await svc.removeInstruction(id); await reload() }}
      note={<p className="ilead">Every agent in this project follows these, like skill files in a repo. A fork can switch one off or add its own.</p>}
      emptyList="No instructions yet. Press + to add one."
      emptyHint="Create one with +."
      placeholder={INSTR_PLACEHOLDER}
    />
  )
}
