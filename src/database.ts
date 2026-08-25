/** SQLite owner for memory sources, consuming Sessions, provenance, versions, and read-only snapshots. */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ConversationShareInspection,
  HistorySummaryWriteResult,
  LeaveDisposition,
  MemoryUseMode,
  MemoryCreationMethod,
  MemoryGovernanceState,
  MemoryId,
  MemorySourceMessage,
  MemorySpace,
  MemoryStatus,
  MemoryType,
  OpenedConversationShare,
  RememberResult,
  RemoveConsumersResult,
  RemoveSourcesResult,
  SessionSpaceView,
  SharedConversationSnapshot,
  SharedMemory,
  ShareLinkId,
  ShareLinkView,
  SpaceId,
  SpaceConsumer,
  SpaceConsumerView,
  SpaceSource,
  SpaceSourceView,
} from './types.ts'
import { resolveProfileDatabasePath } from './profile-storage.ts'

const SCHEMA_VERSION = 4
const MAX_SPACE_NAME_CODE_POINTS = 80
const MAX_QUERY_TERMS = 64
const MAX_SOURCE_EXCERPT_BYTES = 4_096
const MAX_RECENT_USAGES = 12
const MAX_BATCH_SESSION_IDS = 1_000

/** Visible prefix identifying the replaceable generated summary for one source Session. */
export const HISTORY_SUMMARY_PREFIX = '## Session history summary / 会话历史摘要（模型生成）'

/** Runtime list used to validate human command input and SQLite rows. */
export const MEMORY_TYPES = [
  'fact',
  'decision',
  'constraint',
  'preference',
  'task',
  'artifact',
  'issue',
  'solution',
  'temporary',
] as const satisfies readonly MemoryType[]

/** Runtime list used to validate answer-time memory-use choices from the browser. */
export const MEMORY_USE_MODES = ['automatic', 'confirm', 'paused'] as const satisfies readonly MemoryUseMode[]

/** Runtime list used to validate lifecycle operations arriving from the browser command. */
export const MEMORY_STATUSES = [
  'active',
  'superseded',
  'disputed',
  'expired',
  'deleted',
] as const satisfies readonly MemoryStatus[]

const ALLOWED_MEMORY_STATUS_TRANSITIONS = {
  active: ['superseded', 'disputed', 'expired', 'deleted'],
  superseded: ['deleted'],
  disputed: ['active', 'deleted'],
  expired: ['deleted'],
  deleted: [],
} as const satisfies Record<MemoryStatus, readonly MemoryStatus[]>

/** Stable domain errors rendered by the command consumers without SQLite details. */
export class MemorySpaceError extends Error {
  /** Machine-readable failure category. */
  readonly code:
    | 'SPACE_EXISTS'
    | 'SPACE_NOT_FOUND'
    | 'RELATION_REQUIRED'
    | 'USE_DENIED'
    | 'SOURCE_REQUIRED'
    | 'OWNER_REQUIRED'
    | 'MEMORY_NOT_FOUND'
    | 'INVALID_INPUT'

  /**
   * @param message - safe human-facing diagnostic.
   * @param code - stable failure category.
   * @param options - optional native error cause.
   */
  constructor(message: string, code: MemorySpaceError['code'], options?: ErrorOptions) {
    super(message, options)
    this.name = 'MemorySpaceError'
    this.code = code
  }
}

/** Construction values resolved once when the plugin loads. */
export interface MemoryStoreOptions {
  databasePath: string
  journalMode: 'wal' | 'delete' | 'truncate' | 'persist'
  busyTimeoutMs: number
  maxMemoryBytes: number
}

/** Raw bearer tokens returned exactly once with their safe persisted metadata. */
export interface CreatedShareLink {
  link: ShareLinkView
  token: string
  editToken: string
}

interface SpaceRow {
  id: string
  name: string
  owner_session_id: string
  created_at: number
  updated_at: number
}

interface ConsumerRow {
  space_id: string
  session_id: string
  mode: string
  connected_at: number
  updated_at: number
}

interface SourceRow {
  space_id: string
  session_id: string
  added_at: number
  updated_at: number
}

interface SessionSpaceRow extends SpaceRow {
  consumer_space_id: string | null
  consumer_session_id: string | null
  consumer_mode: string | null
  consumer_connected_at: number | null
  consumer_updated_at: number | null
  source_space_id: string | null
  source_session_id: string | null
  source_added_at: number | null
  source_updated_at: number | null
  active_memory_count: number
  contribution_count: number
}

interface SpaceSourceRow extends SourceRow {
  owner_session_id: string
  contribution_count: number
  non_deleted_contribution_count: number
  last_contribution_at: number | null
}

interface SpaceConsumerRow extends ConsumerRow {
  owner_session_id: string
  last_used_at: number | null
}

interface MemoryRow {
  id: string
  space_id: string
  space_name: string
  version_root_id: string
  version_number: number
  previous_version_id: string | null
  superseded_by_id: string | null
  status: string
  source_session_id: string | null
  source_session_title: string | null
  source_seq_start: number | null
  source_seq_end: number | null
  creation_method: string
  provenance_cleared: number
  type: string
  content: string
  created_at: number
  updated_at: number
  expires_at: number | null
  score?: number
}

interface SourceMessageRow {
  memory_id: string
  seq: number
  role: string
  excerpt: string
}

interface UsageRow {
  target_session_id: string
  response_seq: number | null
  used_at: number
}

interface ShareLinkRow {
  id: string
  created_by_session_id: string
  expires_at: number
  max_uses: number
  use_count: number
  revoked_at: number | null
  created_at: number
}

interface SnapshotRow {
  id: string
  share_link_id: string
  source_session_id: string
  source_seq_start: number
  source_seq_end: number
  title: string
  content: string
  created_at: number
}

interface RememberInput {
  spaceName: string
  sourceSessionId: SessionId
  sourceSessionTitle?: string
  sourceSeqStart?: number
  sourceSeqEnd?: number
  creationMethod?: MemoryCreationMethod
  sourceMessages?: readonly MemorySourceMessage[]
  type: MemoryType
  content: string
  expiresAt?: number
}

/** Persistent store enforcing source and consumer relations at each operation. */
export class MemoryStore {
  private readonly database: DatabaseSync
  private readonly maxMemoryBytes: number
  readonly databasePath: string

