/** Public commands Remote compatibility across supported DSH release candidates. */

import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'

type CommandRemoteResult = Awaited<ReturnType<ClientRemote['commands']['execute']>>
type AttachmentCommandExecute = (
  sessionId: SessionId,
  line: string,
  images: readonly never[],
) => Promise<CommandRemoteResult>

/**
 * Execute a command with the attachment argument, falling back only when rc.7 rejects that exact arity before dispatch.
 * @param remote - public DSH Client Remote assembly.
 * @param sessionId - addressed Session.
 * @param line - complete slash-command line.
 * @returns the public command result.
 */
export async function executeCommandCompat(
  remote: ClientRemote,
  sessionId: SessionId,
  line: string,
): Promise<CommandRemoteResult> {
  const executeWithAttachments = remote.commands.execute as unknown as AttachmentCommandExecute
  try {
    return await executeWithAttachments(sessionId, line, [])
  } catch (error: unknown) {
    if (!isRcSevenCommandArity(error)) throw error
  }
  return await remote.commands.execute(sessionId, line)
}

function isRcSevenCommandArity(error: unknown): boolean {
  return error instanceof Error
    && /^client api: commands\/execute expected 2 business argument\(s\) plus an optional AbortSignal, got 3$/u
      .test(error.message)
}
