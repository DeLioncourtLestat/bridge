import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent, ChatMessage, Commit, DiffOp, FileChange, Fork, Instruction, Note, Ref, Settings, Task, TerminalInfo } from '../../../shared/types'
import { chatParts } from '../../../shared/markdown'
import { bridge, svc } from '../api'
import { chatMd, onMdClick } from '../chatMarkdown'
import { OPEN_FILE_EVENT } from '../settings'
import { DiffView, Icon, PRIO, useOutside, useUi } from '../ui'
import { CodeEditor } from './CodeEditor'
import { CommitModal } from './CommitModal'
import { DocEditor } from './Docs'
import { INSTR_PLACEHOLDER } from './InstructionsView'
import { Xterm } from './Xterm'

type View = 'chat' | 'changes' | 'files' | 'term' | 'git' | 'instr'
type ForkUi = { view: View; file: string | null; change: string | null; commit: string | null; term: string | null; dirs: string[]; instr: string | null }
const LABEL: Record<View, string> = { chat: 'Chat', changes: 'Changes', files: 'Explorer', term: 'Terminal', git: 'Git', instr: 'Instructions' }

type Props = {
  fork: Fork
  tasks: Task[]
  notes: Note[]
  instructions: Instruction[]
  reloadInstructions: () => Promise<void>
  settings: Settings
  onForkChanged: () => void
  onTasksChanged: () => void
}

