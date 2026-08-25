/** Log-redacted browser command for sources, consuming Sessions, provenance, versions, and previews. */

import { Buffer } from 'node:buffer'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { directUserCommandSeq } from './command-source.ts'
import {
  MEMORY_USE_MODES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  MemorySpaceError,
  type MemoryStore,
} from './database.ts'
import { HistoryImportError, type HistoryImportResult } from './history-import.ts'
import { renderRecall } from './recall.ts'
import { retainUtf8Prefix } from './serialization.ts'
import { collectConversationShare } from './sharing.ts'
import { MEMORY_UI_RESULT_PREFIX, type MemoryUiResult } from './ui-protocol.ts'
import type {
  LeaveDisposition,
  MemoryUseMode,
  MemoryInjectionPreview,
  MemoryStatus,
  MemoryType,
  SharedMemory,
} from './types.ts'

const MAX_BATCH_SESSION_IDS = 1_000

export { MEMORY_UI_RESULT_PREFIX, type MemoryUiResult } from './ui-protocol.ts'

/** Exact per-send overrides selected in the browser preview. */
export interface PreviewChoice {
  query: string
  disabledIds: ReadonlySet<string>
  includedIds: readonly string[]
  expiresAt: number
}

/** In-memory, one-send preview choices keyed by Session. */
export class MemoryPreviewChoices {
  private readonly choices = new Map<string, PreviewChoice>()

  /** Store the latest exact-query choice for one Session. */
  set(sessionId: SessionId, query: string, disabledIds: readonly string[], includedIds: readonly string[]): void {
    this.choices.set(sessionId, {
      query: normalizeQuery(query),
      disabledIds: new Set(disabledIds),
      includedIds: [...new Set(includedIds)],
      expiresAt: Date.now() + 10 * 60 * 1_000,
    })
  }

  /** Consume the choice only when it matches the text entering the next model step. */
  take(sessionId: SessionId, query: string): PreviewChoice | undefined {
    const choice = this.choices.get(sessionId)
    if (choice === undefined) return
    this.choices.delete(sessionId)
    if (choice.expiresAt <= Date.now() || choice.query !== normalizeQuery(query)) return
    return choice
  }
}

/** Services and bounds used by browser governance operations. */
export interface MemoryUiCommandOptions {
  maxHistoryImportBytes: number
  maxQueryBytes: number
  maxRecallItems: number
  maxRecallBytes: number
  previews: MemoryPreviewChoices
  importHistory(
    spaceName: string,
    sourceSessionTitle: string,
    invocation: CommandInvocation,
  ): Promise<HistoryImportResult>
}

/**
 * Execute a browser-only governance operation.
 * @param store - authoritative relation and memory store.
 * @param options - preview state, bounds, and history importer.
 * @param invocation - addressed Session and encoded request.
 * @returns encoded structured outcome.
 */
