import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent, ChatMessage, Commit, DiffOp, FileChange, Fork, Note, Ref, Settings, Task, TerminalInfo } from '../../../shared/types'
import { bridge, svc } from '../api'
import { DiffView, Icon, PRIO, useOutside, useUi } from '../ui'
import { CodeEditor } from './CodeEditor'
import { CommitModal } from './CommitModal'
import { Xterm } from './Xterm'

type View = 'chat' | 'changes' | 'files' | 'term' | 'git'
type ForkUi = { view: View; file: string | null; change: string | null; commit: string | null; term: string | null }
const LABEL: Record<View, string> = { chat: 'Chat', changes: 'Changes', files: 'Explorer', term: 'Terminal', git: 'Git' }

type Props = {
  fork: Fork
  tasks: Task[]
  notes: Note[]
  settings: Settings
  onForkChanged: () => void
  onTasksChanged: () => void
}

export function ForkView({ fork, tasks, notes, settings, onForkChanged, onTasksChanged }: Props) {
  const { fail, toast } = useUi()
  const [fu, setFu] = useState<ForkUi>({ view: 'chat', file: null, change: null, commit: null, term: null })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [changes, setChanges] = useState<FileChange[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [terms, setTerms] = useState<TerminalInfo[] | null>(null) // null until loaded
  const [commitOpen, setCommitOpen] = useState(false)
  const uiKey = `fork:${fork.id}`

  useEffect(() => { svc.getUi(uiKey).then((u) => setFu((cur) => ({ ...cur, ...(u as Partial<ForkUi>) }))) }, [uiKey])
  const setUi = useCallback((patch: Partial<ForkUi>) => setFu((cur) => { const next = { ...cur, ...patch }; svc.setUi(uiKey, next); return next }), [uiKey])

  const refreshGit = useCallback(async () => {
    try {
      const [st, fl, lg] = await Promise.all([svc.status(fork.id), svc.files(fork.id), svc.log(fork.id)])
      setChanges(st)
      setFiles(fl)
      setCommits(lg)
    } catch (e) {
      fail(e)
    }
  }, [fork.id, fail])
  const reloadTerms = useCallback(async () => setTerms(await bridge().term.list(fork.id)), [fork.id])

  useEffect(() => {
    svc.messages(fork.id).then(setMessages)
    refreshGit()
    reloadTerms()
    svc.markSeen(fork.id).then(onForkChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fork.id])

  // live agent output; file changes get picked up as the agent works
  useEffect(() => {
    let t = 0
    return bridge().on('agent:event', (e: AgentEvent) => {
      if (e.forkId !== fork.id) return
      if (e.kind === 'update') setMessages((ms) => ms.some((m) => m.id === e.message.id) ? ms.map((m) => (m.id === e.message.id ? e.message : m)) : [...ms, e.message])
      else svc.messages(fork.id).then(setMessages)
      if (e.kind === 'done') { onTasksChanged(); refreshGit(); svc.markSeen(fork.id).then(onForkChanged) }
      clearTimeout(t)
      t = window.setTimeout(refreshGit, 400)
    })
  }, [fork.id, refreshGit, onForkChanged, onTasksChanged])

  // keep git info fresh while looking at it
  useEffect(() => {
    if (fu.view === 'chat' || fu.view === 'term') return
    const id = window.setInterval(refreshGit, 3000)
    return () => clearInterval(id)
  }, [fu.view, refreshGit])

  const ahead = commits.filter((c) => !c.pushed).length
  const running = fork.state === 'run'

  const dot = (v: View) => (v === 'changes' && changes.length) || (v === 'git' && ahead) ? <span className="cdot" /> : null

  return (
    <div className="ws">
      <aside className="lp">
        <div className="branch"><span className="b" title={`${fork.branch}\n${fork.path}`}>{fork.branch}</span></div>
        <div className="itabs" role="tablist">
          {(Object.keys(LABEL) as View[]).map((v) => (
            <button key={v} className="itab" data-v={v} aria-current={fu.view === v} title={LABEL[v]} aria-label={LABEL[v]} onClick={() => setUi({ view: v })}>
              {Icon[v === 'files' ? 'files' : v]}
              {dot(v)}
            </button>
          ))}
        </div>
        <div className="llist">
          {fu.view === 'chat' && <History messages={messages} />}
          {fu.view === 'changes' && <ChangeList changes={changes} cur={fu.change} pick={(p) => setUi({ change: p })} />}
          {fu.view === 'files' && <FileTree files={files} changes={changes} cur={fu.file} pick={(p) => setUi({ file: p })} />}
          {fu.view === 'term' && terms && <TermList forkId={fork.id} terms={terms} cur={fu.term} pick={(id) => setUi({ term: id })} reload={reloadTerms} />}
          {fu.view === 'git' && (
            <GitList
              commits={commits}
              ahead={ahead}
              changes={changes.length}
              cur={fu.commit}
              pick={(h) => setUi({ commit: h })}
              onPull={() => svc.pull(fork.id).then((m) => { toast(m); refreshGit() }, fail)}
              onPush={() => (ahead ? svc.push(fork.id).then((m) => { toast(m); refreshGit() }, fail) : toast('Nothing to push'))}
              onCommit={() => setCommitOpen(true)}
            />
          )}
        </div>
      </aside>
      <section className="main">
        {fu.view === 'chat' && <Chat fork={fork} messages={messages} setMessages={setMessages} tasks={tasks} notes={notes} running={running} onSent={() => { onForkChanged(); onTasksChanged() }} />}
        {fu.view === 'changes' && <ChangeDiff forkId={fork.id} changes={changes} cur={fu.change} openInExplorer={(p) => setUi({ view: 'files', file: p })} />}
        {fu.view === 'files' && <Explorer forkId={fork.id} files={files} cur={fu.file} settings={settings} onSaved={refreshGit} />}
        {fu.view === 'term' && terms && <TermView forkId={fork.id} terms={terms} cur={fu.term} />}
        {fu.view === 'git' && <CommitView forkId={fork.id} commits={commits} cur={fu.commit} />}
      </section>
      {commitOpen && (
        <CommitModal
          fork={fork}
          changes={changes}
          onClose={() => setCommitOpen(false)}
          onDone={(hash, msg) => { setCommitOpen(false); toast(`Committed ${hash}: ${msg.split('\n')[0]}`); setUi({ commit: null }); refreshGit() }}
        />
      )}
    </div>
  )
}

/* ---------- chat ---------- */

const plain = (s: string) => s.replace(/\s+/g, ' ').trim()

function History({ messages }: { messages: ChatMessage[] }) {
  const [cur, setCur] = useState(0)
  useEffect(() => {
    const box = document.getElementById('msgs')
    if (!box) return
    const sync = () => {
      const top = box.getBoundingClientRect().top
      let c = 0
      box.querySelectorAll<HTMLElement>('.msg[data-i]').forEach((el) => { if (el.getBoundingClientRect().top - top < 40) c = Number(el.dataset.i) })
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) c = messages.length - 1
      setCur(c)
    }
    sync()
    box.addEventListener('scroll', sync)
    return () => box.removeEventListener('scroll', sync)
  }, [messages])
  if (!messages.length) return null
  const jump = (i: number) => {
    const el = document.getElementById(`msg-${i}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }
  return (
    <>
      <h4>History</h4>
      {messages.map((m, i) => (
        <button key={m.id} className="fi hist" data-jump={i} aria-current={i === cur} onClick={() => jump(i)}>
          <span className={`hw ${m.role === 'user' ? 'me' : 'ai'}`}>{m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : 'Agent'}</span>
          <span className="ht">{plain(m.text) || (m.tools.length ? m.tools[0] : '…')}</span>
        </button>
      ))}
    </>
  )
}

function Chat({ fork, messages, setMessages, tasks, notes, running, onSent }: {
  fork: Fork; messages: ChatMessage[]; setMessages: (f: (m: ChatMessage[]) => ChatMessage[]) => void
  tasks: Task[]; notes: Note[]; running: boolean; onSent: () => void
}) {
  const { fail } = useUi()
  const draftKey = `bridge.draft.${fork.id}`
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? '')
  const [attach, setAttach] = useState<Ref[]>([])
  const [picker, setPicker] = useState<null | 'task' | 'note'>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useOutside(popRef, () => setPicker(null), !!picker)
  useEffect(() => { localStorage.setItem(draftKey, draft) }, [draft, draftKey])
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }) }, [messages.length])
  useEffect(() => { inputRef.current?.focus() }, [fork.id])

  const title = (r: Ref) => (r.kind === 'task' ? tasks.find((t) => t.id === r.id)?.title : notes.find((n) => n.id === r.id)?.title) ?? r.title ?? ''
  const has = (r: Ref) => attach.some((a) => a.kind === r.kind && a.id === r.id)

  const send = async () => {
    const text = draft.trim()
    if ((!text && !attach.length) || running) return
    try {
      const res = await svc.send(fork.id, text, attach)
      setMessages((ms) => [...ms, res.user])
      setDraft('')
      setAttach([])
      onSent()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div className="chat">
      <div className="msgs" id="msgs" ref={boxRef}>
        {messages.length ? messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg me" id={`msg-${i}`} data-i={i}>
              {m.refs.length > 0 && <div className="att" style={{ marginBottom: 6 }}>{m.refs.map((r) => <span key={r.kind + r.id} className={`chip ${r.kind}`}>{r.kind === 'task' ? 'Task' : 'Note'}: {title(r)}</span>)}</div>}
              <div className="body">{m.text}</div>
            </div>
          ) : m.role === 'error' ? (
            <div key={m.id} className="msg err" id={`msg-${i}`} data-i={i}>{m.text}</div>
          ) : (
            <div key={m.id} className="msg" id={`msg-${i}`} data-i={i}>
              <div className="who">Agent</div>
              {m.tools.length > 0 && <div className="tool">{m.tools.map((t, k) => <span key={k}>{t}</span>)}</div>}
              <div className="body">{m.text}</div>
            </div>
          ),
        ) : (
          <div className="empty-chat"><b>New fork</b>Pick a task or describe what to do. Add notes as references for extra context. The agent works in this fork’s own folder and never touches main.</div>
        )}
        {running && <div className="working"><i />Agent is working…</div>}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        {attach.length > 0 && (
          <div className="att">
            {attach.map((r) => (
              <span key={r.kind + r.id} className={`chip ${r.kind}`}>
                {r.kind === 'task' ? 'Task' : 'Note'}: {title(r)}
                <button type="button" aria-label="Remove reference" onClick={() => setAttach((a) => a.filter((x) => !(x.kind === r.kind && x.id === r.id)))}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          id="prompt"
          ref={inputRef}
          rows={3}
          placeholder="What should the agent do? Enter to send, Shift+Enter for a new line"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <div className="crow">
          <button type="button" className="btn" data-pick="task" onClick={() => setPicker(picker === 'task' ? null : 'task')}>+ Task</button>
          <button type="button" className="btn" data-pick="note" onClick={() => setPicker(picker === 'note' ? null : 'note')}>+ Note</button>
          <span className="tip">attached as context for the agent</span>
          <span className="sp" />
          {running
            ? <button type="button" className="btn stop" id="stopAgent" onClick={() => svc.stop(fork.id)}>Stop</button>
            : <button type="submit" className="btn pri" id="sendBtn">Send</button>}
          {picker && (
            <div className="pop" ref={popRef} style={{ left: picker === 'note' ? 70 : 0 }}>
              <div className="ph">{picker === 'task' ? 'Project tasks' : 'Notes'}</div>
              {(picker === 'task' ? tasks.filter((t) => t.status !== 'done') : notes).filter((it) => !has({ kind: picker, id: it.id })).map((it) => (
                <button type="button" key={it.id} data-att={it.id} onClick={() => {
                  setAttach((a) => [...a, { kind: picker, id: it.id }])
                  if (picker === 'task' && !draft.trim()) { const t = it as Task; setDraft(t.description ? `${t.title}. ${t.description}` : t.title) }
                  setPicker(null)
                  inputRef.current?.focus()
                }}>
                  {picker === 'task' ? <span className={`prio ${(it as Task).priority}`} title={PRIO[(it as Task).priority]}><i /></span> : <span className="nicon" />}
                  <span className="pt">{it.title || 'Untitled'}{picker === 'note' && (it as Note).body && <small>{(it as Note).body.split('\n')[0]}</small>}</span>
                </button>
              ))}
              {(picker === 'task' ? tasks.filter((t) => t.status !== 'done') : notes).every((it) => has({ kind: picker, id: it.id })) && (
                <div className="hint" style={{ padding: 8 }}>{picker === 'task' ? 'No open tasks.' : 'No notes to add.'}</div>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  )
}

/* ---------- changes ---------- */

function ChangeList({ changes, cur, pick }: { changes: FileChange[]; cur: string | null; pick: (p: string) => void }) {
  const sel = changes.some((c) => c.path === cur) ? cur : changes[0]?.path
  return (
    <>
      <h4>Changed files</h4>
      {changes.length ? changes.map((c) => (
        <button key={c.path} className="fi" data-change={c.path} aria-current={c.path === sel} onClick={() => pick(c.path)}>
          {c.path}<span className="cnt"><i>+{c.add}</i><em>−{c.del}</em></span>
        </button>
      )) : <div className="hint" style={{ padding: 8 }}>No changes.</div>}
    </>
  )
}

function ChangeDiff({ forkId, changes, cur, openInExplorer }: { forkId: string; changes: FileChange[]; cur: string | null; openInExplorer: (p: string) => void }) {
  const c = changes.find((x) => x.path === cur) ?? changes[0]
  const [ops, setOps] = useState<DiffOp[]>([])
  const sig = c ? `${c.path}:${c.add}:${c.del}` : ''
  useEffect(() => { if (c) svc.fileDiff(forkId, c.path).then(setOps) }, [forkId, sig]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <div className="hint">No changes yet. Edits made in the Explorer or by the agent show up here.</div>
  return (
    <>
      <div className="mhead"><span className="p">{c.path}</span><span className="plusn">+{c.add}</span><span className="minusn">−{c.del}</span><span className="sp" />
        {c.kind !== 'D' && <button className="btn" id="openInFiles" onClick={() => openInExplorer(c.path)}>Open in Explorer</button>}</div>
      <div className="mbody"><DiffView ops={ops} /></div>
    </>
  )
}

/* ---------- explorer ---------- */

function FileTree({ files, changes, cur, pick }: { files: string[]; changes: FileChange[]; cur: string | null; pick: (p: string) => void }) {
  const kinds = useMemo(() => Object.fromEntries(changes.map((c) => [c.path, c.kind])), [changes])
  const rows = useMemo(() => {
    const out: { dir?: boolean; name: string; path?: string; depth: number }[] = []
    const seen = new Set<string>()
    // folders before files at every level, then by name
    const sorted = [...files].sort((x, y) => {
      const a = x.split('/'), b = y.split('/')
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] === b[i]) continue
        const aFile = i === a.length - 1, bFile = i === b.length - 1
        if (aFile !== bFile) return aFile ? 1 : -1
        return a[i].localeCompare(b[i])
      }
      return a.length - b.length
    })
    for (const p of sorted) {
      const parts = p.split('/')
      for (let i = 0; i < parts.length - 1; i++) {
        const d = parts.slice(0, i + 1).join('/')
        if (!seen.has(d)) { seen.add(d); out.push({ dir: true, name: parts[i], depth: i }) }
      }
      out.push({ name: parts[parts.length - 1], path: p, depth: parts.length - 1 })
    }
    return out
  }, [files])
  return (
    <>
      {rows.map((r, i) => r.dir ? (
        <div key={'d' + i} className="fi dir" style={{ '--d': `${r.depth * 12}px` } as React.CSSProperties}>{r.name}/</div>
      ) : (
        <button key={r.path} className="fi" data-file={r.path} aria-current={r.path === cur} style={{ '--d': `${r.depth * 12}px` } as React.CSSProperties} onClick={() => pick(r.path!)}>
          {r.name}{kinds[r.path!] && <span className={`st ${kinds[r.path!] === 'A' ? 'a' : 'm'}`}>{kinds[r.path!]}</span>}
        </button>
      ))}
    </>
  )
}

function Explorer({ forkId, files, cur, settings, onSaved }: { forkId: string; files: string[]; cur: string | null; settings: Settings; onSaved: () => void }) {
  const path = cur && files.includes(cur) ? cur : null
  const [doc, setDoc] = useState<{ path: string; content: string; head: string | null } | null>(null)
  const [saved, setSaved] = useState<'saved' | 'saving' | ''>('')
  useEffect(() => {
    if (!path) { setDoc(null); return }
    let alive = true
    svc.readFile(forkId, path).then((r) => { if (alive) setDoc({ path, content: r.content ?? '', head: r.head }) })
    return () => { alive = false }
  }, [forkId, path])
  if (!path) return <div className="hint">Pick a file on the left to open it.</div>
  if (!doc || doc.path !== path) return <div className="hint">Opening…</div>
  return (
    <>
      <div className="mhead"><span className="p">{path}</span><span className="sp" /><span className="saved">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span></div>
      <CodeEditor
        key={path}
        path={path}
        value={doc.content}
        base={doc.head}
        settings={settings}
        onSave={async (text) => {
          setSaved('saving')
          await svc.writeFile(forkId, path, text)
          setSaved('saved')
          onSaved()
        }}
      />
    </>
  )
}

/* ---------- terminals ---------- */

function TermList({ forkId, terms, cur, pick, reload }: { forkId: string; terms: TerminalInfo[]; cur: string | null; pick: (id: string) => void; reload: () => Promise<void> }) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const sel = terms.some((t) => t.id === cur) ? cur : terms[0]?.id
  const add = async () => { const id = await bridge().term.create(forkId); await reload(); pick(id) }
  useEffect(() => { if (!terms.length) add() }, [terms.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const finish = async (t: TerminalInfo, name: string | null) => {
    setRenaming(null)
    if (name?.trim() && name.trim() !== t.name) { await bridge().term.rename(t.id, name.trim()); reload() }
  }
  return (
    <>
      <div className="lhead"><h4>Terminals</h4><button className="mini" id="addTerm" title="New terminal" aria-label="New terminal" onClick={add}>+</button></div>
      {terms.map((t) => (
        <div key={t.id} className="fi trm" aria-current={t.id === sel}>
          {renaming === t.id ? (
            <input className="ren" id="renTerm" autoFocus defaultValue={t.name} aria-label="Terminal name" onFocus={(e) => e.target.select()}
              onBlur={(e) => finish(t, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { e.stopPropagation(); finish(t, null) } }} />
          ) : (
            <button data-term={t.id} title="Double-click to rename" onClick={() => pick(t.id)} onDoubleClick={() => setRenaming(t.id)}>{t.name}</button>
          )}
          {terms.length > 1 && <button className="tx" data-kill={t.id} aria-label={`Close ${t.name}`} onClick={async () => { await bridge().term.close(t.id); reload() }}>×</button>}
        </div>
      ))}
    </>
  )
}

function TermView({ terms, cur }: { forkId: string; terms: TerminalInfo[]; cur: string | null }) {
  const t = terms.find((x) => x.id === cur) ?? terms[0]
  if (!t) return <div className="hint">Starting a terminal…</div>
  return <Xterm key={t.id} attach={async (c, r) => ({ id: t.id, buffer: await bridge().term.attach(t.id, c, r) })} />
}

/* ---------- git ---------- */

function GitList({ commits, ahead, changes, cur, pick, onPull, onPush, onCommit }: {
  commits: Commit[]; ahead: number; changes: number; cur: string | null; pick: (h: string) => void
  onPull: () => void; onPush: () => void; onCommit: () => void
}) {
  const sel = commits.some((c) => c.hash === cur) ? cur : commits[0]?.hash
  return (
    <>
      <div className="gitacts">
        <button className="gbtn" id="gPull" title="Pull from origin" onClick={onPull}>↓ Pull</button>
        <button className="gbtn" id="gPush" title="Push to origin" onClick={onPush}>↑ Push{ahead > 0 && <> <b>{ahead}</b></>}</button>
        <button className="gbtn" id="gCommit" title="Commit changes" disabled={!changes} onClick={onCommit}>✓ Commit{changes > 0 && <> <b>{changes}</b></>}</button>
      </div>
      <h4>History</h4>
      {commits.map((c) => (
        <button key={c.hash} className="fi cmt" data-commit={c.short} aria-current={c.hash === sel} onClick={() => pick(c.hash)}>
          <span className="ch">{c.short}</span><span className="cmsg">{c.subject}</span>{!c.pushed && <span className="np" title="Not pushed">●</span>}
        </button>
      ))}
    </>
  )
}

function CommitView({ forkId, commits, cur }: { forkId: string; commits: Commit[]; cur: string | null }) {
  const c = commits.find((x) => x.hash === cur) ?? commits[0]
  const [files, setFiles] = useState<{ path: string; add: number; del: number; ops: DiffOp[] }[] | null>(null)
  useEffect(() => { setFiles(null); if (c) svc.commitDetail(forkId, c.hash).then(setFiles) }, [forkId, c?.hash]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <div className="hint">No commits yet.</div>
  const add = files?.reduce((a, f) => a + f.add, 0) ?? 0
  const del = files?.reduce((a, f) => a + f.del, 0) ?? 0
  return (
    <div className="mbody">
      <div className="chead"><div className="t">{c.subject}</div>
        <div className="h"><span className="mono">{c.short}</span> · {c.author} · {c.when} · {c.pushed ? 'pushed' : <span className="np">not pushed</span>} · <span className="plusn" style={{ color: 'var(--add)' }}>+{add}</span> <span style={{ color: 'var(--del)' }}>−{del}</span></div></div>
      {files?.map((f) => (
        <div key={f.path}>
          <div className="mhead"><span className="p">{f.path}</span><span className="plusn">+{f.add}</span><span className="minusn">−{f.del}</span></div>
          <DiffView ops={f.ops} />
        </div>
      ))}
    </div>
  )
}
