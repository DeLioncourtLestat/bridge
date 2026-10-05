import { useRef, useState } from 'react'
import type { Account, Project, Settings } from '../../../shared/types'
import { Icon, useOutside } from '../ui'

export const accountLabel = (a: Account) => `Claude · ${a.label}`

export function resolveAccount(accounts: Account[], projectAccount: string | null, defaultAccount: string | null) {
  return accounts.find((a) => a.id === projectAccount) || accounts.find((a) => a.id === defaultAccount) || accounts.find((a) => a.connected) || accounts[0] || null
}

/** Button next to Settings: which account this project's agents run under. */
export function AccountMenu({ project, accounts, settings, onChange, onManage }: {
  project: Project; accounts: Account[]; settings: Settings; onChange: (id: string | null) => void; onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false), open)
  const acc = resolveAccount(accounts, project.account, settings.defaultAccount)
  const def = resolveAccount(accounts, null, settings.defaultAccount)
  const item = (val: string | null, label: React.ReactNode) => (
    <button key={val ?? 'default'} data-acc={val ?? ''} role="menuitemradio" aria-checked={project.account === val} onClick={() => { setOpen(false); onChange(val) }}>
      <span className="chk">{project.account === val ? '✓' : ''}</span>{label}
    </button>
  )
  return (
    <div ref={ref}>
      <button className="accbtn" id="accBtn" aria-label="Project account" aria-haspopup="menu" title={`${project.name} runs agents as ${acc ? accountLabel(acc) : 'no account'}${project.account ? '' : ' (default)'}`} onClick={() => setOpen((v) => !v)}>
        {Icon.user}<span>{acc?.label ?? 'no account'}</span>
      </button>
      {open && (
        <div className="ctx" role="menu" style={{ top: 44, right: 50 }}>
          <div className="ph">{project.name} runs agents as</div>
          {item(null, <>Default <span className="dim">· {def ? accountLabel(def) : 'none'}</span></>)}
          {accounts.map((a) => item(a.id, <>{accountLabel(a)}{!a.connected && <span className="dim">· signed out</span>}</>))}
          <div className="sep" />
          <button onClick={() => { setOpen(false); onManage() }}><span className="chk" />Manage accounts…</button>
        </div>
      )}
    </div>
  )
}
