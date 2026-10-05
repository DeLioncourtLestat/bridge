import { useEffect, useRef } from 'react'

/** Debounced saver that flushes on unmount, so nothing typed is lost when switching away. */
export function useSaver<T>(save: (value: T) => void, delay = 350) {
  const pending = useRef<T | null>(null)
  const timer = useRef<number>(0)
  const saveRef = useRef(save)
  saveRef.current = save
  const flush = () => {
    clearTimeout(timer.current)
    if (pending.current !== null) {
      const v = pending.current
      pending.current = null
      saveRef.current(v)
    }
  }
  useEffect(() => flush, [])
  return {
    push(value: T) {
      pending.current = value
      clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, delay)
    },
    flush,
  }
}
