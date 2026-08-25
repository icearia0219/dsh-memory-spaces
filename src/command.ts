/** Human-only `/memory` command for explicit space and memory governance. */

import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { directUserCommandSeq } from './command-source.ts'
import { MEMORY_TYPES, MemorySpaceError, type MemoryStore } from './database.ts'
import { HistoryImportError, type HistoryImportResult } from './history-import.ts'
import { renderRecall } from './recall.ts'
import { retainUtf8Prefix } from './serialization.ts'
import type { MemoryType, SharedMemory } from './types.ts'

const HELP = `Memory spaces are private until the user explicitly connects Sessions in the memory-space UI.

Usage:
  /memory import-history <space>
  /memory remember <space> <type> <content>
  /memory forget <memory-id>
  /memory list
  /memory show <space>
  /memory preview <query>

Creating spaces, connecting source or consuming Sessions, changing use modes, removing relationships, provenance-clearing, and whole-space deletion are UI-only operations. A model cannot invoke them. History import is opt-in and uses a model to summarize a Session that the user connected as a source. A later import creates a new version and supersedes that Session's earlier generated summary.

Quote a space name or content when it contains spaces. Memory types: ${MEMORY_TYPES.join(', ')}.
Only active memory versions are eligible for recall.`

/** Bounds shared by command previews and automatic recall. */
export interface MemoryCommandOptions {
  maxQueryBytes: number
  maxRecallItems: number
  maxRecallBytes: number
  /** Summarize and store the current Session after it is connected as a source. */
  importHistory(spaceName: string, invocation: CommandInvocation): Promise<HistoryImportResult>
}

/**
 * Parse whitespace-separated command arguments with single or double quotes and backslash escaping.
 * @param input - exact text following `/memory`.
 * @returns decoded argument tokens.
 * @throws when a quote or trailing escape is incomplete.
 */
export function tokenizeMemoryCommand(input: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let started = false
  for (const character of input.trim()) {
    if (escaped) {
      token += character
      escaped = false
      started = true
      continue
    }
    if (character === '\\') {
      escaped = true
      started = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else token += character
      started = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/u.test(character)) {
      if (started) {
        tokens.push(token)
        token = ''
        started = false
      }
      continue
    }
    token += character
    started = true
  }
  if (escaped) throw new MemorySpaceError('The command ends with an incomplete escape.', 'INVALID_INPUT')
  if (quote !== undefined) throw new MemorySpaceError('The command contains an unclosed quote.', 'INVALID_INPUT')
  if (started) tokens.push(token)
  return tokens
}

/**
 * Execute one human command without sending its control text to the model.
 * @param store - authoritative relationship and memory store.
 * @param options - query, item, and rendered-byte bounds.
 * @param invocation - current agent, durable command id, text, and cancellation.
 * @returns direct UI outcome.
 */
