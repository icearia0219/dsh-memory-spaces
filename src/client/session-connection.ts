/** Direct, user-approved connection of local Sessions as memory sources or consumers. */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { MemoryUseMode } from '../types.ts'
import { executeMemoryUi } from './memory-ui-client.ts'
import type { SelectedSession } from './share-controller.ts'

interface ConnectSelectedSessionsBase {
  readonly sessions: readonly SelectedSession[]
  readonly spaceName: string
}

/** Parameters for connecting selected local Sessions without a team or bearer invitation. */
export type ConnectSelectedSessionsInput = ConnectSelectedSessionsBase & (
  | { readonly relation: 'source'; readonly importHistory: boolean }
  | { readonly relation: 'consumer'; readonly mode: MemoryUseMode }
)

/**
 * Connect every selected target through the governing Session's private UI operation.
 * @param remote - command transport able to address selected Sessions.
 * @param input - governing Session first, selected targets, space, and relationship choice.
 */
export async function connectSelectedSessions(
  remote: ClientRemote,
  input: ConnectSelectedSessionsInput,
): Promise<void> {
  const owner = input.sessions[0]
  if (owner === undefined) throw new Error('请至少选择两个会话。')
  const recipients = distinctRecipients(owner.sessionId, input.sessions.slice(1))
  if (recipients.length === 0) throw new Error('请至少选择两个不同的会话。')
  if (input.relation === 'consumer') {
    for (const recipient of recipients) {
      await executeMemoryUi(remote, owner.sessionId, 'add-consumer', {
        spaceName: input.spaceName,
        targetSessionId: recipient.sessionId,
        mode: input.mode,
      })
    }
    return
  }
  for (const recipient of recipients) {
    await executeMemoryUi(remote, owner.sessionId, 'add-source', {
      spaceName: input.spaceName,
      targetSessionId: recipient.sessionId,
    })
  }
  if (!input.importHistory) return
  for (const session of recipients) {
    await executeMemoryUi(remote, session.sessionId, 'import-history', {
      spaceName: input.spaceName,
      sourceSessionTitle: session.title,
    })
  }
}

function distinctRecipients(
  ownerSessionId: SelectedSession['sessionId'],
  sessions: readonly SelectedSession[],
): SelectedSession[] {
  const seen = new Set<string>([ownerSessionId])
  return sessions.filter((session) => {
    if (seen.has(session.sessionId)) return false
    seen.add(session.sessionId)
    return true
  })
}
