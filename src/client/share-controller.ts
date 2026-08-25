/** Shared browser state for plugin-owned dialogs and message selection. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export interface SelectedSession {
  readonly sessionId: SessionId
  readonly title: string
}

export interface SelectedMessage {
  readonly seq: number
  readonly text: string
}

export interface ShareDialogSeed {
  readonly kind: 'manage' | 'connect' | 'snapshot'
  readonly sessions: readonly SelectedSession[]
  readonly spaceName?: string
  readonly createNew?: boolean
}

export interface MemoryShareState {
  readonly sidebarSessions: Readonly<Record<string, SelectedSession>>
  readonly sessions: Readonly<Record<string, SelectedSession>>
  readonly messages: Readonly<Record<string, Readonly<Record<number, SelectedMessage>>>>
  readonly dialog: ShareDialogSeed | null
}

const INITIAL_STATE: MemoryShareState = {
  sidebarSessions: {},
  sessions: {},
  messages: {},
  dialog: null,
}

/** One observable selection model shared by every memory-spaces UI contribution. */
export class MemoryShareController {
  private state: MemoryShareState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): MemoryShareState => this.state

  toggleMessage(session: SelectedSession, message: SelectedMessage): void {
    const current = { ...this.state.messages[session.sessionId] }
    if (current[message.seq] === undefined) current[message.seq] = message
    else delete current[message.seq]
    const messages = { ...this.state.messages }
    if (Object.keys(current).length === 0) delete messages[session.sessionId]
    else messages[session.sessionId] = current
    this.commit({
      ...this.state,
      sessions: { ...this.state.sessions, [session.sessionId]: session },
      messages,
    })
  }

  toggleSession(session: SelectedSession): void {
    const sidebarSessions = { ...this.state.sidebarSessions }
    if (sidebarSessions[session.sessionId] === undefined) sidebarSessions[session.sessionId] = session
    else delete sidebarSessions[session.sessionId]
    this.commit({ ...this.state, sidebarSessions })
  }

  openNewSpaceFromSelection(): void {
    const sessions = Object.values(this.state.sidebarSessions)
    if (sessions.length < 2) return
    this.commit({
      ...this.state,
      dialog: { kind: 'connect', sessions, createNew: true },
    })
  }

  open(session: SelectedSession): void {
    this.commit({ ...this.state, dialog: { kind: 'manage', sessions: [session] } })
  }

  openConnect(governingSession: SelectedSession, spaceName?: string): void {
    this.commit({
      ...this.state,
      dialog: {
        kind: 'connect',
        sessions: [governingSession],
        ...(spaceName === undefined ? {} : { spaceName }),
      },
    })
  }

  openSnapshot(session: SelectedSession): void {
    this.commit({
      ...this.state,
      sessions: { [session.sessionId]: session },
      messages: {},
      dialog: { kind: 'snapshot', sessions: [session] },
    })
  }

  close(): void {
    this.commit({ ...this.state, dialog: null })
  }

  clear(): void {
    this.commit(INITIAL_STATE)
  }

  private commit(state: MemoryShareState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
