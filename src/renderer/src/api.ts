import type { BridgeApi } from '../../preload'
import type { Service } from '../../main/service'

declare global {
  interface Window { bridge: BridgeApi }
}

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }

/** Typed calls into the main-process service: `svc.listTasks(pid)`. */
export const svc = new Proxy({} as Async<Omit<Service, 'agents'>>, {
  get: (_t, method: string) => (...args: unknown[]) => window.bridge.call(method, ...args),
})

export const bridge = () => window.bridge
