/** Browser encoding and Remote command helpers for memory-space governance. */

import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { MEMORY_UI_RESULT_PREFIX, type MemoryUiResult } from '../ui-protocol.ts'
import { executeCommandCompat } from './execute-command.ts'

/** Execute one private governance operation and decode its structured value. */
export async function executeMemoryUi<T>(
  remote: ClientRemote,
  sessionId: SessionId,
  operation: string,
  payload: object,
): Promise<T> {
  const result = await executeCommandCompat(
    remote,
    sessionId,
    `/memory-space-ui ${operation} ${encodePayload(payload)}`,
  )
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
  const text = result.value?.result.text
  if (text === undefined || !text.startsWith(MEMORY_UI_RESULT_PREFIX)) {
    throw new Error('记忆空间服务没有返回可识别的结果。')
  }
  const decoded = decodeResult(text)
  if (!decoded.ok) {
    throw new MemoryUiRequestError(decoded.error.message, decoded.error.code, decoded.error.labels)
  }
  return decoded.value as T
}

/** Structured rejection used for sensitive-content and relation UI handling. */
export class MemoryUiRequestError extends Error {
  override readonly name = 'MemoryUiRequestError'

  /** @param message - safe diagnostic. @param code - stable failure code. @param labels - optional sensitive categories. */
  constructor(
    message: string,
    readonly code: string,
    readonly labels: readonly string[] = [],
  ) {
    super(message)
  }
}

function encodePayload(value: object): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

function decodeResult(text: string): MemoryUiResult {
  const bytes = base64UrlToBytes(text.slice(MEMORY_UI_RESULT_PREFIX.length))
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (typeof value !== 'object' || value === null || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    throw new Error('记忆空间服务返回了无效数据。')
  }
  return value as MemoryUiResult
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
