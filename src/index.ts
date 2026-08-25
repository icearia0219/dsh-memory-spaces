/**
 * Human-governed shared memory spaces with local SQLite FTS5 recall.
 * Relationship changes are browser-only; explicit writes use `/memory`; accepted
 * direct-user messages retrieve only from consuming spaces and receive durable untrusted context.
 *
 * @module dsh-memory-spaces
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { executeMemoryCommand } from './command.ts'
import { CommandReplayGuard } from './command-source.ts'
import { MemoryStore } from './database.ts'
import { importSessionHistory } from './history-import.ts'
import { resolveProfileDatabasePath } from './profile-storage.ts'
import { extractRecallQuery, renderRecall } from './recall.ts'
import { executeMemoryShareCommand } from './share-command.ts'
import { executeMemoryUiCommand, MemoryPreviewChoices } from './ui-command.ts'

export * from './command.ts'
export * from './command-source.ts'
export * from './database.ts'
export * from './history-import.ts'
export * from './profile-storage.ts'
export * from './recall.ts'
export * from './serialization.ts'
export * from './share-command.ts'
export * from './share-protocol.ts'
export * from './sharing.ts'
export * from './ui-command.ts'
export * from './ui-protocol.ts'
export type * from './types.ts'

/** Cordis plugin name used in durable injected-message attribution. */
export const name = 'memory-spaces'

/** Agent pre-step and human command registries required by this plugin. */
export const inject = ['agents', 'commands', 'llm']

/** SQLite and complete recall-budget configuration. */
export interface Config {
  /** SQLite path resolved once at load; `:memory:` is accepted for tests. */
  databasePath: string
  /** SQLite journal mode. */
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  /** Milliseconds SQLite waits for a locked database. */
  busyTimeoutMs?: number
  /** Maximum UTF-8 bytes in one manually saved memory. */
  maxMemoryBytes?: number
  /** Maximum UTF-8 bytes of accepted direct-user text used as a search query. */
  maxQueryBytes?: number
  /** Maximum ranked records considered for one injection or preview. */
  maxRecallItems?: number
  /** Maximum UTF-8 bytes in the complete warning, tags, JSON, and memories. */
  maxRecallBytes?: number
  /** Fixed provider route for history summaries; set with historySummaryModel or leave empty for the session route. */
  historySummaryProvider?: string
  /** Fixed model id for history summaries; set with historySummaryProvider or leave empty for the session route. */
  historySummaryModel?: string
  /** Maximum model output tokens for one opt-in history summary. */
  historySummaryMaxTokens?: number
  /** Maximum UTF-8 bytes of current conversation supplied to one history-summary call. */
  maxHistoryImportBytes?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  databasePath: z.string().required(),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  busyTimeoutMs: z.number().step(1).min(0).default(5_000),
  maxMemoryBytes: z.number().step(1).min(1).default(8_192),
  maxQueryBytes: z.number().step(1).min(1).default(4_096),
  maxRecallItems: z.number().step(1).min(1).max(50).default(8),
  maxRecallBytes: z.number().step(1).min(512).default(16_384),
  historySummaryProvider: z.string().default(''),
  historySummaryModel: z.string().default(''),
  historySummaryMaxTokens: z.number().step(1).min(1).default(1_200),
  maxHistoryImportBytes: z.number().step(1).min(1_024).default(65_536),
})

interface ResolvedConfig {
  databasePath: string
  journalMode: 'wal' | 'delete' | 'truncate' | 'persist'
  busyTimeoutMs: number
  maxMemoryBytes: number
  maxQueryBytes: number
  maxRecallItems: number
  maxRecallBytes: number
  historySummaryProvider: string
  historySummaryModel: string
  historySummaryMaxTokens: number
  maxHistoryImportBytes: number
}