export function ForkView({ fork, tasks, notes, instructions, reloadInstructions, settings, onForkChanged, onTasksChanged }: Props) {
  const { fail, toast } = useUi()
  const [fu, setFu] = useState<ForkUi>({ view: 'chat', file: null, change: null, commit: null, term: null, dirs: [], instr: null })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [changes, setChanges] = useState<FileChange[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [terms, setTerms] = useState<TerminalInfo[] | null>(null) // null until loaded
  const [commitOpen, setCommitOpen] = useState(false)
  const [reveal, setReveal] = useState<{ line: number; n: number } | null>(null)
  const [own, setOwn] = useState<Instruction[]>([])
  const [freshInstr, setFreshInstr] = useState<string | null>(null) // just created: opens in edit mode
  const reloadOwn = useCallback(async () => setOwn(await svc.listForkInstructions(fork.id)), [fork.id])
  useEffect(() => { reloadOwn() }, [reloadOwn])
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

  // search opens a file here, at a line
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ forkId: string; file: string; line?: number }>).detail
      if (d.forkId !== fork.id) return
      setUi({ view: 'files', file: d.file })
      setReveal(d.line ? { line: d.line, n: Date.now() } : null)
      refreshGit()
    }
    window.addEventListener(OPEN_FILE_EVENT, h)
    return () => window.removeEventListener(OPEN_FILE_EVENT, h)
  }, [fork.id, setUi, refreshGit])

  const ahead = commits.filter((c) => !c.pushed).length
  const running = fork.state === 'run'

  const dot = (v: View) => (v === 'changes' && changes.length) || (v === 'git' && ahead) ? <span className="cdot" /> : null

  return (
    <div className={`ws${fu.view === 'chat' ? ' nolp' : ''}`}>
      {fu.view !== 'chat' && (
        <aside className="lp">
          <div className="llist">
            {fu.view === 'changes' && <ChangeList changes={changes} cur={fu.change} pick={(p) => setUi({ change: p })} />}
            {fu.view === 'files' && <FileTree files={files} changes={changes} cur={fu.file} pick={(p) => { setReveal(null); setUi({ file: p }) }} dirs={fu.dirs ?? []} setDirs={(dirs) => setUi({ dirs })} />}
            {fu.view === 'term' && terms && <TermList forkId={fork.id} terms={terms} cur={fu.term} pick={(id) => setUi({ term: id })} reload={reloadTerms} />}
            {fu.view === 'instr' && (
              <InstrList fork={fork} project={instructions} own={own} cur={fu.instr} pick={(k) => setUi({ instr: k })}
                toggle={async (id, on) => { await svc.setInstructionOn(fork.id, id, on); onForkChanged() }}
                add={async () => { const i = await svc.createInstruction(fork.projectId, { forkId: fork.id }); await reloadOwn(); setFreshInstr(`f:${i.id}`); setUi({ instr: `f:${i.id}` }) }} />
            )}
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
      )}
      <section className="main">
        {fu.view === 'chat' && <Chat fork={fork} messages={messages} setMessages={setMessages} tasks={tasks} notes={notes} running={running} onSent={() => { onForkChanged(); onTasksChanged() }} />}
        {fu.view === 'changes' && <ChangeDiff forkId={fork.id} changes={changes} cur={fu.change} openInExplorer={(p) => setUi({ view: 'files', file: p })} />}
        {fu.view === 'files' && <Explorer forkId={fork.id} files={files} cur={fu.file} settings={settings} onSaved={refreshGit} reveal={reveal} />}
        {fu.view === 'term' && terms && <TermView forkId={fork.id} terms={terms} cur={fu.term} />}
        {fu.view === 'git' && <CommitView forkId={fork.id} commits={commits} cur={fu.commit} />}
        {fu.view === 'instr' && (
          <InstrPane fork={fork} project={instructions} own={own} cur={fu.instr} fresh={freshInstr}
            saved={async (scope) => { if (scope === 'p') await reloadInstructions(); else await reloadOwn() }}
            removed={() => setUi({ instr: null })}
            toggle={async (id, on) => { await svc.setInstructionOn(fork.id, id, on); onForkChanged() }} />
        )}
      </section>
      <footer className="sbar">
        <div className="branch" title={`${fork.branch}\n${fork.path}`}>
          <span className="bi-ic">{Icon.git}</span><span className="b">{fork.branch}</span>
          {fork.ghost ? <span className="kind ghost">{Icon.ghost}Ghost · shared project folder</span> : <span className="kind">Fork</span>}
        </div>
        <div className="itabs" role="tablist" aria-label="Fork views">
          {(Object.keys(LABEL) as View[]).map((v) => (
            <button key={v} className="itab" data-v={v} aria-current={fu.view === v} title={LABEL[v]} onClick={() => setUi({ view: v })}>
              {Icon[v]}<span>{LABEL[v]}</span>
              {dot(v)}
            </button>
          ))}
        </div>
        <div className="sbr">{running && fu.view !== 'chat' && <span className="working"><i />Agent is working…</span>}</div>
      </footer>
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

/* ---------- instructions ---------- */

/** Left column: the project's instructions with an on/off switch for this fork, then the fork's own. */
function InstrList({ fork, project, own, cur, pick, toggle, add }: {
  fork: Fork; project: Instruction[]; own: Instruction[]; cur: string | null
  pick: (k: string) => void; toggle: (id: number, on: boolean) => void; add: () => void
}) {
  const sel = cur ?? (project[0] ? `p:${project[0].id}` : own[0] ? `f:${own[0].id}` : null)
  const on = (id: number) => !fork.instrOff.includes(id)
  return (
    <>
      <h4>Project</h4>
      {project.length ? project.map((i) => (
        <div key={i.id} className={`fi instr${on(i.id) ? '' : ' off'}`} aria-current={sel === `p:${i.id}`}>
          <button className="tog sm" role="switch" aria-checked={on(i.id)} data-instr-on={i.id} aria-label={`Use “${i.title || 'Untitled'}” in this ${fork.ghost ? 'ghost' : 'fork'}`} onClick={() => toggle(i.id, !on(i.id))} />
          <button className="it" data-pinstr={i.id} onClick={() => pick(`p:${i.id}`)}>{i.title || 'Untitled'}</button>
        </div>
      )) : <div className="hint" style={{ padding: '4px 8px 8px' }}>None yet. Add them in the Instructions tab at the top.</div>}
      <div className="lhead"><h4>Only this {fork.ghost ? 'ghost' : 'fork'}</h4><button className="mini" id="addForkInstr" title="New instruction for this fork" aria-label="New instruction for this fork" onClick={add}>+</button></div>
      {own.length ? own.map((i) => (
        <button key={i.id} className="fi instr" data-finstr={i.id} aria-current={sel === `f:${i.id}`} onClick={() => pick(`f:${i.id}`)}>
          <span className="it">{i.title || 'Untitled'}</span>
        </button>
      )) : <div className="hint" style={{ padding: '4px 8px' }}>Press + to add one just for here.</div>}
    </>
  )
}

function InstrPane({ fork, project, own, cur, fresh, saved, removed, toggle }: {
  fork: Fork; project: Instruction[]; own: Instruction[]; cur: string | null; fresh: string | null
  saved: (scope: 'p' | 'f') => Promise<void>; removed: () => void; toggle: (id: number, on: boolean) => void
}) {
  const { confirm, fail } = useUi()
  const key = cur ?? (project[0] ? `p:${project[0].id}` : own[0] ? `f:${own[0].id}` : null)
  const [scope, idStr] = (key ?? ':').split(':') as ['p' | 'f', string]
  const doc = (scope === 'p' ? project : own).find((i) => i.id === Number(idStr))
  if (!doc) return <div className="empty"><b>Instructions</b>The agent always follows the project’s instructions and the ones you add here. Switch project ones off on the left for this {fork.ghost ? 'ghost' : 'fork'} only.</div>
  const on = !fork.instrOff.includes(doc.id)
  const banner = scope === 'p' ? (
    <div className="ibanner">
      <span>{on ? 'Project instruction · editing it changes it for every fork' : 'Project instruction · switched off for this ' + (fork.ghost ? 'ghost' : 'fork')}</span>
      <button className="btn" id="instrToggle" onClick={() => toggle(doc.id, !on)}>{on ? `Turn off here` : 'Turn on here'}</button>
    </div>
  ) : <div className="ibanner"><span>Only for this {fork.ghost ? 'ghost' : 'fork'}</span></div>
  return (
    <DocEditor key={key} doc={doc} kind="instr" placeholder={INSTR_PLACEHOLDER} banner={banner} autoEdit={fresh === key}
      onSave={(d) => { svc.updateInstruction(d.id, { title: d.title, body: d.body }).then(() => saved(scope), fail) }}
      onRemove={async () => {
        if (!(await confirm({ title: 'Delete instruction?', text: `“${doc.title || 'Untitled'}” will be removed${scope === 'p' ? ' from the whole project' : ''}. This can’t be undone.` }))) return
        await svc.removeInstruction(doc.id)
        await saved(scope)
        removed()
      }} />
  )
}

/* ---------- chat ---------- */

/** Markdown chunk; re-parsed only when its text changes (replies stream in). */
function Md({ text }: { text: string }) {
  const html = useMemo(() => chatMd(text), [text])
  return <div className="mdc body" onClick={onMdClick} dangerouslySetInnerHTML={{ __html: html }} />
}

/** "Read src/a.ts" → verb + target, the way Claude Code lists its steps. */
function ToolRow({ t }: { t: string }) {
  const m = t.match(/^(\S+)\s+(.*)$/)
  return <div className="trow"><i />{m ? <><b>{m[1]}</b> <span>{m[2]}</span></> : <b>{t}</b>}</div>
}

function Tools({ tools, live }: { tools: string[]; live: boolean }) {
  if (tools.length <= 3) return <div className="tools">{tools.map((t, k) => <ToolRow key={k} t={t} />)}</div>
  return (
    <details className="tools" open={live || undefined}>
      <summary>{tools.length} steps<span>{tools[tools.length - 1]}</span></summary>
      {tools.map((t, k) => <ToolRow key={k} t={t} />)}
    </details>
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
  // follow a streaming reply unless the user scrolled up to read
  const last = messages[messages.length - 1]
  const lastSig = last ? last.text.length + last.tools.length : 0
  useEffect(() => {
    const b = boxRef.current
    if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 120) b.scrollTo({ top: b.scrollHeight })
  }, [lastSig])
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
            <div key={m.id} className="msg ai" id={`msg-${i}`} data-i={i}>
              {chatParts(m.text, m.tools, m.marks ?? []).map((p, k) =>
                p.kind === 'text' ? <Md key={k} text={p.text} /> : <Tools key={k} tools={p.tools} live={running && i === messages.length - 1} />,
              )}
            </div>
          ),
        ) : (
          fork.ghost
            ? <div className="empty-chat"><b>New ghost</b>Pick a task or describe what to do. This agent works directly in the project folder on <span className="mono">{fork.branch}</span>, next to you and any other ghosts.</div>
            : <div className="empty-chat"><b>New fork</b>Pick a task or describe what to do. Add notes as references for extra context. The agent works in this fork’s own folder and never touches main.</div>
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
      <div className="mbody"><DiffView ops={ops} path={c.path} /></div>
    </>
  )
}

