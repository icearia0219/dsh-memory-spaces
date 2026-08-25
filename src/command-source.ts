/** Durable command-origin checks shared by public and browser-only command handlers. */

import type { CommandInvocation } from '@deepseek-ai/dsh-commands'

const MAX_REPLAY_RESULTS = 2_048

/** Process-lifetime result cache preventing one durable command id from executing twice. */
export class CommandReplayGuard {
  private readonly results = new Map<string, unknown>()

  /** Return the first result for one Session command id, including an in-flight async result. */
  run<T>(invocation: CommandInvocation, operation: () => T): T {
    const key = `${invocation.agent.id}\u0000${invocation.commandId}`
    if (this.results.has(key)) return this.results.get(key) as T
    const result = operation()
    if (result instanceof Promise) {
      const guarded = result.catch((error: unknown) => {
        this.results.delete(key)
        throw error
      })
      this.store(key, guarded)
      return guarded as T
    }
    this.store(key, result)
    return result
  }

  /** Forget cached outcomes when the owning plugin context is disposed. */
  clear(): void {
    this.results.clear()
  }

  private store(key: string, value: unknown): void {
    this.results.set(key, value)
    if (this.results.size <= MAX_REPLAY_RESULTS) return
    const oldest = this.results.keys().next().value as string | undefined
    if (oldest !== undefined) this.results.delete(oldest)
  }
}

/**
 * Return the durable sequence only when the addressed command event exists and has a direct-user source.
 * @param invocation - command id and current Session log.
 * @returns the durable event sequence, or `undefined` for missing or non-user origins.
 */
export function directUserCommandSeq(invocation: CommandInvocation): number | undefined {
  const event = invocation.agent.session.events.findLast(candidate => (
    candidate.type === 'command/run'
    && candidate.data.commandId === invocation.commandId
  ))
  if (event === undefined) return
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null
    || !('source' in data)
    || typeof data.source !== 'object' || data.source === null
    || !('kind' in data.source) || data.source.kind !== 'user') return
  return event.seq
}