  /**
   * Open or initialize one schema-versioned SQLite database.
   * @param options - resolved path, journal mode, busy timeout, and write bound.
   */
  constructor(options: MemoryStoreOptions) {
    const databasePath = resolveDatabasePath(options.databasePath)
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.databasePath = databasePath
    this.maxMemoryBytes = options.maxMemoryBytes
    this.database = new DatabaseSync(databasePath)
    try {
      this.database.exec('PRAGMA foreign_keys = ON')
      this.database.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs}`)
      this.initializeSchema()
      this.database.exec(`PRAGMA journal_mode = ${options.journalMode}`)
      if (databasePath !== ':memory:' && process.platform !== 'win32') chmodSync(databasePath, 0o600)
    } catch (error: unknown) {
      this.database.close()
      throw error
    }
  }

  /** Close the owned SQLite handle. Calling this more than once is harmless. */
  close(): void {
    if (this.database.isOpen) this.database.close()
  }

  /** Create a named space whose owner automatically uses its memories. */
  createSpace(name: string, ownerSessionId: SessionId): MemorySpace {
    const normalizedName = normalizeSpaceName(name)
    const now = Date.now()
    const id = randomUUID() as SpaceId
    try {
      this.transaction(() => {
        this.database.prepare(`
          INSERT INTO memory_spaces (id, name, owner_session_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, normalizedName, ownerSessionId, now, now)
        this.database.prepare(`
          INSERT INTO space_consumers (space_id, session_id, mode, connected_at, updated_at)
          VALUES (?, ?, 'automatic', ?, ?)
        `).run(id, ownerSessionId, now, now)
      })
    } catch (error: unknown) {
      if (isUniqueConstraint(error)) {
        throw new MemorySpaceError(
          `A memory space named ${JSON.stringify(normalizedName)} already exists.`,
          'SPACE_EXISTS',
          { cause: error },
        )
      }
      throw error
    }
    return { id, name: normalizedName, ownerSessionId, createdAt: now, updatedAt: now }
  }

  /** Add one Session as an explicit source. Only the space owner may call this operation. */
  addSource(
    spaceName: string,
    ownerSessionId: SessionId,
    targetSessionId: SessionId,
  ): SpaceSource {
    const space = this.requireOwnedSpace(spaceName, ownerSessionId)
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO space_sources (space_id, session_id, added_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(space_id, session_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `).run(space.id, targetSessionId, now, now)
    return this.requireSource(space.id, targetSessionId)
  }

  /** Add or update one Session that may use memories from the space. */
  addConsumer(
    spaceName: string,
    ownerSessionId: SessionId,
    targetSessionId: SessionId,
    mode: MemoryUseMode,
  ): SpaceConsumer {
    const space = this.requireOwnedSpace(spaceName, ownerSessionId)
    const normalizedMode = normalizeMemoryUseMode(mode)
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO space_consumers (space_id, session_id, mode, connected_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(space_id, session_id) DO UPDATE SET
        mode = excluded.mode,
        updated_at = excluded.updated_at
    `).run(space.id, targetSessionId, normalizedMode, now, now)
    return this.requireConsumer(space.id, targetSessionId)
  }

  /** Change answer-time use modes for existing consumers atomically. */
  setConsumerModes(
    spaceName: string,
    ownerSessionId: SessionId,
    targetSessionIds: readonly SessionId[],
    mode: MemoryUseMode,
  ): SpaceConsumer[] {
    const space = this.requireOwnedSpace(spaceName, ownerSessionId)
    const targets = normalizeTargetSessionIds(targetSessionIds)
    const normalizedMode = normalizeMemoryUseMode(mode)
    for (const target of targets) this.requireConsumer(space.id, target)
    const now = Date.now()
    this.transaction(() => {
      const update = this.database.prepare(`
        UPDATE space_consumers SET mode = ?, updated_at = ?
        WHERE space_id = ? AND session_id = ?
      `)
      for (const target of targets) update.run(normalizedMode, now, space.id, target)
    })
    return targets.map(target => this.requireConsumer(space.id, target))
  }

  /** Change how the current consuming Session uses one space. */
  setOwnUseMode(spaceName: string, sessionId: SessionId, mode: MemoryUseMode): SpaceConsumer {
    const space = this.requireSpace(spaceName)
    this.requireConsumer(space.id, sessionId)
    const normalizedMode = normalizeMemoryUseMode(mode)
    this.database.prepare(`
      UPDATE space_consumers SET mode = ?, updated_at = ?
      WHERE space_id = ? AND session_id = ?
    `).run(normalizedMode, Date.now(), space.id, sessionId)
    return this.requireConsumer(space.id, sessionId)
  }

  /** Verify or establish that an explicit user action may contribute from one Session. */
  assertContributionAccess(spaceName: string, sessionId: SessionId): void {
    const space = this.requireSpace(spaceName)
    this.ensureContributionSource(space, sessionId)
  }

  /** Remove the current Session as a source with an explicit contribution disposition. */
  removeOwnSource(
    spaceName: string,
    sessionId: SessionId,
    disposition: LeaveDisposition,
  ): number {
    const space = this.requireSpace(spaceName)
    this.requireSource(space.id, sessionId)
    return this.removeSourcesInternal(space, [sessionId], disposition).changedMemoryVersions
  }

  /** Remove selected source Sessions and apply one contribution disposition atomically. */
  removeSources(
    spaceName: string,
    ownerSessionId: SessionId,
    targetSessionIds: readonly SessionId[],
    disposition: LeaveDisposition,
  ): RemoveSourcesResult {
    const space = this.requireOwnedSpace(spaceName, ownerSessionId)
    const targets = normalizeTargetSessionIds(targetSessionIds)
    for (const target of targets) this.requireSource(space.id, target)
    return this.removeSourcesInternal(space, targets, disposition)
  }

  /** Stop the current Session from using memories in one space. */
  removeOwnConsumer(spaceName: string, sessionId: SessionId): void {
    const space = this.requireSpace(spaceName)
    this.requireConsumer(space.id, sessionId)
    this.database.prepare(`
      DELETE FROM space_consumers WHERE space_id = ? AND session_id = ?
    `).run(space.id, sessionId)
  }

  /** Stop selected Sessions from using one owner-controlled space atomically. */
  removeConsumers(
    spaceName: string,
    ownerSessionId: SessionId,
    targetSessionIds: readonly SessionId[],
  ): RemoveConsumersResult {
    const space = this.requireOwnedSpace(spaceName, ownerSessionId)
    const targets = normalizeTargetSessionIds(targetSessionIds)
    for (const target of targets) this.requireConsumer(space.id, target)
    this.transaction(() => {
      const remove = this.database.prepare(`
        DELETE FROM space_consumers WHERE space_id = ? AND session_id = ?
      `)
      for (const target of targets) remove.run(space.id, target)
    })
    return { removedConsumers: targets.length }
  }

  /** Permanently delete a whole space after explicit owner confirmation. */
  deleteSpace(spaceName: string, ownerSessionId: SessionId): void {
    const space = this.requireOwnedSpace(spaceName, ownerSessionId)
    this.database.prepare('DELETE FROM memory_spaces WHERE id = ?').run(space.id)
  }

  /** Save one manually confirmed or model-extracted memory with complete provenance. */
  remember(input: RememberInput): RememberResult {
    this.expireDueMemories()
    const space = this.requireSpace(input.spaceName)
    this.ensureContributionSource(space, input.sourceSessionId)
    const content = normalizeMemoryContent(input.content, this.maxMemoryBytes)
    const type = normalizeMemoryType(input.type)
    const creationMethod = normalizeCreationMethod(input.creationMethod ?? 'manual')
    const source = normalizeSource(input)
    const contentHash = hashContent(content)
    const existing = this.findActiveDuplicate(space.id, input.sourceSessionId, contentHash)
    if (existing !== undefined) return { memory: existing, created: false }
    const now = Date.now()
    const id = randomUUID() as MemoryId
    const expiresAt = normalizeExpiry(input.expiresAt)
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO memories (
          id, space_id, version_root_id, version_number, previous_version_id,
          superseded_by_id, status, source_session_id, source_session_title,
          source_seq_start, source_seq_end, creation_method, provenance_cleared,
          type, content, content_hash, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, 1, NULL, NULL, 'active', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        id, space.id, id, input.sourceSessionId, source.title,
        source.seqStart, source.seqEnd, creationMethod, type, content,
        contentHash, now, now, expiresAt,
      )
      this.insertSourceMessages(id, source.messages)
    })
    return { memory: this.requireMemory(id), created: true }
  }

  /**
   * Create a new active version and mark the previously active version in its chain superseded.
   * @param memoryId - version being revised.
   * @param operatorSessionId - source or owner performing the revision.
   * @param input - new content, type, and optional provenance.
   * @returns the new active version.
   */
  createVersion(
    memoryId: string,
    operatorSessionId: SessionId,
    input: {
      content: string
      type: MemoryType
      sourceSessionTitle?: string
      sourceSeq?: number
      sourceMessages?: readonly MemorySourceMessage[]
    },
  ): SharedMemory {
    const previous = this.requireManageableMemory(memoryId, operatorSessionId)
    if (previous.status !== 'active') {
      throw new MemorySpaceError('Only the current active memory version can be revised.', 'INVALID_INPUT')
    }
    this.assertLatestVersion(previous)
    const space = this.requireSpaceById(previous.spaceId)
    this.ensureContributionSource(space, operatorSessionId)
    const content = normalizeMemoryContent(input.content, this.maxMemoryBytes)
    const type = normalizeMemoryType(input.type)
    const now = Date.now()
    const id = randomUUID() as MemoryId
    const sourceMessages = input.sourceMessages === undefined
      ? previous.sourceMessages
      : normalizeSourceMessages(input.sourceMessages)
    const sourceSeqStart = input.sourceSeq ?? previous.sourceSeqStart ?? null
    const sourceSeqEnd = input.sourceSeq ?? previous.sourceSeqEnd ?? null
    const sourceSessionTitle = input.sourceSessionTitle === undefined
      ? previous.sourceSessionTitle ?? null
      : normalizeOptionalTitle(input.sourceSessionTitle)
    this.transaction(() => {
      const superseded = this.database.prepare(`
        UPDATE memories
        SET status = 'superseded', superseded_by_id = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(id, now, previous.id)
      if (superseded.changes !== 1) {
        throw new MemorySpaceError('The active memory version changed before revision completed.', 'INVALID_INPUT')
      }
      this.database.prepare(`
        INSERT INTO memories (
          id, space_id, version_root_id, version_number, previous_version_id,
          superseded_by_id, status, source_session_id, source_session_title,
          source_seq_start, source_seq_end, creation_method, provenance_cleared,
          type, content, content_hash, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?, 'manual', 0, ?, ?, ?, ?, ?, NULL)
      `).run(
        id, previous.spaceId, previous.versionRootId, previous.versionNumber + 1,
        previous.id, operatorSessionId, sourceSessionTitle,
        sourceSeqStart, sourceSeqEnd, type, content,
        hashContent(content), now, now,
      )
      this.insertSourceMessages(id, sourceMessages)
    })
    return this.requireMemory(id)
  }

  /** Change a memory lifecycle state; only one version in a chain can become active. */
  setMemoryStatus(memoryId: string, operatorSessionId: SessionId, status: MemoryStatus): SharedMemory {
    const memory = this.requireManageableMemory(memoryId, operatorSessionId)
    const normalizedStatus = normalizeMemoryStatus(status)
    if (normalizedStatus === memory.status) return memory
    const allowedTransitions: readonly MemoryStatus[] = ALLOWED_MEMORY_STATUS_TRANSITIONS[memory.status]
    if (!allowedTransitions.includes(normalizedStatus)) {
      throw new MemorySpaceError(
        `Memory status cannot change from ${memory.status} to ${normalizedStatus}.`,
        'INVALID_INPUT',
      )
    }
    if (normalizedStatus === 'active') this.assertLatestVersion(memory)
    const now = Date.now()
    this.transaction(() => {
      if (normalizedStatus === 'active') {
        this.database.prepare(`
          UPDATE memories
          SET status = 'superseded', superseded_by_id = ?, updated_at = ?
          WHERE version_root_id = ? AND status = 'active' AND id != ?
        `).run(memory.id, now, memory.versionRootId, memory.id)
      }
      this.database.prepare(`
        UPDATE memories SET status = ?, updated_at = ? WHERE id = ?
      `).run(normalizedStatus, now, memory.id)
    })
    return this.requireMemory(memory.id)
  }

  /** Logically delete one memory version. */
  forget(memoryId: string, sessionId: SessionId): void {
    this.setMemoryStatus(memoryId, sessionId, 'deleted')
  }

  /** Replace one Session's earlier generated summary while retaining its version chain. */
  replaceHistorySummary(input: Omit<RememberInput, 'type' | 'creationMethod'>): HistorySummaryWriteResult {
    const space = this.requireSpace(input.spaceName)
    this.ensureContributionSource(space, input.sourceSessionId)
    const previousRow = this.database.prepare(`
      SELECT id
      FROM memories
      WHERE space_id = ? AND source_session_id = ?
        AND creation_method = 'model_extracted'
        AND content LIKE ?
        AND status = 'active'
      ORDER BY version_number DESC, created_at DESC
      LIMIT 1
    `).get(space.id, input.sourceSessionId, `${escapeLike(HISTORY_SUMMARY_PREFIX)}%`) as
      | { id: string }
      | undefined
    if (previousRow === undefined) {
      return {
        ...this.remember({
          ...input,
          type: 'artifact',
          creationMethod: 'model_extracted',
        }),
        replacedSummaries: 0,
      }
    }
    const previous = this.requireMemory(previousRow.id as MemoryId)
    const content = normalizeMemoryContent(input.content, this.maxMemoryBytes)
    const source = normalizeSource(input)
    const now = Date.now()
    const id = randomUUID() as MemoryId
    this.transaction(() => {
      this.database.prepare(`
        UPDATE memories SET status = 'superseded', superseded_by_id = ?, updated_at = ?
        WHERE version_root_id = ? AND status = 'active'
      `).run(id, now, previous.versionRootId)
      this.database.prepare(`
        INSERT INTO memories (
          id, space_id, version_root_id, version_number, previous_version_id,
          superseded_by_id, status, source_session_id, source_session_title,
          source_seq_start, source_seq_end, creation_method, provenance_cleared,
          type, content, content_hash, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?, 'model_extracted', 0,
          'artifact', ?, ?, ?, ?, NULL)
      `).run(
        id, space.id, previous.versionRootId, previous.versionNumber + 1, previous.id,
        input.sourceSessionId, source.title, source.seqStart, source.seqEnd,
        content, hashContent(content), now, now,
      )
      this.insertSourceMessages(id, source.messages)
    })
    return { memory: this.requireMemory(id), created: true, replacedSummaries: 1 }
  }

  /** List spaces visible through ownership, contribution, or answer-time use. */
  listSpaces(sessionId: SessionId): SessionSpaceView[] {
    this.expireDueMemories()
    const rows = this.database.prepare(`
      SELECT s.id, s.name, s.owner_session_id, s.created_at, s.updated_at,
        consumer.space_id AS consumer_space_id,
        consumer.session_id AS consumer_session_id,
        consumer.mode AS consumer_mode,
        consumer.connected_at AS consumer_connected_at,
        consumer.updated_at AS consumer_updated_at,
        source.space_id AS source_space_id,
        source.session_id AS source_session_id,
        source.added_at AS source_added_at,
        source.updated_at AS source_updated_at,
        (SELECT COUNT(*) FROM memories m WHERE m.space_id = s.id AND m.status = 'active') AS active_memory_count,
        (SELECT COUNT(*) FROM memories m WHERE m.space_id = s.id AND m.source_session_id = ?) AS contribution_count
      FROM memory_spaces s
      LEFT JOIN space_consumers consumer ON consumer.space_id = s.id AND consumer.session_id = ?
      LEFT JOIN space_sources source ON source.space_id = s.id AND source.session_id = ?
      WHERE s.owner_session_id = ? OR consumer.session_id IS NOT NULL OR source.session_id IS NOT NULL
      ORDER BY s.updated_at DESC, s.name COLLATE NOCASE
    `).all(sessionId, sessionId, sessionId, sessionId) as unknown as SessionSpaceRow[]
    return rows.map(sessionSpaceFromRow)
  }

  /** List spaces owned by one Session, including spaces it may grant to selected local Sessions. */
  listOwnedSpaces(sessionId: SessionId): MemorySpace[] {
    const rows = this.database.prepare(`
      SELECT id, name, owner_session_id, created_at, updated_at
      FROM memory_spaces WHERE owner_session_id = ?
      ORDER BY updated_at DESC, name COLLATE NOCASE
    `).all(sessionId) as unknown as SpaceRow[]
    return rows.map(spaceFromRow)
  }

  /** List all explicit source Sessions in a visible space. */
  listSpaceSources(spaceName: string, sessionId: SessionId): SpaceSourceView[] {
    const space = this.requireSpace(spaceName)
    this.requireVisibility(space, sessionId)
    const rows = this.database.prepare(`
      SELECT source.space_id, source.session_id, source.added_at, source.updated_at,
        s.owner_session_id,
        (SELECT COUNT(*) FROM memories m
          WHERE m.space_id = s.id AND m.source_session_id = source.session_id) AS contribution_count,
        (SELECT COUNT(*) FROM memories m
          WHERE m.space_id = s.id AND m.source_session_id = source.session_id
            AND m.status != 'deleted') AS non_deleted_contribution_count,
        (SELECT MAX(m.updated_at) FROM memories m
          WHERE m.space_id = s.id AND m.source_session_id = source.session_id) AS last_contribution_at
      FROM memory_spaces s
      JOIN space_sources source ON source.space_id = s.id
      WHERE s.id = ?
      ORDER BY source.session_id = s.owner_session_id DESC, source.added_at, source.session_id
    `).all(space.id) as unknown as SpaceSourceRow[]
    return rows.map(spaceSourceViewFromRow)
  }

  /** List all Sessions that may use memories from a visible space. */
  listSpaceConsumers(spaceName: string, sessionId: SessionId): SpaceConsumerView[] {
    const space = this.requireSpace(spaceName)
    this.requireVisibility(space, sessionId)
    const rows = this.database.prepare(`
      SELECT consumer.space_id, consumer.session_id, consumer.mode,
        consumer.connected_at, consumer.updated_at, s.owner_session_id,
        (SELECT MAX(usage.used_at) FROM memory_usages usage
          JOIN memories used ON used.id = usage.memory_id
          WHERE used.space_id = s.id AND usage.target_session_id = consumer.session_id
            AND usage.response_seq IS NOT NULL) AS last_used_at
      FROM memory_spaces s
      JOIN space_consumers consumer ON consumer.space_id = s.id
      WHERE s.id = ?
      ORDER BY consumer.session_id = s.owner_session_id DESC, consumer.connected_at, consumer.session_id
    `).all(space.id) as unknown as SpaceConsumerRow[]
    return rows.map(spaceConsumerViewFromRow)
  }

  /** List every governable version in one space, including inactive lifecycle states. */
  listMemories(spaceName: string, sessionId: SessionId, limit: number): SharedMemory[] {
    this.expireDueMemories()
    const space = this.requireSpace(spaceName)
    const consumer = this.findConsumer(space.id, sessionId)
    const source = this.findSource(space.id, sessionId)
    if (space.ownerSessionId !== sessionId && consumer === undefined && source === undefined) {
      throw new MemorySpaceError('This Session has no relationship with that memory space.', 'RELATION_REQUIRED')
    }
    if (space.ownerSessionId !== sessionId && consumer === undefined) {
      const rows = this.database.prepare(`${memorySelect()}
        WHERE m.space_id = ? AND m.source_session_id = ?
        ORDER BY m.version_root_id, m.version_number DESC
        LIMIT ?
      `).all(space.id, sessionId, normalizeLimit(limit)) as unknown as MemoryRow[]
      return rows.map(row => this.hydrateMemory(row))
    }
    const rows = this.database.prepare(`${memorySelect()}
      WHERE m.space_id = ?
      ORDER BY m.version_root_id, m.version_number DESC
      LIMIT ?
    `).all(space.id, normalizeLimit(limit)) as unknown as MemoryRow[]
    return rows.map(row => this.hydrateMemory(row))
  }

  /** Return the complete governance state for one Session dialog. */
  governanceState(sessionId: SessionId, limit = 500): MemoryGovernanceState {
    const spaces = this.listSpaces(sessionId)
    let remainingMemories = normalizeLimit(limit)
    const sources: SpaceSourceView[] = []
    const consumers: SpaceConsumerView[] = []
    const memories: SharedMemory[] = []
    for (const view of spaces) {
      sources.push(...this.listSpaceSources(view.space.name, sessionId))
      consumers.push(...this.listSpaceConsumers(view.space.name, sessionId))
      if (remainingMemories > 0) {
        const visibleMemories = this.listMemories(view.space.name, sessionId, remainingMemories)
        memories.push(...visibleMemories)
        remainingMemories -= visibleMemories.length
      }
    }
    return { spaces, ownedSpaces: this.listOwnedSpaces(sessionId), sources, consumers, memories }
  }

  /** Search active, non-expired memories under automatic or confirmation semantics. */
  search(
    sessionId: SessionId,
    query: string,
    limit: number,
    access: 'automatic' | 'confirm' = 'automatic',
  ): SharedMemory[] {
    this.expireDueMemories()
    const normalized = query.normalize('NFKC').trim()
    if (normalized.length === 0) return []
    const mode = access
    const ftsQuery = buildFtsQuery(normalized)
    const rows = ftsQuery === undefined
      ? this.database.prepare(`${memorySelect()}
          JOIN space_consumers consumer ON consumer.space_id = m.space_id
          WHERE consumer.session_id = ? AND consumer.mode = ?
            AND m.status = 'active'
            AND (m.expires_at IS NULL OR m.expires_at > ?)
            AND m.content LIKE ? ESCAPE '\\' COLLATE NOCASE
          ORDER BY m.updated_at DESC, m.id
          LIMIT ?
        `).all(sessionId, mode, Date.now(), `%${escapeLike(normalized)}%`, normalizeLimit(limit))
      : this.database.prepare(`${memorySelect()}
          JOIN memory_fts ON memory_fts.rowid = m.rowid
          JOIN space_consumers consumer ON consumer.space_id = m.space_id
          WHERE memory_fts MATCH ?
            AND consumer.session_id = ? AND consumer.mode = ?
            AND m.status = 'active'
            AND (m.expires_at IS NULL OR m.expires_at > ?)
          ORDER BY bm25(memory_fts) ASC, m.updated_at DESC, m.id
          LIMIT ?
        `).all(ftsQuery, sessionId, mode, Date.now(), normalizeLimit(limit))
    return (rows as unknown as MemoryRow[]).map(row => this.hydrateMemory(row))
  }

  /** Resolve explicitly selected ids from automatic or confirmation consumers. */
  memoriesByIds(sessionId: SessionId, ids: readonly string[]): SharedMemory[] {
    this.expireDueMemories()
    if (ids.length === 0) return []
    const unique = [...new Set(ids)].slice(0, 100)
    const placeholders = unique.map(() => '?').join(', ')
    const rows = this.database.prepare(`${memorySelect()}
      JOIN space_consumers consumer ON consumer.space_id = m.space_id
      WHERE m.id IN (${placeholders})
        AND consumer.session_id = ?
        AND consumer.mode IN ('automatic', 'confirm')
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > ?)
    `).all(...unique, sessionId, Date.now()) as unknown as MemoryRow[]
    const byId = new Map(rows.map(row => [row.id, this.hydrateMemory(row)]))
    return unique.flatMap(id => {
      const memory = byId.get(id)
      return memory === undefined ? [] : [memory]
    })
  }

  /** Record the exact memory versions injected into one pending answer. */
  recordRecallUsage(memoryIds: readonly MemoryId[], targetSessionId: SessionId): void {
    const now = Date.now()
    const insert = this.database.prepare(`
      INSERT INTO memory_usages (id, memory_id, target_session_id, response_seq, used_at)
      VALUES (?, ?, ?, NULL, ?)
    `)
    this.transaction(() => {
      for (const memoryId of new Set(memoryIds)) insert.run(randomUUID(), memoryId, targetSessionId, now)
    })
  }

  /** Attach pending usage rows to the durable assistant response that consumed them. */
  attachRecallUsages(targetSessionId: SessionId, responseSeq: number): number {
    if (!Number.isSafeInteger(responseSeq) || responseSeq < 0) return 0
    return Number(this.database.prepare(`
      UPDATE memory_usages SET response_seq = ?
      WHERE target_session_id = ? AND response_seq IS NULL
    `).run(responseSeq, targetSessionId).changes)
  }

  /** Remove pending usage rows when a turn ends without an assistant response. */
  clearPendingRecallUsages(targetSessionId: SessionId): number {
    return Number(this.database.prepare(`
      DELETE FROM memory_usages WHERE target_session_id = ? AND response_seq IS NULL
    `).run(targetSessionId).changes)
  }

  /** Count indexable active rows missing from FTS and indexed rows whose lifecycle is not active. */
  checkFtsIntegrity(): { missing: number; unexpected: number } {
    this.expireDueMemories()
    this.database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS temp.memory_fts_instances
      USING fts5vocab(main, memory_fts, instance)
    `)
    const row = this.database.prepare(`
      WITH indexed AS (
        SELECT DISTINCT doc AS rowid FROM temp.memory_fts_instances
      )
      SELECT
        (SELECT COUNT(*) FROM memories m
          WHERE m.status = 'active' AND length(m.content) >= 3
            AND NOT EXISTS (SELECT 1 FROM indexed WHERE indexed.rowid = m.rowid)) AS missing,
        (SELECT COUNT(*) FROM indexed
          LEFT JOIN memories m ON m.rowid = indexed.rowid
          WHERE m.rowid IS NULL OR m.status != 'active') AS unexpected
    `).get() as unknown as { missing: number; unexpected: number }
    return { missing: Number(row.missing), unexpected: Number(row.unexpected) }
  }

  /** Create a revocable read-only conversation link and its first exact snapshot. */
  createConversationShare(input: {
    sourceSessionId: SessionId
    sourceSeqStart: number
    sourceSeqEnd: number
    title: string
    content: string
    expiresAt: number
    maxUses: number
    accessToken?: string
    editToken?: string
  }): CreatedShareLink {
    assertShareLimits(input.expiresAt, input.maxUses)
    const title = normalizeSnapshotTitle(input.title)
    const content = normalizeSnapshotContent(input.content, this.maxMemoryBytes * 8)
    const id = randomUUID() as ShareLinkId
    const token = input.accessToken === undefined ? shareToken() : normalizeShareToken(input.accessToken)
    const editToken = input.editToken === undefined ? shareToken() : normalizeShareToken(input.editToken)
    if (token === editToken) {
      throw new MemorySpaceError('Read and append tokens must be independent.', 'INVALID_INPUT')
    }
    const now = Date.now()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO share_links (
          id, access_token_hash, edit_token_hash, created_by_session_id,
          expires_at, max_uses, use_count, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
      `).run(
        id, tokenHash(token), tokenHash(editToken), input.sourceSessionId,
        input.expiresAt, input.maxUses, now,
      )
      this.insertConversationSnapshot(id, input, title, content, now)
    })
    return { link: this.requireShareLink(id), token, editToken }
  }

  /** Append another exact snapshot with a link's non-view edit token. */
  appendConversationShare(input: {
    editToken: string
    sourceSessionId: SessionId
    sourceSeqStart: number
    sourceSeqEnd: number
    title: string
    content: string
  }): SharedConversationSnapshot {
    const row = this.requireShareLinkByToken(input.editToken, 'edit')
    this.assertUsableShare(row, false)
    const now = Date.now()
    const id = this.insertConversationSnapshot(
      row.id as ShareLinkId,
      input,
      normalizeSnapshotTitle(input.title),
      normalizeSnapshotContent(input.content, this.maxMemoryBytes * 8),
      now,
    )
    return this.requireConversationSnapshot(id)
  }

  /** Inspect safe read-only-link metadata without consuming a use. */
  inspectShareLink(token: string): ConversationShareInspection {
    const row = this.requireShareLinkByToken(token, 'access')
    this.assertUsableShare(row, false)
    return { link: shareLinkFromRow(row) }
  }

  /** Consume one read-only-link use and return its immutable snapshots. */
  openConversationShare(token: string): OpenedConversationShare {
    const row = this.consumeShareLink(token)
    const snapshots = this.database.prepare(`
      SELECT id, share_link_id, source_session_id, source_seq_start, source_seq_end,
        title, content, created_at
      FROM shared_conversation_snapshots
      WHERE share_link_id = ?
      ORDER BY created_at, rowid
    `).all(row.id) as unknown as SnapshotRow[]
    return { link: shareLinkFromRow(row), snapshots: snapshots.map(snapshotFromRow) }
  }

  /** Revoke one link created by the addressed Session. */
  revokeShareLink(linkId: string, sessionId: SessionId): void {
    const result = this.database.prepare(`
      UPDATE share_links SET revoked_at = ?
      WHERE id = ? AND created_by_session_id = ? AND revoked_at IS NULL
    `).run(Date.now(), linkId, sessionId)
    if (result.changes !== 1) {
      throw new MemorySpaceError('That share link is missing, already revoked, or owned by another Session.', 'INVALID_INPUT')
    }
  }

  /** List read-only links created by one Session. */
  listShareLinks(sessionId: SessionId): ShareLinkView[] {
    const rows = this.database.prepare(`
      SELECT id, created_by_session_id, expires_at, max_uses, use_count, revoked_at, created_at
      FROM share_links WHERE created_by_session_id = ? ORDER BY created_at DESC
    `).all(sessionId) as unknown as ShareLinkRow[]
    return rows.map(shareLinkFromRow)
  }

  private initializeSchema(): void {
    const row = this.database.prepare('PRAGMA user_version').get() as unknown as { user_version: number }
    if (row.user_version === SCHEMA_VERSION) return
    if (row.user_version === 3) {
      this.backUpSchemaThreeDatabase()
      this.migrateMembershipsToRelations()
      return
    }
    if (row.user_version !== 0) {
      throw new Error(
        `memory-spaces database schema ${row.user_version} is unsupported; expected ${SCHEMA_VERSION}`,
      )
    }
    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE memory_spaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          owner_session_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE space_consumers (
          space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('automatic', 'confirm', 'paused')),
          connected_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (space_id, session_id)
        );

        CREATE INDEX space_consumers_by_session ON space_consumers(session_id, space_id);

        CREATE TABLE space_sources (
          space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          added_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (space_id, session_id)
        );

        CREATE INDEX space_sources_by_session ON space_sources(session_id, space_id);

        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
          version_root_id TEXT NOT NULL,
          version_number INTEGER NOT NULL CHECK (version_number > 0),
          previous_version_id TEXT REFERENCES memories(id),
          superseded_by_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'disputed', 'expired', 'deleted')),
          source_session_id TEXT,
          source_session_title TEXT,
          source_seq_start INTEGER,
          source_seq_end INTEGER,
          creation_method TEXT NOT NULL CHECK (creation_method IN ('manual', 'model_extracted')),
          provenance_cleared INTEGER NOT NULL CHECK (provenance_cleared IN (0, 1)),
          type TEXT NOT NULL CHECK (type IN (
            'fact', 'decision', 'constraint', 'preference', 'task',
            'artifact', 'issue', 'solution', 'temporary'
          )),
          content TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER,
          CHECK ((source_seq_start IS NULL) = (source_seq_end IS NULL)),
          CHECK (source_seq_start IS NULL OR source_seq_end >= source_seq_start)
        );

        CREATE UNIQUE INDEX memories_active_version
          ON memories(version_root_id) WHERE status = 'active';
        CREATE UNIQUE INDEX memories_active_dedupe
          ON memories(space_id, source_session_id, content_hash) WHERE status = 'active';
        CREATE INDEX memories_by_space_status_time
          ON memories(space_id, status, updated_at DESC);

        CREATE TABLE memory_source_messages (
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'summary', 'context')),
          excerpt TEXT NOT NULL,
          PRIMARY KEY (memory_id, seq)
        );

        CREATE TABLE memory_usages (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          target_session_id TEXT NOT NULL,
          response_seq INTEGER,
          used_at INTEGER NOT NULL
        );

        CREATE INDEX memory_usages_recent
          ON memory_usages(memory_id, used_at DESC);
        CREATE INDEX memory_usages_pending
          ON memory_usages(target_session_id, response_seq);

        CREATE TABLE share_links (
          id TEXT PRIMARY KEY,
          access_token_hash TEXT NOT NULL UNIQUE,
          edit_token_hash TEXT NOT NULL UNIQUE,
          created_by_session_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          max_uses INTEGER NOT NULL CHECK (max_uses > 0),
          use_count INTEGER NOT NULL CHECK (use_count >= 0),
          revoked_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX share_links_by_creator_time
          ON share_links(created_by_session_id, created_at DESC);

        CREATE TABLE shared_conversation_snapshots (
          id TEXT PRIMARY KEY,
          share_link_id TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
          source_session_id TEXT NOT NULL,
          source_seq_start INTEGER NOT NULL,
          source_seq_end INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX shared_conversation_snapshots_by_link
          ON shared_conversation_snapshots(share_link_id, created_at, id);

        CREATE VIRTUAL TABLE memory_fts USING fts5(
          content,
          content = 'memories',
          content_rowid = 'rowid',
          tokenize = 'trigram'
        );

        CREATE TRIGGER memories_ai AFTER INSERT ON memories WHEN new.status = 'active'
        BEGIN
          INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER memories_ad AFTER DELETE ON memories WHEN old.status = 'active'
        BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        END;
        CREATE TRIGGER memories_au_delete AFTER UPDATE ON memories WHEN old.status = 'active'
        BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        END;
        CREATE TRIGGER memories_au_insert AFTER UPDATE ON memories WHEN new.status = 'active'
        BEGIN
          INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
        END;

        PRAGMA user_version = ${SCHEMA_VERSION};
      `)
    })
  }

  /** Convert schema version 3 memberships into independent source and consumer relations. */
  private migrateMembershipsToRelations(): void {
    this.transaction(() => {
      const row = this.database.prepare('PRAGMA user_version').get() as unknown as { user_version: number }
      if (row.user_version === SCHEMA_VERSION) return
      if (row.user_version !== 3) {
        throw new Error(
          `memory-spaces database schema changed to ${row.user_version} while waiting to migrate`,
        )
      }
      this.database.exec(`
        CREATE TABLE space_consumers (
          space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('automatic', 'confirm', 'paused')),
          connected_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (space_id, session_id)
        );

        CREATE INDEX space_consumers_by_session ON space_consumers(session_id, space_id);

        CREATE TABLE space_sources (
          space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          added_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (space_id, session_id)
        );

        CREATE INDEX space_sources_by_session ON space_sources(session_id, space_id);

        INSERT INTO space_consumers (space_id, session_id, mode, connected_at, updated_at)
        SELECT space_id, session_id,
          CASE mode WHEN 'manual_only' THEN 'confirm' ELSE 'automatic' END,
          joined_at, updated_at
        FROM space_sessions
        WHERE mode IN ('read', 'read_write', 'manual_only');

        INSERT INTO space_sources (space_id, session_id, added_at, updated_at)
        SELECT space_id, session_id, joined_at, updated_at
        FROM space_sessions
        WHERE mode IN ('write', 'read_write', 'manual_only');

        DROP INDEX space_sessions_by_session;
        DROP TABLE space_sessions;
        PRAGMA user_version = ${SCHEMA_VERSION};
      `)
    })
  }

  private backUpSchemaThreeDatabase(): void {
    if (this.databasePath === ':memory:') return
    const backupPath = `${this.databasePath}.schema-3-backup-${Date.now()}-${randomUUID()}.sqlite`
    this.database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
  }

  private requireSpace(name: string): MemorySpace {
    const normalizedName = normalizeSpaceName(name)
    const row = this.database.prepare(`
      SELECT id, name, owner_session_id, created_at, updated_at
      FROM memory_spaces WHERE name = ? COLLATE NOCASE
    `).get(normalizedName) as unknown as SpaceRow | undefined
    if (row === undefined) {
      throw new MemorySpaceError(
        `Memory space ${JSON.stringify(normalizedName)} does not exist.`,
        'SPACE_NOT_FOUND',
      )
    }
    return spaceFromRow(row)
  }

  private requireOwnedSpace(name: string, sessionId: SessionId): MemorySpace {
    const space = this.requireSpace(name)
    if (space.ownerSessionId !== sessionId) {
      throw new MemorySpaceError('Only the space owner can perform that operation.', 'OWNER_REQUIRED')
    }
    return space
  }

  private findConsumer(spaceId: SpaceId, sessionId: SessionId): SpaceConsumer | undefined {
    const row = this.database.prepare(`
      SELECT space_id, session_id, mode, connected_at, updated_at
      FROM space_consumers WHERE space_id = ? AND session_id = ?
    `).get(spaceId, sessionId) as unknown as ConsumerRow | undefined
    return row === undefined ? undefined : consumerFromRow(row)
  }

  private requireConsumer(spaceId: SpaceId, sessionId: SessionId): SpaceConsumer {
    const consumer = this.findConsumer(spaceId, sessionId)
    if (consumer === undefined) {
      throw new MemorySpaceError('This Session does not use that memory space.', 'USE_DENIED')
    }
    return consumer
  }

  private findSource(spaceId: SpaceId, sessionId: SessionId): SpaceSource | undefined {
    const row = this.database.prepare(`
      SELECT space_id, session_id, added_at, updated_at
      FROM space_sources WHERE space_id = ? AND session_id = ?
    `).get(spaceId, sessionId) as unknown as SourceRow | undefined
    return row === undefined ? undefined : sourceFromRow(row)
  }

  private requireSource(spaceId: SpaceId, sessionId: SessionId): SpaceSource {
    const source = this.findSource(spaceId, sessionId)
    if (source === undefined) {
      throw new MemorySpaceError('This Session is not a memory source for that space.', 'SOURCE_REQUIRED')
    }
    return source
  }

  private requireVisibility(space: MemorySpace, sessionId: SessionId): void {
    if (space.ownerSessionId === sessionId
      || this.findConsumer(space.id, sessionId) !== undefined
      || this.findSource(space.id, sessionId) !== undefined) return
    throw new MemorySpaceError('This Session has no relationship with that memory space.', 'RELATION_REQUIRED')
  }

  private ensureContributionSource(space: MemorySpace, sessionId: SessionId): void {
    if (this.findSource(space.id, sessionId) !== undefined) return
    if (space.ownerSessionId !== sessionId) {
      throw new MemorySpaceError('This Session is not a memory source for that space.', 'SOURCE_REQUIRED')
    }
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO space_sources (space_id, session_id, added_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(space.id, sessionId, now, now)
  }

  private removeSourcesInternal(
    space: MemorySpace,
    sessionIds: readonly SessionId[],
    disposition: LeaveDisposition,
  ): RemoveSourcesResult {
    const now = Date.now()
    return this.transaction(() => {
      let changedMemoryVersions = 0
      const deleteSource = this.database.prepare(`
        DELETE FROM space_sources WHERE space_id = ? AND session_id = ?
      `)
      const deleteSources = this.database.prepare('DELETE FROM memory_source_messages WHERE memory_id = ?')
      for (const sessionId of sessionIds) {
        switch (disposition) {
          case 'retain':
            break
          case 'delete_contributions':
            changedMemoryVersions += Number(this.database.prepare(`
              UPDATE memories
              SET status = 'deleted', updated_at = ?
              WHERE space_id = ? AND source_session_id = ? AND status != 'deleted'
            `).run(now, space.id, sessionId).changes)
            break
          case 'clear_provenance': {
            const ids = this.database.prepare(`
              SELECT id FROM memories WHERE space_id = ? AND source_session_id = ?
            `).all(space.id, sessionId) as unknown as Array<{ id: string }>
            changedMemoryVersions += ids.length
            this.database.prepare(`
              UPDATE memories SET
                source_session_id = NULL,
                source_session_title = NULL,
                source_seq_start = NULL,
                source_seq_end = NULL,
                provenance_cleared = 1,
                updated_at = ?
              WHERE space_id = ? AND source_session_id = ?
            `).run(now, space.id, sessionId)
            for (const row of ids) deleteSources.run(row.id)
            break
          }
          default:
            assertNever(disposition)
        }
        deleteSource.run(space.id, sessionId)
      }
      return { removedSources: sessionIds.length, changedMemoryVersions }
    })
  }

  private findActiveDuplicate(
    spaceId: SpaceId,
    sourceSessionId: SessionId,
    contentHash: string,
  ): SharedMemory | undefined {
    const row = this.database.prepare(`${memorySelect()}
      WHERE m.space_id = ? AND m.source_session_id = ?
        AND m.content_hash = ? AND m.status = 'active'
    `).get(spaceId, sourceSessionId, contentHash) as unknown as MemoryRow | undefined
    return row === undefined ? undefined : this.hydrateMemory(row)
  }

  private requireMemory(id: MemoryId): SharedMemory {
    this.expireDueMemories()
    const row = this.database.prepare(`${memorySelect()} WHERE m.id = ?`)
      .get(id) as unknown as MemoryRow | undefined
    if (row === undefined) throw new MemorySpaceError('That memory version does not exist.', 'MEMORY_NOT_FOUND')
    return this.hydrateMemory(row)
  }

  private requireManageableMemory(id: string, sessionId: SessionId): SharedMemory {
    const memory = this.requireMemory(id as MemoryId)
    const space = this.requireSpaceById(memory.spaceId)
    if (space.ownerSessionId !== sessionId
      && (memory.sourceSessionId !== sessionId || this.findSource(space.id, sessionId) === undefined)) {
      throw new MemorySpaceError('Only the space owner or a connected source Session can manage this memory.', 'OWNER_REQUIRED')
    }
    return memory
  }

  private assertLatestVersion(memory: SharedMemory): void {
    const row = this.database.prepare(`
      SELECT id FROM memories
      WHERE version_root_id = ?
      ORDER BY version_number DESC, created_at DESC, rowid DESC
      LIMIT 1
    `).get(memory.versionRootId) as unknown as { id: string } | undefined
    if (row?.id !== memory.id) {
      throw new MemorySpaceError('Only the latest memory version can be reactivated or revised.', 'INVALID_INPUT')
    }
  }

  private requireSpaceById(id: SpaceId): MemorySpace {
    const row = this.database.prepare(`
      SELECT id, name, owner_session_id, created_at, updated_at FROM memory_spaces WHERE id = ?
    `).get(id) as unknown as SpaceRow | undefined
    if (row === undefined) throw new MemorySpaceError('That memory space no longer exists.', 'SPACE_NOT_FOUND')
    return spaceFromRow(row)
  }

  private hydrateMemory(row: MemoryRow): SharedMemory {
    const sourceRows = this.database.prepare(`
      SELECT memory_id, seq, role, excerpt
      FROM memory_source_messages WHERE memory_id = ? ORDER BY seq
    `).all(row.id) as unknown as SourceMessageRow[]
    const usageRows = this.database.prepare(`
      SELECT target_session_id, response_seq, used_at
      FROM memory_usages WHERE memory_id = ? AND response_seq IS NOT NULL
      ORDER BY used_at DESC LIMIT ?
    `).all(row.id, MAX_RECENT_USAGES) as unknown as UsageRow[]
    return memoryFromRow(row, sourceRows, usageRows)
  }

  private insertSourceMessages(memoryId: MemoryId, messages: readonly MemorySourceMessage[]): void {
    const insert = this.database.prepare(`
      INSERT INTO memory_source_messages (memory_id, seq, role, excerpt) VALUES (?, ?, ?, ?)
    `)
    for (const message of messages) insert.run(memoryId, message.seq, message.role, message.excerpt)
  }

  private insertConversationSnapshot(
    shareLinkId: ShareLinkId,
    input: { sourceSessionId: SessionId; sourceSeqStart: number; sourceSeqEnd: number },
    title: string,
    content: string,
    createdAt: number,
  ): string {
    assertSeqRange(input.sourceSeqStart, input.sourceSeqEnd)
    const id = randomUUID()
    this.database.prepare(`
      INSERT INTO shared_conversation_snapshots (
        id, share_link_id, source_session_id, source_seq_start, source_seq_end,
        title, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, shareLinkId, input.sourceSessionId, input.sourceSeqStart, input.sourceSeqEnd,
      title, content, createdAt,
    )
    return id
  }

  private requireConversationSnapshot(id: string): SharedConversationSnapshot {
    const row = this.database.prepare(`
      SELECT id, share_link_id, source_session_id, source_seq_start, source_seq_end,
        title, content, created_at
      FROM shared_conversation_snapshots WHERE id = ?
    `).get(id) as unknown as SnapshotRow | undefined
    if (row === undefined) throw new Error('memory-spaces: inserted conversation snapshot is missing')
    return snapshotFromRow(row)
  }

  private requireShareLink(id: ShareLinkId): ShareLinkView {
    const row = this.database.prepare(`
      SELECT id, created_by_session_id, expires_at, max_uses, use_count, revoked_at, created_at
      FROM share_links WHERE id = ?
    `).get(id) as unknown as ShareLinkRow | undefined
    if (row === undefined) throw new Error('memory-spaces: inserted share link is missing')
    return shareLinkFromRow(row)
  }

  private requireShareLinkByToken(token: string, purpose: 'access' | 'edit'): ShareLinkRow {
    const normalized = normalizeShareToken(token)
    const column = purpose === 'access' ? 'access_token_hash' : 'edit_token_hash'
    const row = this.database.prepare(`
      SELECT id, created_by_session_id, expires_at, max_uses, use_count, revoked_at, created_at
      FROM share_links WHERE ${column} = ?
    `).get(tokenHash(normalized)) as unknown as ShareLinkRow | undefined
    if (row === undefined) {
      throw new MemorySpaceError('That read-only link is invalid or unavailable.', 'INVALID_INPUT')
    }
    return row
  }

  private assertUsableShare(row: ShareLinkRow, enforceUseLimit: boolean): void {
    if (row.revoked_at !== null) throw new MemorySpaceError('That link has been revoked.', 'INVALID_INPUT')
    if (Date.now() >= row.expires_at) throw new MemorySpaceError('That link has expired.', 'INVALID_INPUT')
    if (enforceUseLimit && row.use_count >= row.max_uses) {
      throw new MemorySpaceError('That link has reached its use limit.', 'INVALID_INPUT')
    }
  }

  private consumeShareLink(token: string): ShareLinkRow {
    return this.transaction(() => {
      const row = this.requireShareLinkByToken(token, 'access')
      this.assertUsableShare(row, true)
      const result = this.database.prepare(`
        UPDATE share_links SET use_count = use_count + 1
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
      `).run(row.id, Date.now())
      if (result.changes !== 1) {
        throw new MemorySpaceError('That link became unavailable before it could be opened.', 'INVALID_INPUT')
      }
      return { ...row, use_count: row.use_count + 1 }
    })
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error: unknown) {
      try {
        this.database.exec('ROLLBACK')
      } catch {
        // SQLite close or transaction loss is secondary to the original failure.
      }
      throw error
    }
  }

  private expireDueMemories(now = Date.now()): number {
    return Number(this.database.prepare(`
      UPDATE memories SET status = 'expired', updated_at = ?
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(now, now).changes)
  }
}