/* ---------- explorer ---------- */

/** Folders start collapsed; the ones you open are remembered per fork. The open file's folders unfold on their own. */
function FileTree({ files, changes, cur, pick, dirs, setDirs }: {
  files: string[]; changes: FileChange[]; cur: string | null; pick: (p: string) => void; dirs: string[]; setDirs: (d: string[]) => void
}) {
  const kinds = useMemo(() => Object.fromEntries(changes.map((c) => [c.path, c.kind])), [changes])
  const open = useMemo(() => new Set(dirs), [dirs])
  // folders that hold a changed file, so a collapsed folder still shows there's something inside
  const changedDirs = useMemo(() => {
    const out = new Set<string>()
    for (const c of changes) { const parts = c.path.split('/'); for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/')) }
    return out
  }, [changes])
  useEffect(() => {
    if (!cur) return
    const parts = cur.split('/')
    const need = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')).filter((d) => !open.has(d))
    if (need.length) setDirs([...dirs, ...need])
  }, [cur]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const out: { dir?: boolean; name: string; path: string; depth: number }[] = []
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
      let visible = true
      for (let i = 0; i < parts.length - 1 && visible; i++) {
        const d = parts.slice(0, i + 1).join('/')
        if (!seen.has(d)) { seen.add(d); out.push({ dir: true, name: parts[i], path: d, depth: i }) }
        visible = open.has(d)
      }
      if (visible) out.push({ name: parts[parts.length - 1], path: p, depth: parts.length - 1 })
    }
    return out
  }, [files, open])

  const toggle = (d: string) => setDirs(open.has(d) ? dirs.filter((x) => x !== d && !x.startsWith(d + '/')) : [...dirs, d])
  return (
    <>
      <div className="lhead"><h4>Files</h4>{dirs.length > 0 && <button className="mini" id="collapseAll" title="Collapse all" aria-label="Collapse all" onClick={() => setDirs([])}>−</button>}</div>
      {rows.map((r) => r.dir ? (
        <button key={'d:' + r.path} className="fi dir" data-dir={r.path} aria-expanded={open.has(r.path)} style={{ '--d': `${r.depth * 12}px` } as React.CSSProperties} onClick={() => toggle(r.path)}>
          <span className="tw" />{r.name}{!open.has(r.path) && changedDirs.has(r.path) && <span className="ddot" title="Has changes" />}
        </button>
      ) : (
        <button key={r.path} className="fi file" data-file={r.path} aria-current={r.path === cur} style={{ '--d': `${r.depth * 12}px` } as React.CSSProperties} onClick={() => pick(r.path)}>
          {r.name}{kinds[r.path] && <span className={`st ${kinds[r.path] === 'A' ? 'a' : 'm'}`}>{kinds[r.path]}</span>}
        </button>
      ))}
    </>
  )
}

function Explorer({ forkId, files, cur, settings, onSaved, reveal }: { forkId: string; files: string[]; cur: string | null; settings: Settings; onSaved: () => void; reveal: { line: number; n: number } | null }) {
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
        reveal={reveal}
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
          <DiffView ops={f.ops} path={f.path} />
        </div>
      ))}
    </div>
  )
}
