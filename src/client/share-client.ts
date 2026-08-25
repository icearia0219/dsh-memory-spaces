/** Browser encoding and Remote command helpers for memory share operations. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { executeCommandCompat } from './execute-command.ts'

const MEMORY_SHARE_RESULT_PREFIX = 'DSH_MEMORY_SHARE_V1:'

type MemoryShareResult =
  | { ok: true; operation: string; value: unknown }
  | { ok: false; operation: string; error: { code: string; message: string; labels?: string[] } }

/** Encode JSON without placing readable credentials in the slash-command line. */
export function encodeSharePayload(value: object): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/** Generate one unguessable bearer value in the browser. */
export function randomBearerToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

/** Run one private share command and decode its structured result. */
export async function executeShare(
  remote: ClientRemote,
  sessionId: SessionId,
  operation: string,
  payload: object,
): Promise<unknown> {
  const result = await executeCommandCompat(
    remote,
    sessionId,
    `/memory-share ${operation} ${encodeSharePayload(payload)}`,
  )
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
  const text = result.value?.result.text
  if (text === undefined || !text.startsWith(MEMORY_SHARE_RESULT_PREFIX)) {
    throw new Error('分享服务没有返回可识别的结果。')
  }
  const decoded = decodeShareResult(text)
  if (!decoded.ok) throw new ShareRequestError(decoded.error.message, decoded.error.code, decoded.error.labels)
  return decoded.value
}

/** Execute one ordinary memory command and surface its handler failure. */
export async function executeMemory(remote: ClientRemote, sessionId: SessionId, line: string): Promise<void> {
  const result = await executeCommandCompat(remote, sessionId, line)
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
  if (result.value === undefined) throw new Error(`无法识别命令：${line}`)
  if (result.value.result.kind === 'error') throw new Error(result.value.result.text)
}

/** Structured rejection used to offer a second sensitive-content confirmation. */
export class ShareRequestError extends Error {
  override readonly name = 'ShareRequestError'

  constructor(
    message: string,
    readonly code: string,
    readonly labels: readonly string[] = [],
  ) {
    super(message)
  }
}

function decodeShareResult(text: string): MemoryShareResult {
  const encoded = text.slice(MEMORY_SHARE_RESULT_PREFIX.length)
  const bytes = base64UrlToBytes(encoded)
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (typeof value !== 'object' || value === null || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    throw new Error('分享服务返回了无效数据。')
  }
  return value as MemoryShareResult
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