function memorySelect(): string {
  return `
    SELECT m.id, m.space_id, s.name AS space_name, m.version_root_id,
      m.version_number, m.previous_version_id, m.superseded_by_id, m.status,
      m.source_session_id, m.source_session_title, m.source_seq_start,
      m.source_seq_end, m.creation_method, m.provenance_cleared, m.type,
      m.content, m.created_at, m.updated_at, m.expires_at
    FROM memories m
    JOIN memory_spaces s ON s.id = m.space_id
  `
}

function resolveDatabasePath(databasePath: string): string {
  return resolveProfileDatabasePath(databasePath)
}

function normalizeSpaceName(name: string): string {
  const normalized = name.normalize('NFKC').trim()
  const length = [...normalized].length
  if (length === 0 || length > MAX_SPACE_NAME_CODE_POINTS) {
    throw new MemorySpaceError(
      `Memory space names must contain 1-${MAX_SPACE_NAME_CODE_POINTS} Unicode code points.`,
      'INVALID_INPUT',
    )
  }
  return normalized
}

function normalizeMemoryUseMode(mode: MemoryUseMode): MemoryUseMode {
  if (MEMORY_USE_MODES.includes(mode)) return mode
  throw new MemorySpaceError('The selected memory-use mode is invalid.', 'INVALID_INPUT')
}

