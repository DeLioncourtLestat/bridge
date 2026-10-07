import { describe, expect, it } from 'vitest'
import { highlightLines } from '../../src/renderer/src/syntax'

const cls = (html: string, word: string) => html.match(new RegExp(`<span class="([^"]+)">${word.replace(/[$()]/g, '\\$&')}</span>`))?.[1]

describe('syntax highlighting', () => {
  it('gives functions, variables, properties, types, strings and comments their own classes', () => {
    const [c, , fnLine, callLine, cls1, method] = highlightLines('a.ts', [
      '// hi',
      '',
      'function greet(name: string) { return name }',
      'const user = load(id); user.save(); user.name',
      'class Greeter {}',
      'class A { run() {} }',
    ])
    expect(c).toBe('<span class="sx-com">// hi</span>')
    expect(cls(fnLine, 'greet')).toBe('sx-fnd')
    expect(cls(fnLine, 'function')).toBe('sx-kw')
    expect(cls(fnLine, 'return')).toBe('sx-ctl')
    expect(cls(fnLine, 'string')).toBe('sx-type')
    expect(cls(callLine, 'load')).toBe('sx-fn')
    expect(cls(callLine, 'user')).toBe('sx-def')
    expect(cls(callLine, 'id')).toBe('sx-var')
    expect(cls(callLine, 'save')).toBe('sx-fn')
    expect(cls(callLine, 'name')).toBe('sx-prop')
    expect(cls(cls1, 'Greeter')).toBe('sx-type')
    expect(cls(method, 'run')).toBe('sx-fnd')
  })
  it('keeps multi-line comments and strings colored on every line', () => {
    const out = highlightLines('a.js', ['/* one', 'two */ const x = 1'])
    expect(out[0]).toBe('<span class="sx-com">/* one</span>')
    expect(out[1]).toMatch(/^<span class="sx-com">two \*\/<\/span>/)
  })
  it('colors Ruby and leaves unknown files as escaped text', () => {
    const [rb] = highlightLines('app.rb', ['def hello # greet'])
    expect(cls(rb, 'def')).toBe('sx-kw')
    expect(rb).toContain('sx-com')
    expect(highlightLines('notes.unknownext', ['<b>'])).toEqual(['&lt;b&gt;'])
  })
})
