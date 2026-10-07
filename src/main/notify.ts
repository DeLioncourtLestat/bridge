import type { Repo } from './db'

/** What the "agent finished" notification says, or null when the fork is gone. */
export function doneNotice(repo: Repo, forkId: string, error?: string): { title: string; body: string; projectId: string } | null {
  const f = repo.getFork(forkId)
  if (!f) return null
  const p = repo.getProject(f.projectId)
  const last = [...repo.listMessages(forkId)].reverse().find((m) => m.role === 'agent' && m.text.trim())
  // markdown → one line of text: drop code blocks, link targets, line markers and emphasis, keep words like AGENT_WORK.md
  const plain = (s: string) =>
    s.replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const snippet = last ? plain(last.text) : ''
  return {
    title: `${f.ghost ? 'Ghost' : 'Fork'} “${f.title}”${p ? ` · ${p.name}` : ''}`,
    body: error ? `Failed: ${error.split('\n')[0].slice(0, 160)}` : snippet ? (snippet.length > 160 ? snippet.slice(0, 159) + '…' : snippet) : 'The agent finished.',
    projectId: f.projectId,
  }
}

/** Forks whose agent finished and nobody has looked yet, across all projects. */
export const unseenCount = (repo: Repo) => repo.listProjects().reduce((n, p) => n + repo.listForks(p.id).filter((f) => f.state === 'wait').length, 0)