function normalizeTargetSessionIds(values: readonly SessionId[]): SessionId[] {
  const unique = [...new Set(values)]
  if (unique.length === 0 || unique.length > MAX_BATCH_SESSION_IDS
    || unique.some(value => typeof value !== 'string' || value.trim().length === 0)) {
    throw new MemorySpaceError(`Select between 1 and ${String(MAX_BATCH_SESSION_IDS)} Session members.`, 'INVALID_INPUT')
  }
  return unique
}

function normalizeMemoryType(type: MemoryType): MemoryType {
  if (MEMORY_TYPES.includes(type)) return type
  throw new MemorySpaceError('The memory type is invalid.', 'INVALID_INPUT')
}

function normalizeMemoryStatus(status: MemoryStatus): MemoryStatus {
  if (MEMORY_STATUSES.includes(status)) return status
  throw new MemorySpaceError('The memory lifecycle state is invalid.', 'INVALID_INPUT')
}

function normalizeCreationMethod(method: MemoryCreationMethod): MemoryCreationMethod {
  if (method === 'manual' || method === 'model_extracted') return method
  throw new MemorySpaceError('The memory creation method is invalid.', 'INVALID_INPUT')
}

function normalizeMemoryContent(content: string, maxBytes: number): string {
  const normalized = content.trim()
  if (normalized.length === 0) throw new MemorySpaceError('Memory content must not be empty.', 'INVALID_INPUT')
  const bytes = Buffer.byteLength(normalized, 'utf8')
  if (bytes > maxBytes) {
    throw new MemorySpaceError(
      `Memory content is ${bytes} UTF-8 bytes; the maximum is ${maxBytes}.`,
      'INVALID_INPUT',
    )
  }
  return normalized
}

