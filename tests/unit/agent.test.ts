import { describe, expect, it } from 'vitest'
import { buildPrompt, parseStreamLine, toolSummary } from '../../src/main/agent'

describe('agent stream', () => {
  it('parses init, text, tool calls and the result', () => {
    expect(parseStreamLine('{"type":"system","subtype":"init","session_id":"abc"}')).toEqual([{ kind: 'session', sessionId: 'abc' }])
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Read', input: { file_path: '/w/a.ts' } }] } })))
      .toEqual([{ kind: 'text', text: 'hi' }, { kind: 'tool', name: 'Read', input: { file_path: '/w/a.ts' } }])
    expect(parseStreamLine('{"type":"result","is_error":true,"result":"boom"}')).toEqual([{ kind: 'result', isError: true, text: 'boom' }])
    expect(parseStreamLine('not json')).toEqual([])
    expect(parseStreamLine('{"type":"user"}')).toEqual([])
  })
  it('summarises tool calls relative to the fork folder', () => {
    expect(toolSummary('Read', { file_path: '/w/src/a.ts' }, '/w')).toBe('Read src/a.ts')
    expect(toolSummary('Edit', { file_path: '/w/a.ts' }, '/w')).toBe('Edited a.ts')
    expect(toolSummary('Write', { file_path: 'b.md' }, '/w')).toBe('Wrote b.md')
    expect(toolSummary('Bash', { command: 'npm run build\nnpm test' }, '/w')).toBe('Ran npm run build')
    expect(toolSummary('Grep', { pattern: 'TODO' }, '/w')).toBe('Searched “TODO”')
    expect(toolSummary('Mystery', {}, '/w')).toBe('Mystery')
  })
  it('puts attached tasks and notes before the request', () => {
    const p = buildPrompt('Do it', [{ id: 1, projectId: 'p', title: 'Export', description: 'JSON', status: 'open', priority: 'high', createdAt: 0 }], [{ id: 2, projectId: 'p', title: 'Decisions', body: 'Use SQLite', createdAt: 0 }])
    expect(p).toMatch(/^Context from the project:/)
    expect(p).toContain('Task: Export\nPriority: high. Status: open.\nJSON')
    expect(p).toContain('Note: Decisions\nUse SQLite')
    expect(p.endsWith('Do it')).toBe(true)
    expect(buildPrompt('  ', [], [])).toBe('Work on the attached task.')
    expect(buildPrompt('Go', [], [], true)).toMatch(/^Note: you work directly in the main project folder.*\n\nGo$/s)
  })
  it('reads Bridge tool calls like the built-in ones', () => {
    expect(toolSummary('mcp__bridge__create_task', { title: 'Add import' }, '/w')).toBe('Created task “Add import”')
    expect(toolSummary('mcp__bridge__update_task', { id: 4, status: 'done' }, '/w')).toBe('Completed task #4')
    expect(toolSummary('mcp__bridge__create_note', { title: 'Decision' }, '/w')).toBe('Saved note “Decision”')
    expect(toolSummary('mcp__other__x', {}, '/w')).toBe('mcp__other__x')
  })
})
