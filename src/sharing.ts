/** Safe, exact conversation selection and credential-pattern review for sharing. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SurfaceEvent } from '@deepseek-ai/dsh-session'
import { deriveEventMessage, isSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { retainUtf8Prefix } from './serialization.ts'
import { HistoryImportError } from './history-import.ts'
import type { MemorySourceMessage } from './types.ts'

/** One high-confidence sensitive-value category found before sharing. */
export interface SensitiveFinding {
  kind: 'private-key' | 'api-key' | 'cloud-key' | 'access-token' | 'secret-assignment'
  label: string
}

/** Selected human-readable dialogue and its durable source range. */
export interface ConversationShareSelection {
  text: string
  sourceSeqStart: number
  sourceSeqEnd: number
  includedEntries: number
  truncated: boolean
  sensitiveFindings: SensitiveFinding[]
  /** Exact durable messages represented by the selected text. */
  sourceMessages: MemorySourceMessage[]
}

interface ShareEntry {
  seq: number
  text: string
  role: MemorySourceMessage['role']
  excerpt: string
}

const SENSITIVE_PATTERNS: ReadonlyArray<{
  kind: SensitiveFinding['kind']
  label: string
  pattern: RegExp
}> = [
  { kind: 'private-key', label: '私钥正文', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu },
  { kind: 'api-key', label: 'sk- 形式的 API Key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/gu },
  { kind: 'cloud-key', label: '云服务访问密钥', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  { kind: 'access-token', label: 'GitHub 访问令牌', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu },
  {
    kind: 'secret-assignment',
    label: '疑似密钥或令牌赋值',
    pattern: /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/giu,
  },
]

/**
 * Select direct dialogue from one effective Session surface.
 * Reasoning and appended plugin context are always excluded; tool results are opt-in.
 * @param session - source Session.
 * @param options - optional exact event selection, tool-result inclusion, and byte bound.
 * @returns bounded share text, provenance, and sensitive-value categories.
 */
export function collectConversationShare(
  session: Session,
  options: {
    seqs?: readonly number[]
    includeToolResults: boolean
    maxBytes: number
  },
): ConversationShareSelection {
  const requested = options.seqs === undefined ? undefined : new Set(options.seqs)
  const entries: ShareEntry[] = []
  for (const seq of session.surface.nodes) {
    if (requested !== undefined && !requested.has(seq)) continue
    const event = session.events[seq]
    if (event === undefined || !isSurfaceEvent(event)) {
      throw new Error(`memory-spaces: surface node ${seq} does not resolve to a surface event`)
    }
    const entry = shareEntry(event, options.includeToolResults)
    if (entry !== undefined) entries.push(entry)
  }
  if (entries.length === 0) {
    throw new HistoryImportError('The selected conversation contains no shareable user or assistant messages.')
  }
  const complete = entries.map(entry => entry.text).join('\n\n')
  const text = retainUtf8Prefix(complete, options.maxBytes)
  return {
    text,
    sourceSeqStart: entries[0]?.seq ?? 0,
    sourceSeqEnd: entries.at(-1)?.seq ?? 0,
    includedEntries: entries.length,
    truncated: text !== complete,
    sensitiveFindings: scanSensitiveContent(text),
    sourceMessages: entries.map(entry => ({ seq: entry.seq, role: entry.role, excerpt: entry.excerpt })),
  }
}

/** Return distinct sensitive-value categories without reproducing matched values. */
export function scanSensitiveContent(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = []
  for (const candidate of SENSITIVE_PATTERNS) {
    candidate.pattern.lastIndex = 0
    if (!candidate.pattern.test(text)) continue
    findings.push({ kind: candidate.kind, label: candidate.label })
  }
  return findings
}

function shareEntry(event: SurfaceEvent, includeToolResults: boolean): ShareEntry | undefined {
  const message = deriveEventMessage(event)
  if (message === null) return
  if (message.source.kind === 'plugin' && event.surfaceOp === 'append') return
  if (message.source.kind === 'tool' && !includeToolResults) return
  const content = renderShareBlocks(message.content, includeToolResults).trim()
  if (content.length === 0) return
  const role = event.surfaceOp !== 'append'
    ? '此前会话摘要'
    : message.source.kind === 'user'
      ? '用户'
      : message.source.kind === 'model'
        ? '助手'
        : message.source.kind === 'tool'
          ? '工具结果'
          : '上下文'
  const sourceRole: MemorySourceMessage['role'] = event.surfaceOp !== 'append'
    ? 'summary'
    : message.source.kind === 'user'
      ? 'user'
      : message.source.kind === 'model'
        ? 'assistant'
        : message.source.kind === 'tool'
          ? 'tool'
          : 'context'
  return {
    seq: event.seq,
    text: `[${role} · 事件 ${event.seq}]\n${content}`,
    role: sourceRole,
    excerpt: content,
  }
}

function renderShareBlocks(blocks: readonly ContentBlock[], includeToolResults: boolean): string {
  const rendered: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        rendered.push(block.text)
        break
      case 'reasoning':
        break
      case 'image':
        rendered.push('[图片附件未包含在文本分享中]')
        break
      case 'tool-call':
        if (includeToolResults) rendered.push(`[工具调用 ${block.name}] ${block.arguments}`)
        break
      case 'tool-result':
        if (includeToolResults) {
          const content = renderShareBlocks(block.content, true).trim()
          rendered.push(`[工具结果${block.isError === true ? ' · 错误' : ''}]${content.length === 0 ? '' : `\n${content}`}`)
        }
        break
      default:
        break
    }
  }
  return rendered.join('\n')
}