function normalizeSource(input: Pick<
  RememberInput,
  'sourceSessionTitle' | 'sourceSeqStart' | 'sourceSeqEnd' | 'sourceMessages'
>): { title: string | null; seqStart: number | null; seqEnd: number | null; messages: MemorySourceMessage[] } {
  const start = input.sourceSeqStart
  const end = input.sourceSeqEnd
  if ((start === undefined) !== (end === undefined)) {
    throw new MemorySpaceError('Source event range must supply both start and end.', 'INVALID_INPUT')
  }
  if (start !== undefined && end !== undefined) assertSeqRange(start, end)
  return {
    title: normalizeOptionalTitle(input.sourceSessionTitle),
    seqStart: start ?? null,
    seqEnd: end ?? null,
    messages: normalizeSourceMessages(input.sourceMessages ?? []),
  }
}

function normalizeSourceMessages(messages: readonly MemorySourceMessage[]): MemorySourceMessage[] {
  const seen = new Set<number>()
  const normalized: MemorySourceMessage[] = []
  for (const message of messages) {
    if (!Number.isSafeInteger(message.seq) || message.seq < 0 || seen.has(message.seq)) {
      throw new MemorySpaceError('Source message sequence values must be unique non-negative integers.', 'INVALID_INPUT')
    }
    if (!['user', 'assistant', 'tool', 'summary', 'context'].includes(message.role)) {
      throw new MemorySpaceError('A source message role is invalid.', 'INVALID_INPUT')
    }
    const excerpt = retainUtf8Prefix(message.excerpt.trim(), MAX_SOURCE_EXCERPT_BYTES)
    if (excerpt.length === 0) continue
    seen.add(message.seq)
    normalized.push({ seq: message.seq, role: message.role, excerpt })
  }
  return normalized.sort((left, right) => left.seq - right.seq)
}

