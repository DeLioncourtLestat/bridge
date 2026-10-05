import { useEffect, useRef, useState } from 'react'
import type { Account, AssistantMessage, Project, Ref, Settings } from '../../../shared/types'
import { esc } from '../../../shared/util'
import { svc } from '../api'
import { useUi } from '../ui'
import { accountLabel, resolveAccount } from './AccountMenu'

const bold = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')
const EXAMPLES = ['Create task fix week start on Monday, urgent', 'Note: Supabase — keep refresh tokens server-side', 'What tasks are open?']

/** Bottom-left chat that turns plain requests into tasks and notes of this project. */
export function AssistantPanel({ project, accounts, settings, onClose, onChanged, onOpen }: {
  project: Project; accounts: Account[]; settings: Settings; onClose: () => void; onChanged: () => void; onOpen: (r: Ref) => void
}) {
  const { fail } = useUi()
  const [msgs, setMsgs] = useState<AssistantMessage[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const acc = resolveAccount(accounts, project.account, settings.defaultAccount)

  useEffect(() => { svc.assistantHistory(project.id).then(setMsgs); input.current?.focus() }, [project.id])
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }) }, [msgs.length, busy])

  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    setBusy(true)
    setMsgs((m) => [...m, { id: -Date.now(), projectId: project.id, role: 'user', text: t, tools: [], open: null, createdAt: Date.now() }])
    try {
      await svc.assistantSend(project.id, t)
      setMsgs(await svc.assistantHistory(project.id))
      onChanged()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  return (
    <section className="helper" id="helper" aria-label="Project assistant">
      <header><b>Assistant</b><span>{project.name} · {acc ? accountLabel(acc) : 'offline'}</span><button className="hx" id="helperClose" aria-label="Close assistant" onClick={onClose}>×</button></header>
      <div className="hmsgs" id="hmsgs" ref={box}>
        {msgs.length ? msgs.map((m) =>
          m.role === 'user' ? <div key={m.id} className="hm me">{m.text}</div> : (
            <div key={m.id} className="hm">
              {m.tools.length > 0 && <div className="tool">{m.tools.map((t, i) => <span key={i}>{t}</span>)}</div>}
              <span dangerouslySetInnerHTML={{ __html: bold(m.text) }} />
              {m.open && <> <button className="hopen" data-hopen={`${m.open.kind}:${m.open.id}`} onClick={() => onOpen(m.open!)}>Open</button></>}
            </div>
          ),
        ) : (
          <div className="hempty">Ask me to add a task or write a note in this project.{EXAMPLES.map((e) => <div key={e}><span className="ex" style={{ font: '12px var(--f-code)', color: 'var(--accent-2)', cursor: 'pointer' }} onClick={() => { setText(e); input.current?.focus() }}>{e}</span></div>)}</div>
        )}
        {busy && <div className="working"><i />Thinking…</div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea id="helperIn" ref={input} rows={2} placeholder="Create task… / Note: …" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } if (e.key === 'Escape') onClose() }} />
      </form>
    </section>
  )
}
