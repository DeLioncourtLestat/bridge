import { describe, expect, it } from 'vitest'
import { mdRender, mdSnippet, toggleCheckbox } from '../../src/shared/markdown'

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