function normalizeOptionalTitle(value: string | undefined): string | null {
  if (value === undefined) return null
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length === 0) return null
  return retainUtf8Prefix(normalized, 512)
}

function normalizeExpiry(value: number | undefined): number | null {
  if (value === undefined) return null
  if (!Number.isSafeInteger(value) || value <= Date.now()) {
    throw new MemorySpaceError('Memory expiry must be a future epoch millisecond.', 'INVALID_INPUT')
  }
  return value
}

function normalizeLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5_000) {
    throw new MemorySpaceError('List limit must be an integer from 1 through 5000.', 'INVALID_INPUT')
  }
  return limit
}

function assertSeqRange(start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new MemorySpaceError('The source event range is invalid.', 'INVALID_INPUT')
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function spaceFromRow(row: SpaceRow): MemorySpace {
  return {
    id: row.id as SpaceId,
    name: row.name,
    ownerSessionId: row.owner_session_id as SessionId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function requiredDatabaseValue<T>(value: T | null, field: string): T {
  if (value === null) throw new Error(`memory-spaces database row is missing ${field}`)
  return value
}

function consumerFromRow(row: ConsumerRow): SpaceConsumer {
  return {
    spaceId: row.space_id as SpaceId,
    sessionId: row.session_id as SessionId,
    mode: normalizePersistedMemoryUseMode(row.mode),
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  }
}

function sourceFromRow(row: SourceRow): SpaceSource {
  return {
    spaceId: row.space_id as SpaceId,
    sessionId: row.session_id as SessionId,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  }
}

function sessionSpaceFromRow(row: SessionSpaceRow): SessionSpaceView {
  return {
    space: spaceFromRow(row),
    ...(row.consumer_space_id === null ? {} : { consumer: consumerFromRow({
      space_id: row.consumer_space_id,
      session_id: requiredDatabaseValue(row.consumer_session_id, 'consumer session id'),
      mode: requiredDatabaseValue(row.consumer_mode, 'consumer mode'),
      connected_at: requiredDatabaseValue(row.consumer_connected_at, 'consumer connected time'),
      updated_at: requiredDatabaseValue(row.consumer_updated_at, 'consumer updated time'),
    }) }),
    ...(row.source_space_id === null ? {} : { source: sourceFromRow({
      space_id: row.source_space_id,
      session_id: requiredDatabaseValue(row.source_session_id, 'source session id'),
      added_at: requiredDatabaseValue(row.source_added_at, 'source added time'),
      updated_at: requiredDatabaseValue(row.source_updated_at, 'source updated time'),
    }) }),
    activeMemoryCount: row.active_memory_count,
    contributionCount: row.contribution_count,
  }
}

function spaceSourceViewFromRow(row: SpaceSourceRow): SpaceSourceView {
  return {
    source: sourceFromRow(row),
    isOwner: row.session_id === row.owner_session_id,
    contributionCount: row.contribution_count,
    nonDeletedContributionCount: row.non_deleted_contribution_count,
    ...(row.last_contribution_at === null ? {} : { lastContributionAt: row.last_contribution_at }),
  }
}

function spaceConsumerViewFromRow(row: SpaceConsumerRow): SpaceConsumerView {
  return {
    consumer: consumerFromRow(row),
    isOwner: row.session_id === row.owner_session_id,
    ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at }),
  }
}

function memoryFromRow(
  row: MemoryRow,
  sourceRows: readonly SourceMessageRow[],
  usageRows: readonly UsageRow[],
): SharedMemory {
  return {
    id: row.id as MemoryId,
    spaceId: row.space_id as SpaceId,
    spaceName: row.space_name,
    versionRootId: row.version_root_id as MemoryId,
    versionNumber: row.version_number,
    ...(row.previous_version_id === null ? {} : { previousVersionId: row.previous_version_id as MemoryId }),
    ...(row.superseded_by_id === null ? {} : { supersededById: row.superseded_by_id as MemoryId }),
    status: normalizePersistedMemoryStatus(row.status),
    ...(row.source_session_id === null ? {} : { sourceSessionId: row.source_session_id as SessionId }),
    ...(row.source_session_title === null ? {} : { sourceSessionTitle: row.source_session_title }),
    ...(row.source_seq_start === null ? {} : { sourceSeqStart: row.source_seq_start }),
    ...(row.source_seq_end === null ? {} : { sourceSeqEnd: row.source_seq_end }),
    creationMethod: normalizePersistedCreationMethod(row.creation_method),
    sourceMessages: sourceRows.map(sourceMessageFromRow),
    provenanceCleared: row.provenance_cleared === 1,
    type: normalizePersistedMemoryType(row.type),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    recentUsages: usageRows.map(row => ({
      targetSessionId: row.target_session_id as SessionId,
      ...(row.response_seq === null ? {} : { responseSeq: row.response_seq }),
      usedAt: row.used_at,
    })),
    ...(row.score === undefined ? {} : { score: row.score }),
  }
}

function sourceMessageFromRow(row: SourceMessageRow): MemorySourceMessage {
  if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'tool'
    && row.role !== 'summary' && row.role !== 'context') {
    throw new Error(`memory-spaces database contains unsupported source role ${JSON.stringify(row.role)}`)
  }
  return { seq: row.seq, role: row.role, excerpt: row.excerpt }
}

