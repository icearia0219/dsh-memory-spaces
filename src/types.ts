/** Public records used by the human-governed memory-space store and UI. */

import type { SessionId } from '@deepseek-ai/dsh-session'

declare const spaceIdBrand: unique symbol
declare const memoryIdBrand: unique symbol
declare const shareLinkIdBrand: unique symbol

/** Opaque identity of one shared memory space. */
export type SpaceId = string & { readonly [spaceIdBrand]: true }

/** Opaque identity of one memory version. */
export type MemoryId = string & { readonly [memoryIdBrand]: true }

/** Opaque identity of one read-only conversation link. */
export type ShareLinkId = string & { readonly [shareLinkIdBrand]: true }

/** How one Session uses a space while composing answers. */
export type MemoryUseMode = 'automatic' | 'confirm' | 'paused'

/** Lifecycle state controlling whether one memory version may be recalled. */
export type MemoryStatus = 'active' | 'superseded' | 'disputed' | 'expired' | 'deleted'

/** How the stored content was produced. */
export type MemoryCreationMethod = 'manual' | 'model_extracted'

/** Closed memory categories supported by the local plugin. */
export type MemoryType =
  | 'fact'
  | 'decision'
  | 'constraint'
  | 'preference'
  | 'task'
  | 'artifact'
  | 'issue'
  | 'solution'
  | 'temporary'

/** One named shared-memory container. */
export interface MemorySpace {
  id: SpaceId
  name: string
  ownerSessionId: SessionId
  createdAt: number
  updatedAt: number
}

/** One Session that may receive memories from a space. */
export interface SpaceConsumer {
  spaceId: SpaceId
  sessionId: SessionId
  mode: MemoryUseMode
  connectedAt: number
  updatedAt: number
}

/** One Session whose explicitly saved or imported content may enter a space. */
export interface SpaceSource {
  spaceId: SpaceId
  sessionId: SessionId
  addedAt: number
  updatedAt: number
}

/** One exact source message retained for provenance inspection. */
export interface MemorySourceMessage {
  seq: number
  role: 'user' | 'assistant' | 'tool' | 'summary' | 'context'
  excerpt: string
}

/** One answer that received a memory version. */
export interface MemoryUsage {
  targetSessionId: SessionId
  responseSeq?: number
  usedAt: number
}

/** Provenance-bearing, versioned memory returned by listing or retrieval. */
export interface SharedMemory {
  id: MemoryId
  spaceId: SpaceId
  spaceName: string
  versionRootId: MemoryId
  versionNumber: number
  previousVersionId?: MemoryId
  supersededById?: MemoryId
  status: MemoryStatus
  sourceSessionId?: SessionId
  sourceSessionTitle?: string
  sourceSeqStart?: number
  sourceSeqEnd?: number
  creationMethod: MemoryCreationMethod
  sourceMessages: MemorySourceMessage[]
  provenanceCleared: boolean
  type: MemoryType
  content: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
  recentUsages: MemoryUsage[]
  score?: number
}

/** A memory creation attempt and whether it added a new record. */
export interface RememberResult {
  memory: SharedMemory
  created: boolean
}

/** A generated session-summary write and the number of earlier versions it superseded. */
export interface HistorySummaryWriteResult extends RememberResult {
  replacedSummaries: number
}

/** A space visible through ownership, contribution, or use. */
export interface SessionSpaceView {
  space: MemorySpace
  consumer?: SpaceConsumer
  source?: SpaceSource
  activeMemoryCount: number
  contributionCount: number
}

/** One source Session exposed in the space-level management view. */
export interface SpaceSourceView {
  source: SpaceSource
  isOwner: boolean
  contributionCount: number
  nonDeletedContributionCount: number
  lastContributionAt?: number
}

/** One consuming Session exposed in the space-level management view. */
export interface SpaceConsumerView {
  consumer: SpaceConsumer
  isOwner: boolean
  lastUsedAt?: number
}

/** Result of one user-confirmed source removal. */
export interface RemoveSourcesResult {
  removedSources: number
  changedMemoryVersions: number
}

/** Result of one user-confirmed consumer removal. */
export interface RemoveConsumersResult {
  removedConsumers: number
}

/** Exit results exposed by the confirmation UI. */
export type LeaveDisposition = 'retain' | 'delete_contributions' | 'clear_provenance'

/** Safe metadata for a read-only conversation link; raw tokens are returned only at creation. */
export interface ShareLinkView {
  id: ShareLinkId
  createdBySessionId: SessionId
  expiresAt: number
  maxUses: number
  useCount: number
  revokedAt?: number
  createdAt: number
}

/** Exact, sanitized conversation text carried by a read-only link. */
export interface SharedConversationSnapshot {
  id: string
  shareLinkId: ShareLinkId
  sourceSessionId: SessionId
  sourceSeqStart: number
  sourceSeqEnd: number
  title: string
  content: string
  createdAt: number
}

/** Snapshot-link metadata shown before and after opening a link. */
export interface ConversationShareInspection {
  link: ShareLinkView
}

/** Snapshot payload returned after one bearer-link use is consumed. */
export interface OpenedConversationShare extends ConversationShareInspection {
  snapshots: SharedConversationSnapshot[]
}

/** Complete governance view used by the memory-space dialog. */
export interface MemoryGovernanceState {
  spaces: SessionSpaceView[]
  ownedSpaces: MemorySpace[]
  sources: SpaceSourceView[]
  consumers: SpaceConsumerView[]
  memories: SharedMemory[]
}

/** One pre-send injection preview and the exact manual choices available. */
export interface MemoryInjectionPreview {
  query: string
  memories: SharedMemory[]
  confirmCandidates: SharedMemory[]
  estimatedTokens: number
  renderedBytes: number
}
