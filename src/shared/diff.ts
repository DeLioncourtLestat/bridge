import type { DiffOp } from './types'

/** Line diff via LCS. Fine for source files of a few thousand lines. */
/** Lines of a text; a final newline ends the last line rather than starting an empty one. */
const toLines = (s: string | null | undefined) => {
  if (!s) return []
  const l = s.split('\n')
  if (l[l.length - 1] === '') l.pop()
  return l
}

export function lineDiff(a: string | null | undefined, b: string | null | undefined): DiffOp[] {
  const A = toLines(a)
  const B = toLines(b)
  const n = A.length
  const m = B.length
  const L: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      ops.push({ t: ' ', s: B[j], a: i + 1, b: j + 1 })
      i++
      j++
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      ops.push({ t: '+', s: B[j], b: j + 1 })
      j++
    } else {
      ops.push({ t: '-', s: A[i], a: i + 1 })
      i++
    }
  }
  return ops
}

export const diffStats = (ops: DiffOp[]) => ({
  add: ops.filter((o) => o.t === '+').length,
  del: ops.filter((o) => o.t === '-').length,
})

/** Lines of `b` (1-based) that are new or changed compared to `a`. */
export function changedLines(a: string | null, b: string): Set<number> {
  return new Set(lineDiff(a, b).filter((o) => o.t === '+').map((o) => o.b!))
}