function normalizePersistedMemoryUseMode(value: string): MemoryUseMode {
  if (MEMORY_USE_MODES.includes(value as MemoryUseMode)) return value as MemoryUseMode
  throw new Error(`memory-spaces database contains unsupported use mode ${JSON.stringify(value)}`)
}

function normalizePersistedMemoryStatus(value: string): MemoryStatus {
  if (MEMORY_STATUSES.includes(value as MemoryStatus)) return value as MemoryStatus
  throw new Error(`memory-spaces database contains unsupported status ${JSON.stringify(value)}`)
}

function normalizePersistedCreationMethod(value: string): MemoryCreationMethod {
  if (value === 'manual' || value === 'model_extracted') return value
  throw new Error(`memory-spaces database contains unsupported creation method ${JSON.stringify(value)}`)
}

function normalizePersistedMemoryType(value: string): MemoryType {
  if (MEMORY_TYPES.includes(value as MemoryType)) return value as MemoryType
  throw new Error(`memory-spaces database contains unsupported memory type ${JSON.stringify(value)}`)
}

function shareLinkFromRow(row: ShareLinkRow): ShareLinkView {
  return {
    id: row.id as ShareLinkId,
    createdBySessionId: row.created_by_session_id as SessionId,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    createdAt: row.created_at,
  }
}