export async function executeMemoryUiCommand(
  store: MemoryStore,
  options: MemoryUiCommandOptions,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const [operation = '', payloadText = ''] = invocation.rawInput.trim().split(/\s+/u, 2)
  try {
    const payload = decodePayload(payloadText)
    if (directUserCommandSeq(invocation) === undefined) {
      throw new TypeError('memory-space UI operations require a direct user command event')
    }
    const sessionId = invocation.agent.id
    switch (operation) {
      case 'state':
        return encodedSuccess(operation, store.governanceState(sessionId))
      case 'create-space': {
        store.createSpace(requiredString(payload, 'spaceName'), sessionId)
        return encodedSuccess(operation, store.governanceState(sessionId))
      }
      case 'add-source': {
        store.addSource(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredSessionId(payload, 'targetSessionId'),
        )
        return encodedSuccess(operation, store.governanceState(sessionId))
      }
      case 'add-consumer': {
        store.addConsumer(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredSessionId(payload, 'targetSessionId'),
          requiredMemoryUseMode(payload),
        )
        return encodedSuccess(operation, store.governanceState(sessionId))
      }
      case 'set-own-use-mode': {
        store.setOwnUseMode(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredMemoryUseMode(payload),
        )
        return encodedSuccess(operation, store.governanceState(sessionId))
      }
      case 'set-consumer-modes': {
        const consumers = store.setConsumerModes(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredSessionIds(payload, 'targetSessionIds'),
          requiredMemoryUseMode(payload),
        )
        return encodedSuccess(operation, { consumers, state: store.governanceState(sessionId) })
      }
      case 'remove-own-source': {
        const changed = store.removeOwnSource(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredLeaveDisposition(payload),
        )
        return encodedSuccess(operation, { changed, state: store.governanceState(sessionId) })
      }
      case 'remove-sources': {
        const removed = store.removeSources(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredSessionIds(payload, 'targetSessionIds'),
          requiredLeaveDisposition(payload),
        )
        return encodedSuccess(operation, { removed, state: store.governanceState(sessionId) })
      }
      case 'remove-own-consumer':
        store.removeOwnConsumer(requiredString(payload, 'spaceName'), sessionId)
        return encodedSuccess(operation, store.governanceState(sessionId))
      case 'remove-consumers': {
        const removed = store.removeConsumers(
          requiredString(payload, 'spaceName'),
          sessionId,
          requiredSessionIds(payload, 'targetSessionIds'),
        )
        return encodedSuccess(operation, { removed, state: store.governanceState(sessionId) })
      }
      case 'delete-space':
        store.deleteSpace(requiredString(payload, 'spaceName'), sessionId)
        return encodedSuccess(operation, store.governanceState(sessionId))
      case 'import-history': {
        const imported = await options.importHistory(
          requiredString(payload, 'spaceName'),
          requiredString(payload, 'sourceSessionTitle'),
          invocation,
        )
        return encodedSuccess(operation, { imported, state: store.governanceState(sessionId) })
      }
      case 'save-selection': {
        const source = conversationPayload(payload)
        const selection = collectConversationShare(invocation.agent.session, {
          seqs: source.seqs,
          includeToolResults: source.includeToolResults,
          maxBytes: options.maxHistoryImportBytes,
        })
        if (selection.sensitiveFindings.length > 0 && !source.acknowledgeSensitive) {
          return encodedFailure(operation, {
            code: 'sensitive-content',
            message: '检测到疑似 API Key、密码、私钥或访问令牌。请调整选择或在核对后再次确认。',
            labels: selection.sensitiveFindings.map(finding => finding.label),
          })
        }
        const remembered = store.remember({
          spaceName: requiredString(payload, 'spaceName'),
          sourceSessionId: sessionId,
          sourceSessionTitle: requiredString(payload, 'sourceSessionTitle'),
          sourceSeqStart: selection.sourceSeqStart,
          sourceSeqEnd: selection.sourceSeqEnd,
          creationMethod: 'manual',
          sourceMessages: selection.sourceMessages,
          type: requiredMemoryType(payload),
          content: requiredString(payload, 'content'),
        })
        return encodedSuccess(operation, { remembered, state: store.governanceState(sessionId) })
      }
      case 'update-memory': {
        const memory = store.createVersion(
          requiredString(payload, 'memoryId'),
          sessionId,
          {
            content: requiredString(payload, 'content'),
            type: requiredMemoryType(payload),
            sourceSessionTitle: requiredString(payload, 'sourceSessionTitle'),
          },
        )
        return encodedSuccess(operation, { memory, state: store.governanceState(sessionId) })
      }
      case 'set-memory-status': {
        const memory = store.setMemoryStatus(
          requiredString(payload, 'memoryId'),
          sessionId,
          requiredMemoryStatus(payload),
        )
        return encodedSuccess(operation, { memory, state: store.governanceState(sessionId) })
      }
      case 'preview': {
        const query = retainUtf8Prefix(requiredString(payload, 'query'), options.maxQueryBytes).trim()
        const disabledIds = optionalStringArray(payload, 'disabledIds')
        const includedIds = optionalStringArray(payload, 'includedIds')
        options.previews.set(sessionId, query, disabledIds, includedIds)
        return encodedSuccess(operation, buildPreview(
          store,
          sessionId,
          query,
          disabledIds,
          includedIds,
          options.maxRecallItems,
          options.maxRecallBytes,
        ))
      }
      default:
        return encodedFailure(operation, {
          code: 'unknown-operation',
          message: '未知的记忆空间操作。请关闭面板后重试。',
        })
    }
  } catch (error: unknown) {
    if (error instanceof MemorySpaceError || error instanceof HistoryImportError || error instanceof TypeError) {
      return encodedFailure(operation, { code: error instanceof MemorySpaceError ? error.code : 'request-rejected', message: error.message })
    }
    throw error
  }
}

/** Decode one UI result for tests and browser callers. */
export function decodeMemoryUiResult(text: string): MemoryUiResult {
  if (!text.startsWith(MEMORY_UI_RESULT_PREFIX)) {
    throw new TypeError('memory UI result has an invalid prefix')
  }
  const value: unknown = JSON.parse(
    Buffer.from(text.slice(MEMORY_UI_RESULT_PREFIX.length), 'base64url').toString('utf8'),
  )
  if (typeof value !== 'object' || value === null || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    throw new TypeError('memory UI result has an invalid JSON value')
  }
  return value as MemoryUiResult
}

