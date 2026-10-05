import { useEffect, useMemo, useState } from 'react'
import type { Account, Fork, Project, Settings } from '../../../shared/types'
import { slug, validBranch } from '../../../shared/util'
import { svc } from '../api'
import { Overlay } from '../ui'
import { accountLabel, resolveAccount } from './AccountMenu'

type Props = { project: Project; forks: Fork[]; accounts: Account[]; settings: Settings; onClose: () => void; onOpened: (f: Fork) => void }

export function ForkModal({ project, forks, accounts, settings, onClose, onOpened }: Props) {
  const closed = forks.filter((f) => !f.open)
  const [mode, setMode] = useState<'new' | 'open'>('new')
  const [bmode, setBmode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [branches, setBranches] = useState<{ name: string; usedBy: string | null }[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { svc.branches(project.id).then(setBranches) }, [project.id])

  const n = forks.length + 1
  const autoBranch = `agent/${slug(name) || `fork-${n}`}`
  const target = bmode === 'new' ? branch.trim() || autoBranch : pick
  const parent = project.path.replace(/\/[^/]+$/, '')
  const folder = useMemo(() => `${parent}/${project.name}_worktrees/${(target || '…').split('/').pop()}`, [parent, project.name, target])
  const acc = resolveAccount(accounts, project.account, settings.defaultAccount)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode !== 'new') return
    if (!target) return setErr('Pick a branch.')
    if (bmode === 'new') {
      if (!validBranch(target)) return setErr('Branch names can use letters, digits, “-”, “_”, “.” and “/”.')
      if (branches.some((b) => b.name === target)) return setErr(`Branch ${target} already exists. Pick it under Existing branch.`)
    }
    setBusy(true)
    setErr('')
    try {
      const f = await svc.createFork(project.id, { title: name, branch: target, newBranch: bmode === 'new' })
      onOpened(f)
    } catch (x) {
      setErr((x as Error).message)
      setBusy(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form className="modal wide" autoComplete="off" onSubmit={submit}>
        <h2>Fork</h2>
        <div className="seg">
          <button type="button" data-mode="new" aria-pressed={mode === 'new'} onClick={() => { setMode('new'); setErr('') }}>New fork</button>
          <button type="button" data-mode="open" aria-pressed={mode === 'open'} onClick={() => { setMode('open'); setErr('') }}>Open existing{closed.length ? ` (${closed.length})` : ''}</button>
        </div>
        {mode === 'new' ? (
          <>
            <label>Fork name<input className="inp" id="fName" autoFocus placeholder="e.g. Recurring events" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Branch
              <div className="seg">
                <button type="button" data-bmode="new" aria-pressed={bmode === 'new'} onClick={() => { setBmode('new'); setErr('') }}>New branch</button>
                <button type="button" data-bmode="existing" aria-pressed={bmode === 'existing'} onClick={() => { setBmode('existing'); setErr('') }}>Existing branch</button>
              </div>
            </label>
            {bmode === 'new' ? (
              <>
                <input className="inp mono" id="fBranch" aria-label="New branch name" placeholder={autoBranch} value={branch} onChange={(e) => setBranch(e.target.value)} />
                <span className="h">Created from the branch checked out in {project.name}</span>
              </>
            ) : (
              <div className="blist">
                {branches.map((b) => (
                  <button type="button" key={b.name} className="bi" data-pick={b.name} disabled={!!b.usedBy} aria-pressed={pick === b.name} onClick={() => { setPick(b.name); setErr('') }}>
                    <span className="mono">{b.name}</span>{b.usedBy && <span className="h">{b.usedBy}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="h">Agent: {acc ? accountLabel(acc) : 'no account'} (project account)</div>
            <div className="h">Folder: <span className="mono" id="fFolder">{folder}</span></div>
            {err && <div className="ferr" id="fErr">{err}</div>}
            <div className="mact"><span className="sp" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn pri" disabled={busy}>{busy ? 'Creating…' : 'Create fork'}</button></div>
          </>
        ) : (
          <>
            <div className="blist">
              {closed.length ? closed.map((f) => (
                <button type="button" key={f.id} className="bi open" data-reopen={f.id} onClick={async () => { onOpened(await svc.setForkOpen(f.id, true)) }}>
                  <span>{f.title}</span><span className="mono h">{f.branch}</span>
                </button>
              )) : <div className="hint" style={{ padding: '8px 10px' }}>All forks are already open.</div>}
            </div>
            <div className="mact"><span className="sp" /><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
          </>
        )}
      </form>
    </Overlay>
  )
}