function snapshotFromRow(row: SnapshotRow): SharedConversationSnapshot {
  return {
    id: row.id,
    shareLinkId: row.share_link_id as ShareLinkId,
    sourceSessionId: row.source_session_id as SessionId,
    sourceSeqStart: row.source_seq_start,
    sourceSeqEnd: row.source_seq_end,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
  }
}

function shareToken(): string {
  return randomBytes(32).toString('base64url')
}

function normalizeShareToken(token: string): string {
  const normalized = token.trim()
  if (!/^[A-Za-z0-9_-]{43}$/u.test(normalized)) {
    throw new MemorySpaceError('The read-only link token is malformed.', 'INVALID_INPUT')
  }
  return normalized
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function assertShareLimits(expiresAt: number, maxUses: number): void {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new MemorySpaceError('Share-link expiry must be a future epoch millisecond.', 'INVALID_INPUT')
  }
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 10_000) {
    throw new MemorySpaceError('Share-link maxUses must be an integer from 1 through 10000.', 'INVALID_INPUT')
  }
}

function normalizeSnapshotTitle(value: string): string {
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length === 0 || [...normalized].length > 160) {
    throw new MemorySpaceError('Shared conversation titles must contain 1-160 Unicode code points.', 'INVALID_INPUT')
  }
  return normalized
}

function normalizeSnapshotContent(value: string, maxBytes: number): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new MemorySpaceError('A shared conversation snapshot must not be empty.', 'INVALID_INPUT')
  }
  const bytes = Buffer.byteLength(normalized, 'utf8')
  if (bytes > maxBytes) {
    throw new MemorySpaceError(
      `The shared conversation snapshot is ${bytes} UTF-8 bytes; the maximum is ${maxBytes}.`,
      'INVALID_INPUT',
    )
  }
  return normalized
}

function buildFtsQuery(query: string): string | undefined {
  const terms: string[] = []
  const seen = new Set<string>()
  const segments = query.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []
  for (const segment of segments) {
    const codePoints = [...segment.toLocaleLowerCase()]
    const candidates = /\p{Script=Han}/u.test(segment) && codePoints.length > 3
      ? Array.from({ length: codePoints.length - 2 }, (_, index) => codePoints.slice(index, index + 3).join(''))
      : [codePoints.join('')]
    for (const candidate of candidates) {
      if ([...candidate].length < 3 || seen.has(candidate)) continue
      seen.add(candidate)
      terms.push(candidate)
      if (terms.length === MAX_QUERY_TERMS) break
    }
    if (terms.length === MAX_QUERY_TERMS) break
  }
  if (terms.length === 0) return undefined
  return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function retainUtf8Prefix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let bytes = 0
  let retained = ''
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    retained += character
    bytes += size
  }
  return retained
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/u.test(error.message)
}

function assertNever(value: never): never {
  throw new Error(`memory-spaces: unsupported closed value ${JSON.stringify(value)}`)
}
