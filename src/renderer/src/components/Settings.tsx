import { useEffect, useRef, useState } from 'react'
import type { Account, Project, Settings } from '../../../shared/types'
import { bridge, svc } from '../api'
import { ACCENTS, CODE_FONTS, CODE_SIZES, UI_FONTS } from '../settings'
import { Overlay, useUi } from '../ui'
import { resolveAccount } from './AccountMenu'
import { Xterm } from './Xterm'

type Section = 'agents' | 'appearance' | 'editor' | 'terminal'
const SECTIONS: [Section, string][] = [['agents', 'Agents & accounts'], ['appearance', 'Appearance'], ['editor', 'Editor'], ['terminal', 'Terminal']]

type Props = {
  settings: Settings; accounts: Account[]; projects: Project[]; project: Project | null
  onSettings: (s: Settings) => void; reloadAccounts: () => Promise<void>; onClose: () => void
}

export function SettingsModal({ settings: st, accounts, projects, project, onSettings, reloadAccounts, onClose }: Props) {
  const { fail, confirm } = useUi()
  const [sec, setSec] = useState<Section>('agents')
  const [adding, setAdding] = useState<string | null>(null)
  const [login, setLogin] = useState<Account | null>(null)
  const [cli, setCli] = useState<string | null | undefined>(undefined)
  useEffect(() => { bridge().cliInfo().then((i) => setCli(i.claude)) }, [])

  const set = async (patch: Partial<Settings>) => onSettings(await svc.setSettings(patch))
  const def = resolveAccount(accounts, null, st.defaultAccount)
  const usedBy = (a: Account) => projects.filter((p) => resolveAccount(accounts, p.account, st.defaultAccount)?.id === a.id).map((p) => p.name)

  const tog = (key: keyof Settings, label: string, hint?: string) => (
    <div className="srow"><div><div className="k">{label}</div>{hint && <div className="h">{hint}</div>}</div>
      <button className="tog" role="switch" aria-checked={!!st[key]} data-tog={key} aria-label={label} onClick={() => set({ [key]: !st[key] } as Partial<Settings>)} /></div>
  )
  const select = (key: keyof Settings, label: string, opts: (string | number | [string, string])[], hint?: string) => (
    <div className="srow"><div><div className="k">{label}</div>{hint && <div className="h">{hint}</div>}</div>
      <select className="sel" data-sel={key} aria-label={label} value={String(st[key])} onChange={(e) => set({ [key]: isNaN(+e.target.value) ? e.target.value : +e.target.value } as Partial<Settings>)}>
        {opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [String(o), String(o)]; return <option key={v} value={v}>{l}</option> })}
      </select></div>
  )

  const addAccount = async () => {
    const label = adding?.trim()
    if (!label) return
    try {
      const id = await svc.addAccount(label)
      setAdding(null)
      await reloadAccounts()
      const acc = (await svc.listAccounts()).find((a) => a.id === id)
      if (acc && cli) setLogin(acc)
    } catch (e) { fail(e) }
  }

  const body = () => {
    if (sec === 'agents') return (
      <>
        <div><h3>Agents & accounts</h3><p className="lead">Each Claude account is its own config folder. Projects use the default account unless you pick another one with the account button next to Settings.</p></div>
        {cli === null && <div className="cli-missing">Claude Code CLI wasn’t found in ~/.local/bin, /opt/homebrew/bin or /usr/local/bin. Install it to run agents; the assistant still works offline for simple requests.</div>}
        <div className="sgroup"><h4>Claude accounts</h4>
          {accounts.map((a) => {
            const used = usedBy(a)
            return (
              <div key={a.id} className="acc" data-account={a.id}>
                <span className="alogo" style={{ background: '#d97757' }}>C</span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Claude · {a.label}
                    {a.connected ? <span className="pill on">Signed in</span> : <span className="pill">Signed out</span>}
                    {def?.id === a.id && <span className="pill def">Default</span>}</div>
                  <div className="h">{a.email ? `${a.email} · ` : ''}{used.length ? `used by ${used.join(', ')}` : 'not used by any project'}</div>
                  <div className="h mono">{a.configDir ?? '~/.claude (no CLAUDE_CONFIG_DIR)'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {def?.id !== a.id && <button className="btn" data-default={a.id} onClick={() => set({ defaultAccount: a.id })}>Make default</button>}
                  <button className="btn" data-signin={a.id} disabled={!cli} onClick={() => setLogin(a)}>{a.connected ? 'Open CLI' : 'Sign in'}</button>
                  {!used.length && def?.id !== a.id && <button className="btn red" data-remove={a.id} onClick={async () => {
                    if (await confirm({ title: 'Remove account?', text: `Bridge stops showing “${a.label}”. The folder ${a.configDir ?? '~/.claude'} stays on disk, so you stay signed in there.`, ok: 'Remove' })) { await svc.removeAccount(a.id); reloadAccounts() }
                  }}>Remove</button>}
                </div>
              </div>
            )
          })}
          {!accounts.length && <div className="hint" style={{ padding: '8px 0' }}>No Claude config folders found yet.</div>}
          {adding !== null ? (
            <div className="addacc">
              <input className="inp" id="aLabel" autoFocus placeholder="Label, e.g. work" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAccount()} />
              <span className="h" style={{ color: 'var(--faint)', fontSize: 12 }}>folder ~/.claude-{adding.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || '…'}</span>
              <button className="btn" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn pri" id="aAdd" onClick={addAccount}>Add{cli ? ' and sign in' : ''}</button>
            </div>
          ) : <div style={{ paddingTop: 10 }}><button className="btn" id="aNew" onClick={() => setAdding('')}>+ Add account</button></div>}
        </div>
        <div className="sgroup"><h4>Agent</h4>
          {select('permissionMode', 'Permissions', [['acceptEdits', 'Accept edits (asks before commands)'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass all checks']], 'How freely the agent may act inside its fork')}
          <div className="srow"><div><div className="k">Claude Code CLI</div><div className="h">Used for forks and the assistant</div></div><span className="mono pathval">{cli === undefined ? '…' : cli ?? 'not found'}</span></div>
          {project && <div className="srow"><div><div className="k">Fork folders</div><div className="h">A sibling folder next to the project; one subfolder per fork</div></div><span className="mono pathval" title={`${project.path.replace(/\/[^/]+$/, '')}/${project.name}_worktrees/`}>{project.path.replace(/\/[^/]+$/, '')}/{project.name}_worktrees/</span></div>}
        </div>
      </>
    )
    if (sec === 'appearance') return (
      <>
        <div><h3>Appearance</h3><p className="lead">Changes apply right away.</p></div>
        <div className="sgroup"><h4>Theme</h4>
          <div className="srow"><div><div className="k">Accent color</div><div className="h">Selection, active items, task chips</div></div>
            <div className="swatches">{Object.entries(ACCENTS).map(([n, [c]]) => <button key={n} className="sw" style={{ background: c }} aria-pressed={st.accent === n} data-accent={n} title={n} aria-label={n} onClick={() => set({ accent: n })} />)}</div></div>
          <div className="srow"><div><div className="k">Corners</div></div>
            <div className="seg">{([[0, 'Square'], [2, 'Sharp'], [6, 'Soft']] as const).map(([v, l]) => <button key={v} data-radius={v} aria-pressed={st.radius === v} onClick={() => set({ radius: v })}>{l}</button>)}</div></div>
          {tog('compact', 'Compact density', 'Tighter rows in lists and chat')}
        </div>
        <div className="sgroup"><h4>Fonts</h4>
          {select('uiFont', 'Interface font', Object.keys(UI_FONTS))}
          {select('uiSize', 'Interface size', [13, 14, 15, 16])}
          {select('codeFont', 'Code font', Object.keys(CODE_FONTS))}
          {select('codeSize', 'Code size', Object.keys(CODE_SIZES))}
        </div>
        <div className="preview"><div style={{ color: 'var(--fg-hi)' }}>Preview</div><div style={{ color: 'var(--dim)' }}>Tasks, notes and chat use the interface font.</div><code>export const HOUR_PX = 52 // code font</code><div><span className="chip">Task: Export and import JSON</span></div></div>
      </>
    )
    if (sec === 'editor') return (
      <>
        <div><h3>Editor</h3><p className="lead">The Explorer inside forks.</p></div>
        <div className="sgroup">
          {tog('lineNumbers', 'Line numbers')}
          {tog('highlightChanges', 'Highlight changed lines', 'Green background and a bar next to lines that differ from the last commit')}
          {select('tabSize', 'Tab size', [2, 4])}
        </div>
      </>
    )
    return (
      <>
        <div><h3>Terminal</h3><p className="lead">Terminals open in the fork’s worktree folder. Changes apply to new terminals.</p></div>
        <div className="sgroup">{select('shell', 'Shell', window.bridge.platform === 'win32' ? ['powershell.exe', 'cmd.exe'] : ['zsh', 'bash', 'fish'])}</div>
      </>
    )
  }

  return (
    <>
      <Overlay onClose={onClose}>
        <div className="settings" role="dialog" aria-label="Settings">
          <nav className="snav"><h2>Settings</h2>
            {SECTIONS.map(([id, label]) => <button key={id} data-sec={id} aria-current={sec === id} onClick={() => setSec(id)}>{label}</button>)}
            <span style={{ flex: 1 }} />
            <button id="sReset" style={{ color: 'var(--faint)', fontSize: 12.5 }} onClick={async () => {
              if (await confirm({ title: 'Reset appearance?', text: 'Colors, fonts, editor and terminal settings go back to defaults. Accounts stay.', ok: 'Reset' }))
                set({ accent: 'Blue', radius: 2, compact: false, uiFont: 'System', uiSize: 14, codeFont: 'System mono', codeSize: 12.5, lineNumbers: true, highlightChanges: true, tabSize: 2 })
            }}>Reset to defaults</button>
          </nav>
          <div className="sbody">{body()}</div>
        </div>
      </Overlay>
      {login && <LoginModal account={login} onClose={() => { setLogin(null); reloadAccounts() }} />}
    </>
  )
}

/** Runs `claude` with the account's config folder so the user can type /login. */
function LoginModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [err, setErr] = useState('')
  const session = useRef<string | null>(null)
  const close = () => { if (session.current) bridge().loginClose(session.current); onClose() }
  return (
    <div className="ov" style={{ zIndex: 80 }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="loginbox" role="dialog" aria-label="Sign in">
        <header><b>Sign in · {account.label}</b><span>Type <code>/login</code> and follow the steps. Close when you’re done.</span><span className="sp" /><button className="btn" id="loginDone" onClick={close}>Done</button></header>
        {err ? <div className="hint">{err}</div> : (
          <Xterm attach={async (cols, rows) => {
            const r = await bridge().login(account.id, cols, rows)
            if (r.error || !r.id) { setErr(r.error || 'Could not start the CLI'); return null }
            session.current = r.id
            return { id: r.id, buffer: r.buffer ?? '' }
          }} />
        )}
      </div>
    </div>
  )
}