function buildPreview(
  store: MemoryStore,
  sessionId: SessionId,
  query: string,
  disabledIds: readonly string[],
  includedIds: readonly string[],
  maxItems: number,
  maxBytes: number,
): MemoryInjectionPreview {
  const disabled = new Set(disabledIds)
  const automatic = store.search(sessionId, query, maxItems, 'automatic')
  const confirmed = store.memoriesByIds(sessionId, includedIds)
  const merged = dedupeMemories([...confirmed, ...automatic])
    .filter(memory => !disabled.has(memory.id))
  const rendered = renderRecall(merged, maxBytes)
  const memories = rendered?.memories ?? []
  const renderedBytes = rendered === undefined ? 0 : Buffer.byteLength(rendered.text, 'utf8')
  const confirmCandidates = store.search(sessionId, query, 30, 'confirm')
  return {
    query,
    memories,
    confirmCandidates,
    estimatedTokens: Math.ceil(renderedBytes / 4),
    renderedBytes,
  }
}

function dedupeMemories(memories: readonly SharedMemory[]): SharedMemory[] {
  const seen = new Set<string>()
  return memories.filter(memory => {
    if (seen.has(memory.id)) return false
    seen.add(memory.id)
    return true
  })
}

function encodedSuccess(operation: string, value: unknown): CommandResult {
  return encoded({ ok: true, operation, value })
}

function encodedFailure(
  operation: string,
  error: { code: string; message: string; labels?: string[] },
): CommandResult {
  return encoded({ ok: false, operation, error })
}

function encoded(result: MemoryUiResult): CommandResult {
  return {
    kind: 'success',
    text: `${MEMORY_UI_RESULT_PREFIX}${Buffer.from(JSON.stringify(result), 'utf8').toString('base64url')}`,
  }
}

function decodePayload(text: string): Record<string, unknown> {
  if (text.length === 0 || text.length > 350_000 || !/^[A-Za-z0-9_-]+$/u.test(text)) {
    throw new TypeError('memory UI request payload is missing or malformed')
  }
  const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('memory UI request payload must be a JSON object')
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`memory UI field ${key} must be a non-empty string`)
  }
  return value.trim()
}

function requiredSessionId(record: Record<string, unknown>, key: string): SessionId {
  return requiredString(record, key) as SessionId
}

function requiredSessionIds(record: Record<string, unknown>, key: string): SessionId[] {
  const values = optionalStringArray(record, key)
  if (values.length === 0) throw new TypeError(`memory UI field ${key} must select at least one Session`)
  return values.map(value => value as SessionId)
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_BATCH_SESSION_IDS || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`memory UI field ${key} must be an array of strings`)
  }
  return [...new Set(value as string[])]
}

function requiredMemoryUseMode(record: Record<string, unknown>): MemoryUseMode {
  const value = record['mode']
  if (MEMORY_USE_MODES.includes(value as MemoryUseMode)) return value as MemoryUseMode
  throw new TypeError('memory UI field mode is invalid')
}

function requiredLeaveDisposition(record: Record<string, unknown>): LeaveDisposition {
  const value = record['disposition']
  if (value === 'retain' || value === 'delete_contributions' || value === 'clear_provenance') return value
  throw new TypeError('memory UI field disposition is invalid')
}

function requiredMemoryType(record: Record<string, unknown>): MemoryType {
  const value = record['type']
  if (MEMORY_TYPES.includes(value as MemoryType)) return value as MemoryType
  throw new TypeError('memory UI field type is invalid')
}

function requiredMemoryStatus(record: Record<string, unknown>): MemoryStatus {
  const value = record['status']
  if (MEMORY_STATUSES.includes(value as MemoryStatus)) return value as MemoryStatus
  throw new TypeError('memory UI field status is invalid')
}

function conversationPayload(record: Record<string, unknown>): {
  seqs: readonly number[]
  includeToolResults: boolean
  acknowledgeSensitive: boolean
} {
  const rawSeqs = record['seqs']
  if (!Array.isArray(rawSeqs) || rawSeqs.length === 0 || rawSeqs.length > 10_000
    || rawSeqs.some(value => !Number.isSafeInteger(value) || (value as number) < 0)) {
    throw new TypeError('memory UI field seqs must be a non-empty array of event sequence values')
  }
  const includeToolResults = record['includeToolResults']
  const acknowledgeSensitive = record['acknowledgeSensitive']
  if (typeof includeToolResults !== 'boolean' || typeof acknowledgeSensitive !== 'boolean') {
    throw new TypeError('memory UI selection flags must be booleans')
  }
  return {
    seqs: [...new Set(rawSeqs as number[])].sort((left, right) => left - right),
    includeToolResults,
    acknowledgeSensitive,
  }
}

function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim()
}
