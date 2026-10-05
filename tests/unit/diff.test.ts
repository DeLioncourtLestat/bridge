import { describe, expect, it } from 'vitest'
import { changedLines, diffStats, lineDiff } from '../../src/shared/diff'

describe('lineDiff', () => {
  it('finds added, removed and kept lines with numbers', () => {
    const ops = lineDiff('a\nb\nc', 'a\nB\nc\nd')
    expect(ops.map((o) => o.t + o.s)).toEqual([' a', '+B', '-b', ' c', '+d'])
    expect(ops.find((o) => o.s === 'd')!.b).toBe(4)
    expect(diffStats(ops)).toEqual({ add: 2, del: 1 })
  })
  it('handles new and deleted files', () => {
    expect(diffStats(lineDiff(null, 'x\ny'))).toEqual({ add: 2, del: 0 })
    expect(diffStats(lineDiff('x\ny', null))).toEqual({ add: 0, del: 2 })
  })
  it('treats a final newline as the end of the last line', () => {
    expect(diffStats(lineDiff(null, 'a\nb\n'))).toEqual({ add: 2, del: 0 })
    expect(lineDiff('a\n', 'a\n')).toEqual([{ t: ' ', s: 'a', a: 1, b: 1 }])
  })
  it('lists changed lines of the new text', () => {
    expect([...changedLines('a\nb\nc', 'a\nX\nc\nY')]).toEqual([2, 4])
    expect(changedLines('same', 'same').size).toBe(0)
  })
})
