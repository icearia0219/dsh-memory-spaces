/** Session event reads across the legacy array and current accessor APIs. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

interface CompatibleSessionEvents {
  readonly events?: readonly SessionEvent[]
  eventAt?: (seq: number) => SessionEvent | undefined
  snapshotEvents?: () => readonly SessionEvent[]
}

/**
 * Read one durable event without exposing a mutable Session log.
 * @param session - DSH Session from a supported release.
 * @param seq - exact event sequence number.
 * @returns the durable event, or `undefined` when absent.
 */
export function readSessionEvent(session: Session, seq: number): SessionEvent | undefined {
  const compatible = session as unknown as CompatibleSessionEvents
  return typeof compatible.eventAt === 'function'
    ? compatible.eventAt(seq)
    : compatible.events?.[seq]
}

/**
 * Read a stable snapshot of the complete durable event log.
 * @param session - DSH Session from a supported release.
 * @returns current immutable events, or an empty snapshot when the release exposes neither supported API.
 */
export function snapshotSessionEvents(session: Session): readonly SessionEvent[] {
  const compatible = session as unknown as CompatibleSessionEvents
  return typeof compatible.snapshotEvents === 'function'
    ? compatible.snapshotEvents()
    : compatible.events ?? []
}
