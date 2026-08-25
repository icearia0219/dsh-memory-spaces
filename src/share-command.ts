/** Log-redacted browser command for read-only conversation snapshots. */

import { Buffer } from 'node:buffer'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { directUserCommandSeq } from './command-source.ts'
import { MemorySpaceError, type MemoryStore } from './database.ts'
import { HistoryImportError } from './history-import.ts'
import { collectConversationShare } from './sharing.ts'
import { MEMORY_SHARE_RESULT_PREFIX, type MemoryShareResult } from './share-protocol.ts'

export { MEMORY_SHARE_RESULT_PREFIX, type MemoryShareResult } from './share-protocol.ts'

/** Bounds required by exact read-only conversation sharing. */
export interface MemoryShareCommandOptions {
  maxHistoryImportBytes: number
}

/**
 * Execute one browser-only snapshot operation without recording bearer input.
 * @param store - snapshot-link store.
 * @param options - conversation selection byte bound.
 * @param invocation - addressed Session and encoded browser request.
 * @returns encoded structured outcome.
 */
export function executeMemoryShareCommand(
  store: MemoryStore,
  options: MemoryShareCommandOptions,
  invocation: CommandInvocation,
): CommandResult {
  const [operation = '', payloadText = ''] = invocation.rawInput.trim().split(/\s+/u, 2)
  try {
    const payload = decodePayload(payloadText)
    if (directUserCommandSeq(invocation) === undefined) {
      throw new TypeError('memory-share operations require a direct user command event')
    }
    switch (operation) {
      case 'state':
        return encodedSuccess(operation, { links: store.listShareLinks(invocation.agent.id) })
      case 'create-conversation': {
        const source = conversationPayload(payload)
        const selection = collectConversationShare(invocation.agent.session, {
          seqs: source.seqs,
          includeToolResults: source.includeToolResults,
          maxBytes: options.maxHistoryImportBytes,
        })
        if (selection.sensitiveFindings.length > 0 && !source.acknowledgeSensitive) {
          return encodedFailure(operation, {
            code: 'sensitive-content',
            message: '检测到疑似凭据或私密值。请取消分享、调整选择，或在检查后明确确认。',
            labels: selection.sensitiveFindings.map(finding => finding.label),
          })
        }
        const created = store.createConversationShare({
          sourceSessionId: invocation.agent.id,
          sourceSeqStart: selection.sourceSeqStart,
          sourceSeqEnd: selection.sourceSeqEnd,
          title: requiredString(payload, 'title'),
          content: selection.text,
          expiresAt: requiredInteger(payload, 'expiresAt'),
          maxUses: requiredInteger(payload, 'maxUses'),
          accessToken: requiredString(payload, 'accessToken'),
          editToken: requiredString(payload, 'editToken'),
        })
        return encodedSuccess(operation, {
          link: created.link,
          includedEntries: selection.includedEntries,
          truncated: selection.truncated,
          sensitiveLabels: selection.sensitiveFindings.map(finding => finding.label),
        })
      }
      case 'append-conversation': {
        const source = conversationPayload(payload)
        const selection = collectConversationShare(invocation.agent.session, {
          seqs: source.seqs,
          includeToolResults: source.includeToolResults,
          maxBytes: options.maxHistoryImportBytes,
        })
        if (selection.sensitiveFindings.length > 0 && !source.acknowledgeSensitive) {
          return encodedFailure(operation, {
            code: 'sensitive-content',
            message: '检测到疑似凭据或私密值。请取消分享、调整选择，或在检查后明确确认。',
            labels: selection.sensitiveFindings.map(finding => finding.label),
          })
        }
        const snapshot = store.appendConversationShare({
          editToken: requiredString(payload, 'editToken'),
          sourceSessionId: invocation.agent.id,
          sourceSeqStart: selection.sourceSeqStart,
          sourceSeqEnd: selection.sourceSeqEnd,
          title: requiredString(payload, 'title'),
          content: selection.text,
        })
        return encodedSuccess(operation, {
          snapshot,
          includedEntries: selection.includedEntries,
          truncated: selection.truncated,
          sensitiveLabels: selection.sensitiveFindings.map(finding => finding.label),
        })
      }
      case 'inspect':
        return encodedSuccess(operation, store.inspectShareLink(requiredString(payload, 'token')))
      case 'open-conversation':
        return encodedSuccess(operation, store.openConversationShare(requiredString(payload, 'token')))
      case 'revoke':
        store.revokeShareLink(requiredString(payload, 'linkId'), invocation.agent.id)
        return encodedSuccess(operation, { revoked: true })
      default:
        return encodedFailure(operation, {
          code: 'unknown-operation',
          message: '未知的只读快照操作。请通过分享界面重试。',
        })
    }
  } catch (error: unknown) {
    if (error instanceof MemorySpaceError || error instanceof HistoryImportError || error instanceof TypeError) {
      return encodedFailure(operation, {
        code: error instanceof MemorySpaceError ? error.code : 'request-rejected',
        message: error.message,
      })
    }
    throw error
  }
}

/** Decode one command result for tests and browser callers. */
export function decodeMemoryShareResult(text: string): MemoryShareResult {
  if (!text.startsWith(MEMORY_SHARE_RESULT_PREFIX)) {
    throw new TypeError('memory-share result has an invalid prefix')
  }
  const value: unknown = JSON.parse(
    Buffer.from(text.slice(MEMORY_SHARE_RESULT_PREFIX.length), 'base64url').toString('utf8'),
  )
  if (typeof value !== 'object' || value === null || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    throw new TypeError('memory-share result has an invalid JSON value')
  }
  return value as MemoryShareResult
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

function encoded(result: MemoryShareResult): CommandResult {
  return {
    kind: 'success',
    text: `${MEMORY_SHARE_RESULT_PREFIX}${Buffer.from(JSON.stringify(result), 'utf8').toString('base64url')}`,
  }
}

function decodePayload(text: string): Record<string, unknown> {
  if (text.length === 0 || text.length > 350_000 || !/^[A-Za-z0-9_-]+$/u.test(text)) {
    throw new TypeError('memory-share request payload is missing or malformed')
  }
  const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('memory-share request payload must be a JSON object')
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`memory-share field ${key} must be a non-empty string`)
  }
  return value
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (!Number.isSafeInteger(value)) throw new TypeError(`memory-share field ${key} must be a safe integer`)
  return value as number
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new TypeError(`memory-share field ${key} must be a boolean`)
  return value
}

function conversationPayload(record: Record<string, unknown>): {
  seqs: readonly number[]
  includeToolResults: boolean
  acknowledgeSensitive: boolean
} {
  const rawSeqs = record['seqs']
  if (!Array.isArray(rawSeqs) || rawSeqs.length === 0 || rawSeqs.length > 10_000
    || rawSeqs.some(value => !Number.isSafeInteger(value) || (value as number) < 0)) {
    throw new TypeError('memory-share field seqs must be a non-empty array of non-negative safe integers')
  }
  const seqs = [...new Set(rawSeqs as number[])].sort((left, right) => left - right)
  return {
    seqs,
    includeToolResults: requiredBoolean(record, 'includeToolResults'),
    acknowledgeSensitive: requiredBoolean(record, 'acknowledgeSensitive'),
  }
}
