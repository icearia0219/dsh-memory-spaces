import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-commands/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'

/** Memory command text projected independently from model messages. */
export interface MemoryCommandInputData {
  readonly commandId: CommandId
  readonly text: string
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Human-entered `/memory` command input. */
    'memory-command-input': MemoryCommandInputData
  }
}

interface MemoryCommandInputState extends MemoryCommandInputData {
  readonly seq: number
}

/**
 * Derive the visible command line from its structured durable run.
 * @param event - `/memory` command run.
 * @returns command text with parser-added trailing whitespace removed.
 */
export function memoryCommandText(event: SessionEvent<'command/run'>): string {
  return `/${event.data.name}${(event.data.args ?? '').trimEnd()}`
}

/** Memory-owned command input projection; the generic command node retains the result. */
export const memoryCommandInputDefinition: ConversationNodeDefinition<MemoryCommandInputState> = {
  kind: 'memory-command-input',
  target: 'chat',
  match: event => event.type === 'command/run' && event.data.name === 'memory'
    ? { id: String(event.data.commandId), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'command/run') {
      throw new Error('memory-command-input start requires command/run')
    }
    return {
      commandId: match.event.data.commandId,
      seq: match.event.seq,
      time: match.event.time,
      text: memoryCommandText(match.event),
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'memory-command-input',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq - 0.1,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: {
        commandId: context.state.commandId,
        text: context.state.text,
        time: context.state.time,
      },
    }
  },
}