/**
 * Register the human command, pre-step recall, and SQLite lifetime.
 * Runtime retrieval failures are logged and omit memory context instead of blocking the chat step.
 * @param ctx - Cordis plugin context.
 * @param config - storage and retrieval bounds.
 * @throws at load for invalid configuration, storage failures, unsupported schemas, or missing FTS5.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const previews = new MemoryPreviewChoices()
  const replayGuard = new CommandReplayGuard()
  const sessionsInjectedThisTurn = new Set<string>()
  ctx.effect(() => () => replayGuard.clear(), 'memory-spaces.command-replay-cache')
  let store: MemoryStore | undefined
  try {
    store = new MemoryStore(resolved)
    ctx.effect(() => () => store?.close(), 'memory-spaces.close()')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.error(`memory-spaces storage is unavailable; shared memory is disabled: ${message}`)
  }

  ctx.effect(() => ctx.commands.register({
    name: 'memory-share',
    description: 'open the governed read-only conversation snapshot interface',
    input: { hint: '<browser-operation>' },
    recordInput: false,
    handler: invocation => replayGuard.run(invocation, () => store === undefined
      ? { kind: 'error' as const, text: 'Memory spaces are unavailable. See the host log for the storage failure.' }
      : executeMemoryShareCommand(store, resolved, invocation)),
  }), 'memory-spaces.command.memory-share')

  ctx.effect(() => ctx.commands.register({
    name: 'memory-space-ui',
    description: 'private browser operations for memory-space governance and injection previews',
    input: { hint: '<browser-operation>' },
    recordInput: false,
    handler: invocation => replayGuard.run(invocation, () => store === undefined
      ? { kind: 'error' as const, text: 'Memory spaces are unavailable. See the host log for the storage failure.' }
      : executeMemoryUiCommand(store, {
          ...resolved,
          previews,
          importHistory: (spaceName, sourceSessionTitle, current) => importSessionHistory(
            ctx,
            store,
            resolved,
            current.agent,
            spaceName,
            current.signal,
            sourceSessionTitle,
          ),
        }, invocation)),
  }), 'memory-spaces.command.memory-space-ui')

  ctx.effect(() => ctx.commands.register({
    name: 'memory',
    description: 'manage explicit shared-memory spaces for this session',
    input: { hint: '[help|create|import-history|leave|purge|drop|remember|forget|list|show|preview] ...' },
    handler: invocation => replayGuard.run(invocation, () => store === undefined
      ? { kind: 'error' as const, text: 'Memory spaces are unavailable. See the host log for the storage failure.' }
      : executeMemoryCommand(store, {
          ...resolved,
          importHistory: (spaceName, current) => importSessionHistory(
            ctx,
            store,
            resolved,
            current.agent,
            spaceName,
            current.signal,
          ),
        }, invocation)),
  }), 'memory-spaces.command.memory')

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (store === undefined) return decision
    if (sessionsInjectedThisTurn.has(agent.id)) return decision
    const query = extractRecallQuery(decision.messages, resolved.maxQueryBytes)
    if (query.length === 0) return decision
    try {
      const preview = previews.take(agent.id, query)
      const automatic = store.search(agent.id, query, resolved.maxRecallItems)
      const manual = preview === undefined ? [] : store.memoriesByIds(agent.id, preview.includedIds)
      const disabled = preview?.disabledIds ?? new Set<string>()
      const seen = new Set<string>()
      const candidates = [...manual, ...automatic].filter((memory) => {
        if (disabled.has(memory.id) || seen.has(memory.id)) return false
        seen.add(memory.id)
        return true
      })
      const rendered = renderRecall(candidates, resolved.maxRecallBytes)
      if (rendered === undefined) return decision
      const text = rendered.text
      store.recordRecallUsage(rendered.memories.map(memory => memory.id), agent.id)
      sessionsInjectedThisTurn.add(agent.id)
      return {
        kind: 'enter',
        messages: [
          createUserMessage({
            content: [{ type: 'text', text }],
            source: {
              kind: 'plugin',
              plugin: name,
              form: 'recall',
              sections: [{ name: 'shared-memory-spaces', text }],
            },
          }),
          ...decision.messages,
        ],
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`memory recall failed; continuing without shared memory: ${message}`)
      return decision
    }
  }, { prepend: true })

  ctx.on('session/event', (session, event) => {
    if (store === undefined) return
    if (event.type === 'assistant/message') {
      store.attachRecallUsages(session.id, event.seq)
    } else if (event.type === 'turn/end') {
      store.clearPendingRecallUsages(session.id)
      sessionsInjectedThisTurn.delete(session.id)
    }
  })
}

function resolveConfig(config: Config): ResolvedConfig {
  if (config.databasePath.trim().length === 0) {
    throw new TypeError('memory-spaces: databasePath must not be empty')
  }
  const resolved: ResolvedConfig = {
    databasePath: resolveProfileDatabasePath(config.databasePath),
    journalMode: config.journalMode ?? 'wal',
    busyTimeoutMs: config.busyTimeoutMs ?? 5_000,
    maxMemoryBytes: config.maxMemoryBytes ?? 8_192,
    maxQueryBytes: config.maxQueryBytes ?? 4_096,
    maxRecallItems: config.maxRecallItems ?? 8,
    maxRecallBytes: config.maxRecallBytes ?? 16_384,
    historySummaryProvider: config.historySummaryProvider?.trim() ?? '',
    historySummaryModel: config.historySummaryModel?.trim() ?? '',
    historySummaryMaxTokens: config.historySummaryMaxTokens ?? 1_200,
    maxHistoryImportBytes: config.maxHistoryImportBytes ?? 65_536,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (key === 'databasePath'
      || key === 'journalMode'
      || key === 'historySummaryProvider'
      || key === 'historySummaryModel') continue
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`memory-spaces: ${key} must be a safe integer`)
    }
  }
  if (resolved.busyTimeoutMs < 0
    || resolved.maxMemoryBytes < 1
    || resolved.maxQueryBytes < 1
    || resolved.maxRecallItems < 1
    || resolved.maxRecallItems > 50
    || resolved.maxRecallBytes < 512
    || resolved.historySummaryMaxTokens < 1
    || resolved.maxHistoryImportBytes < 1_024) {
    throw new TypeError('memory-spaces: one or more numeric bounds are outside their allowed range')
  }
  if ((resolved.historySummaryProvider.length === 0) !== (resolved.historySummaryModel.length === 0)) {
    throw new TypeError('memory-spaces: historySummaryProvider and historySummaryModel must both be set or both be empty')
  }
  return resolved
}
