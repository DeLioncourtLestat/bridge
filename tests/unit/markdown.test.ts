import { describe, expect, it } from 'vitest'
import { chatParts, mdRender, mdSnippet, toggleCheckbox } from '../../src/shared/markdown'

describe('markdown', () => {
  it('renders headings, emphasis, code, links', () => {
    const h = mdRender('# Title\n## Sub\nSome **bold**, *italic*, ~~gone~~ and `code`.\n[Docs](https://example.com)')
    expect(h).toContain('<h2>Title</h2>')
    expect(h).toContain('<h3>Sub</h3>')
    expect(h).toContain('<strong>bold</strong>')
    expect(h).toContain('<em>italic</em>')
    expect(h).toContain('<del>gone</del>')
    expect(h).toContain('<code>code</code>')
    expect(h).toContain('<a href="https://example.com" target="_blank" rel="noopener">Docs</a>')
  })
  it('renders lists, numbered lists, quotes, rules and code blocks', () => {
    const h = mdRender('- a\n- b\n\n1. one\n2. two\n\n> quoted\n\n---\n```\n<b>x</b>\n```')
    expect(h).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(h).toContain('<ol><li>one</li><li>two</li></ol>')
    expect(h).toContain('<blockquote>quoted</blockquote>')
    expect(h).toContain('<hr>')
    expect(h).toContain('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>')
  })
  it('renders checklists with their source line', () => {
    const h = mdRender('intro\n- [ ] todo\n- [x] done')
    expect(h).toContain('data-line="1" aria-pressed="false"')
    expect(h).toContain('<li class="done"><button class="cb" data-line="2" aria-pressed="true"')
  })
  it('escapes html so notes cannot inject markup', () => {
    const h = mdRender('<img src=x onerror=alert(1)> **<script>**')
    expect(h).not.toContain('<img')
    expect(h).not.toContain('<script>')
    expect(h).toContain('&lt;img')
    expect(mdRender('[x](javascript:alert(1))')).not.toContain('href="javascript')
  })
  it('makes list snippets without markdown symbols', () => {
    expect(mdSnippet('## Storage\n- x')).toBe('Storage')
    expect(mdSnippet('- [x] **Ship** it')).toBe('Ship it')
    expect(mdSnippet('\n\n> see [docs](https://a.b) and `code`')).toBe('see docs and code')
    expect(mdSnippet('')).toBe('')
  })
  it('toggles a checkbox line', () => {
    expect(toggleCheckbox('a\n- [ ] b\n- [x] c', 1)).toBe('a\n- [x] b\n- [x] c')
    expect(toggleCheckbox('a\n- [ ] b\n- [x] c', 2)).toBe('a\n- [ ] b\n- [ ] c')
  })
})

describe('chatParts', () => {
  it('puts tools between the paragraphs they were called after', () => {
    const text = 'Looking.\n\nFixed it.'
    expect(chatParts(text, ['Read a.ts', 'Edited a.ts'], [8, 8])).toEqual([
      { kind: 'text', text: 'Looking.' },
      { kind: 'tools', tools: ['Read a.ts', 'Edited a.ts'] },
      { kind: 'text', text: 'Fixed it.' },
    ])
  })
  it('shows tools first for messages without marks', () => {
    expect(chatParts('Done', ['Read a.ts'], [])).toEqual([{ kind: 'tools', tools: ['Read a.ts'] }, { kind: 'text', text: 'Done' }])
  })
})

describe('keymap and fuzzy search', () => {
  it('formats and records shortcuts', async () => {
    const { formatShortcut, shortcutFromEvent, shortcut } = await import('../../src/shared/keymap')
    expect(formatShortcut('CmdOrCtrl+Shift+F', true)).toBe('⌘⇧F')
    expect(formatShortcut('CmdOrCtrl+Shift+F', false)).toBe('Ctrl+Shift+F')
    const ev = { code: 'KeyO', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }
    expect(shortcutFromEvent(ev, true)).toBe('CmdOrCtrl+Shift+O')
    expect(shortcutFromEvent({ ...ev, metaKey: false, shiftKey: false }, true)).toBeNull() // plain typing
    expect(shortcutFromEvent({ ...ev, code: 'ShiftLeft' }, true)).toBeNull()
    expect(shortcut({}, 'go-to-file')).toBe('CmdOrCtrl+Shift+O')
    expect(shortcut({ 'go-to-file': '' }, 'go-to-file')).toBe('')
  })
  it('ranks file name matches first', async () => {
    const { fuzzy } = await import('../../src/shared/util')
    const files = ['src/lib/util.ts', 'src/ui.tsx', 'tests/unit/tmp.ts']
    const rank = (q: string) => files.map((f) => [f, fuzzy(f, q)] as const).filter((x) => x[1] !== null).sort((a, b) => b[1]! - a[1]!).map((x) => x[0])
    expect(rank('utl')).toEqual(['src/lib/util.ts'])
    expect(rank('ui')[0]).toBe('src/ui.tsx')
    expect(fuzzy('src/app.ts', 'zz')).toBeNull()
  })
})
