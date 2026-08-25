/** Public commands Remote compatibility across supported DSH release candidates. */

import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'

type CommandRemoteResult = Awaited<ReturnType<ClientRemote['commands']['execute']>>
type LegacyCommandExecute = (
  sessionId: SessionId,
  line: string,
  images: readonly never[],
) => Promise<CommandRemoteResult>

/**
 * Execute a command using the rc.7 signature, falling back only when rc.6 rejects that exact arity before dispatch.
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
  try {
    return await remote.commands.execute(sessionId, line)
  } catch (error: unknown) {
    if (!isRcSixCommandArity(error)) throw error
  }
  const executeLegacy = remote.commands.execute as unknown as LegacyCommandExecute
  return await executeLegacy(sessionId, line, [])
}

function isRcSixCommandArity(error: unknown): boolean {
  return error instanceof Error
    && /^client api: commands\/execute expected 3 business argument\(s\) plus an optional AbortSignal, got 2$/u
      .test(error.message)
}