export async function executeMemoryCommand(
  store: MemoryStore,
  options: MemoryCommandOptions,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  try {
    invocation.signal.throwIfAborted()
    const [verb, ...args] = tokenizeMemoryCommand(invocation.rawInput)
    const sessionId = invocation.agent.id
    switch (verb) {
      case undefined:
      case 'help':
        return success(HELP)
      case 'create':
      case 'join':
      case 'leave':
      case 'purge':
      case 'drop':
        return failure('Space relationships and deletion are available only in the memory-space UI.')
      case 'import-history': {
        requireCount(args, 1, 'Usage: /memory import-history <space>')
        assertDirectUserCommand(invocation)
        const imported = await options.importHistory(required(args, 0), invocation)
        return success(renderHistoryImport(imported))
      }
      case 'remember': {
        if (args.length < 3) {
          return failure('Usage: /memory remember <space> <type> <content>')
        }
        const type = parseMemoryType(required(args, 1))
        const sourceSeq = commandSourceSeq(invocation)
        const result = store.remember({
          spaceName: required(args, 0),
          sourceSessionId: sessionId,
          sourceSessionTitle: String(sessionId),
          sourceSeqStart: sourceSeq,
          sourceSeqEnd: sourceSeq,
          creationMethod: 'manual',
          sourceMessages: [{ seq: sourceSeq, role: 'user', excerpt: args.slice(2).join(' ') }],
          type,
          content: args.slice(2).join(' '),
        })
        return success([
          result.created ? 'Saved shared memory.' : 'That active memory already exists for this source session.',
          `Memory id: ${result.memory.id}`,
          `Space: ${result.memory.spaceName}`,
          `Type: ${result.memory.type}`,
          `Source: Session ${result.memory.sourceSessionTitle ?? result.memory.sourceSessionId ?? 'cleared'}, event ${result.memory.sourceSeqStart ?? 'cleared'}`,
        ].join('\n'))
      }
      case 'forget': {
        requireCount(args, 1, 'Usage: /memory forget <memory-id>')
        assertDirectUserCommand(invocation)
        store.forget(required(args, 0), sessionId)
        return success('Deleted the memory. It will not appear in future recall.')
      }
      case 'list': {
        requireCount(args, 0, 'Usage: /memory list')
        const spaces = store.listSpaces(sessionId)
        if (spaces.length === 0) return success('This Session has no memory-space relationship.')
        return success(spaces.map(({ space, consumer, source, activeMemoryCount }) => {
          const relationships = [
            consumer === undefined ? undefined : `uses: ${consumer.mode}`,
            source === undefined ? undefined : 'source',
            space.ownerSessionId === sessionId ? 'owner' : undefined,
          ].filter((value): value is string => value !== undefined)
          return `- ${space.name} (${relationships.join(', ')}, ${activeMemoryCount} active memories, id ${space.id})`
        }).join('\n'))
      }
      case 'show': {
        requireCount(args, 1, 'Usage: /memory show <space>')
        const memories = store.listMemories(required(args, 0), sessionId, options.maxRecallItems)
        if (memories.length === 0) return success('No memory versions are visible in that space.')
        return success(renderMemoryList(memories))
      }
      case 'preview': {
        if (args.length === 0) return failure('Usage: /memory preview <query>')
        const query = retainUtf8Prefix(args.join(' '), options.maxQueryBytes).trim()
        const candidates = store.search(sessionId, query, options.maxRecallItems)
        const rendered = renderRecall(candidates, options.maxRecallBytes)
        if (rendered === undefined) return success('No readable memory matches fit the configured recall budget.')
        return success(`The next matching prompt would receive ${rendered.memories.length} memory record(s):\n\n${rendered.text}`)
      }
      default:
        return failure(`Unknown memory command ${JSON.stringify(verb)}.\n\n${HELP}`)
    }
  } catch (error: unknown) {
    if (error instanceof MemorySpaceError || error instanceof HistoryImportError) return failure(error.message)
    throw error
  }
}

function commandSourceSeq(invocation: CommandInvocation): number {
  const seq = directUserCommandSeq(invocation)
  if (seq === undefined) {
    throw new MemorySpaceError('Memory changes require a direct user command.', 'INVALID_INPUT')
  }
  return seq
}

function assertDirectUserCommand(invocation: CommandInvocation): void {
  if (directUserCommandSeq(invocation) === undefined) {
    throw new MemorySpaceError('Memory changes require a direct user command.', 'INVALID_INPUT')
  }
}

function parseMemoryType(value: string): MemoryType {
  if (MEMORY_TYPES.includes(value as MemoryType)) return value as MemoryType
  throw new MemorySpaceError(`Memory type must be one of: ${MEMORY_TYPES.join(', ')}.`, 'INVALID_INPUT')
}

function renderMemoryList(memories: readonly SharedMemory[]): string {
  return memories.map(memory => [
    `- [${memory.status} · ${memory.type} · v${memory.versionNumber}] ${memory.content}`,
    `  id ${memory.id}; source Session ${memory.sourceSessionTitle ?? memory.sourceSessionId ?? 'cleared'}, events ${memory.sourceSeqStart ?? 'cleared'}-${memory.sourceSeqEnd ?? 'cleared'}`,
  ].join('\n')).join('\n')
}

function renderHistoryImport(result: HistoryImportResult): string {
  const selection = !result.transcriptTruncated
    ? `Summarized all ${result.includedEntries} eligible conversation entries.`
    : `Summarized ${result.includedEntries} represented entries; ${result.omittedEntries} middle entries and some source text were truncated by the configured byte bound.`
  return [
    'Imported a model-generated session history summary.',
    selection,
    result.replacedSummaries === 0
      ? 'No earlier generated summary from this session was replaced.'
      : `Replaced ${result.replacedSummaries} earlier generated summary record(s) from this session.`,
    `Memory id: ${result.memory.id}`,
    `Source: Session ${result.memory.sourceSessionTitle ?? result.memory.sourceSessionId ?? 'cleared'}, events ${result.memory.sourceSeqStart ?? 'cleared'}-${result.memory.sourceSeqEnd ?? 'cleared'}`,
    '',
    result.memory.content,
  ].join('\n')
}

function requireCount(values: readonly string[], expected: number, usage: string): void {
  if (values.length !== expected) throw new MemorySpaceError(usage, 'INVALID_INPUT')
}

function required(values: readonly string[], index: number): string {
  const value = values[index]
  if (value === undefined || value.length === 0) {
    throw new MemorySpaceError('A required command argument is empty.', 'INVALID_INPUT')
  }
  return value
}

function success(text: string): CommandResult {
  return { kind: 'success', text }
}

function failure(text: string): CommandResult {
  return { kind: 'error', text }
}
