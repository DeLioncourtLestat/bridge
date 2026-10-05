import { useState } from 'react'
import type { FileChange, Fork } from '../../../shared/types'
import { svc } from '../api'
import { Overlay } from '../ui'

export function CommitModal({ fork, changes, onClose, onDone }: { fork: Fork; changes: FileChange[]; onClose: () => void; onDone: (hash: string, msg: string) => void }) {
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState(() => new Set(changes.map((c) => c.path)))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!msg.trim()) return setErr('Write a commit message.')
    if (!pick.size) return setErr('Select at least one file.')
    setBusy(true)
    try {
      const hash = await svc.commit(fork.id, [...pick], msg.trim())
      onDone(hash, msg.trim())
    } catch (x) {
      setErr((x as Error).message)
      setBusy(false)
    }
  }
  return (
    <Overlay onClose={onClose}>
      <form className="modal xl" autoComplete="off" onSubmit={submit}>
        <h2>Commit to {fork.branch}</h2>
        <textarea className="inp" id="cMsg" rows={5} autoFocus placeholder="Commit message: first line is the summary, details below" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div className="cfiles">
          {changes.map((c) => (
            <label key={c.path} className="cf">
              <input type="checkbox" data-p={c.path} checked={pick.has(c.path)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(c.path); else n.delete(c.path); return n })} />
              <span className="mono">{c.path}</span>
              <span className="cnt"><i>+{c.add}</i> <em>−{c.del}</em></span>
            </label>
          ))}
        </div>
        {err && <div className="ferr">{err}</div>}
        <div className="mact">
          <span className="h" id="cInfo">{pick.size} of {changes.length} files</span>
          <span className="sp" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn pri" disabled={busy}>Commit</button>
        </div>
      </form>
    </Overlay>
  )
}
