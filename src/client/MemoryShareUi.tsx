/** Human-governed memory sources, consuming Sessions, provenance, previews, and read-only snapshots. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, IconCheckOutline14, IconCopyOutline16, IconLinkOutline16, IconShareOutline16,
  IconWarningOutline16, Input, Modal, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LeaveDisposition, MemoryGovernanceState, MemoryInjectionPreview, MemoryStatus, MemoryType,
  MemoryUseMode, SessionSpaceView, SharedMemory, SpaceConsumerView, SpaceSourceView,
} from '../types.ts'
import { executeMemoryUi, MemoryUiRequestError } from './memory-ui-client.ts'
import { executeShare, randomBearerToken, ShareRequestError } from './share-client.ts'
import { connectSelectedSessions } from './session-connection.ts'
import { MemoryShareController, type SelectedSession } from './share-controller.ts'
import css from './MemoryShareUi.module.css'

interface MemoryWorkspaceSessionOwnerProps {
  readonly sessionId: SessionId
  readonly title: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional leading content for one Session row in newer DSH builds. */
    'sidebar.workspaces.session.leading': {
      kind: 'list'
      scope: 'root'
      owner: MemoryWorkspaceSessionOwnerProps
    }
    /** Browser-level controls that outlive individual Session rows in newer DSH builds. */
    'sidebar.workspaces.overlay': { kind: 'list'; scope: 'root' }
  }
}

/** Shared services supplied to all memory-space UI entries. */
export interface MemoryShareInjected {
  controller: MemoryShareController
  remote: ClientRemote
}

type Shared = InjectFace<MemoryShareInjected>
type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & Shared
type PreviewProps = PropsRuntime<'conversation.input.dock'> & Shared & { input: { readonly draft: string } }
type SidebarSessionLeadingProps = PropsRuntime<'sidebar.workspaces.session.leading'> & Shared
type SidebarOverlayProps = PropsRuntime<'sidebar.workspaces.overlay'> & Shared

const MEMORY_TYPE_OPTIONS = [
  ['fact', '事实'], ['decision', '决策'], ['constraint', '约束'], ['preference', '偏好'],
  ['task', '任务'], ['artifact', '产物'], ['issue', '问题'], ['solution', '方案'],
  ['temporary', '临时信息'],
] as const satisfies readonly (readonly [MemoryType, string])[]
const MEMORY_USE_MODE_OPTIONS = ['automatic', 'confirm', 'paused'] as const satisfies readonly MemoryUseMode[]

interface IncomingLinkView { link: { expiresAt: number; maxUses: number; useCount: number } }
interface OpenSnapshotView { snapshots: ReadonlyArray<{ title: string; content: string }> }

function useShare(controller: MemoryShareController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}

/** Checkbox that adds one visible sidebar Session to a user-controlled batch. */
export function MemorySidebarSessionLeading({ controller, sessionId, title }: SidebarSessionLeadingProps) {
  const selected = useShare(controller).sidebarSessions[sessionId] !== undefined
  return <input
    className={css.rowCheckbox}
    type="checkbox"
    checked={selected}
    aria-label={`${selected ? '取消选择' : '选择'}会话“${title}”`}
    data-memory-session-select={sessionId}
    onClick={event => { event.stopPropagation() }}
    onPointerDown={event => { event.stopPropagation() }}
    onChange={() => { controller.toggleSession({ sessionId, title }) }}
  />
}

/** Persistent action tray for creating a memory space from selected sidebar Sessions. */
export function MemorySidebarSelectionTray({ controller }: SidebarOverlayProps) {
  const selected = Object.values(useShare(controller).sidebarSessions)
  if (selected.length === 0) return null
  return <aside className={css.selectionTray} data-memory-session-selection role="status" aria-live="polite">
    <div className={css.selectionSummary}><strong>已选择 {selected.length} 个会话</strong><span>{selected.length < 2 ? '请再选择至少一个会话' : `“${selected[0]?.title ?? ''}”将作为空间所有者`}</span></div>
    <div className={css.trayActions}><Button size="sm" variant="ghost" onClick={() => { controller.clear() }}>取消选择</Button><Button size="sm" variant="primary" disabled={selected.length < 2} onClick={() => { controller.openNewSpaceFromSelection() }}>新建记忆空间</Button></div>
  </aside>
}

function currentSession(useSessions: HeaderProps['useSessions'], sessionId: SessionId): SelectedSession {
  const title = useSessions(state => state.byId[sessionId]?.displayTitle) ?? String(sessionId)
  return { sessionId, title }
}

/** Open the current Session's memory governance panel and host plugin-owned dialogs. */
export function MemoryShareHeaderButton({
  controller, remote, sessionId, useSession, useSessions, useWorkspaces,
}: HeaderProps) {
  const session = currentSession(useSessions, sessionId)
  const nodes = useSession(snapshot => snapshot.nodes)
  return <>
    <button className={css.headerButton} type="button" data-memory-spaces-open onClick={() => { controller.open(session) }}><span className={css.memoryMark}>M</span>记忆空间</button>
    <MemoryShareOverlay controller={controller} remote={remote} nodes={nodes} useSessions={useSessions} useWorkspaces={useWorkspaces} />
  </>
}

/** Exact shared-memory set staged for the next submitted draft. */
export function MemoryInjectionPreview({ remote, sessionId, input }: PreviewProps) {
  const query = input.draft.trim()
  const [preview, setPreview] = useState<MemoryInjectionPreview | null>(null)
  const [disabledIds, setDisabledIds] = useState<readonly string[]>([])
  const [includedIds, setIncludedIds] = useState<readonly string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)

  useEffect(() => {
    setDisabledIds([]); setIncludedIds([]); setExpanded(false); setError('')
    if (query === '') { setPreview(null); return }
    const ticket = ++request.current
    const timer = window.setTimeout(() => {
      void executeMemoryUi<MemoryInjectionPreview>(remote, sessionId, 'preview', { query, disabledIds: [], includedIds: [] }).then(value => { if (ticket === request.current) setPreview(value) }, caught => { if (ticket === request.current) setError(messageOf(caught)) })
    }, 300)
    return () => { window.clearTimeout(timer) }
  }, [query, remote, sessionId])

  const update = (nextDisabled: readonly string[], nextIncluded: readonly string[]): void => {
    setDisabledIds(nextDisabled); setIncludedIds(nextIncluded)
    const ticket = ++request.current
    void executeMemoryUi<MemoryInjectionPreview>(remote, sessionId, 'preview', { query, disabledIds: nextDisabled, includedIds: nextIncluded }).then(value => { if (ticket === request.current) { setPreview(value); setError('') } }, caught => { if (ticket === request.current) setError(messageOf(caught)) })
  }
  if (query === '' || (preview === null && error === '')) return null
  const spaceNames = preview === null ? [] : [...new Set(preview.memories.map(memory => memory.spaceName))]
  return (
    <section className={css.preview} aria-label="共享记忆注入预览" data-memory-preview-count={preview?.memories.length} data-memory-preview-tokens={preview?.estimatedTokens}>
      <button className={css.previewSummary} type="button" data-memory-preview-toggle onClick={() => { setExpanded(value => !value) }}>
        <span className={css.previewIndicator} />
        {preview === null ? '共享记忆预览暂不可用' : <>本轮从{spaceNames.length === 0 ? '共享空间' : `「${spaceNames.join('」「')}」`}检索到 <strong>{preview.memories.length}</strong> 条记忆 · 预计 <strong>{preview.estimatedTokens}</strong> tokens</>}
        <span className={css.previewToggle}>{expanded ? '收起' : '查看并调整'}</span>
      </button>
      {expanded && preview !== null && <div className={css.previewBody}>
        {preview.memories.length === 0 && <p className={css.empty}>没有自动注入的记忆。</p>}
        {preview.memories.map(memory => <label className={css.previewItem} key={memory.id}><input type="checkbox" data-memory-preview-item={memory.id} checked={!disabledIds.includes(memory.id)} onChange={event => { const next = event.currentTarget.checked ? disabledIds.filter(id => id !== memory.id) : [...disabledIds, memory.id]; update(next, includedIds) }} /><span><strong>{memory.spaceName}</strong>{memory.content}</span></label>)}
        {preview.confirmCandidates.length > 0 && <div className={css.manualCandidates}><h4>发送前确认</h4>{preview.confirmCandidates.map(memory => <label className={css.previewItem} key={memory.id}><input type="checkbox" checked={includedIds.includes(memory.id)} onChange={event => { const next = event.currentTarget.checked ? [...includedIds, memory.id] : includedIds.filter(id => id !== memory.id); update(disabledIds, next) }} /><span><strong>{memory.spaceName}</strong>{memory.content}</span></label>)}</div>}
      </div>}
      {error !== '' && <p className={css.previewError} role="alert">{error}</p>}
    </section>
  )
}

interface MemoryShareOverlayProps extends Shared {
  readonly nodes: readonly ConversationNode[]
  readonly useSessions: HeaderProps['useSessions']
  readonly useWorkspaces: HeaderProps['useWorkspaces']
}

/** Plugin-owned dialogs mounted beside the official Session-header entry. */
function MemoryShareOverlay({
  controller, remote, nodes, useSessions, useWorkspaces,
}: MemoryShareOverlayProps) {
  const state = useShare(controller)
  const current = useSessions(snapshot => snapshot.current)
  const [incoming, setIncoming] = useState<{ token: string; view: IncomingLinkView } | null>(null)
  const [incomingBusy, setIncomingBusy] = useState(false)
  const [incomingError, setIncomingError] = useState('')
  const [opened, setOpened] = useState<OpenSnapshotView | null>(null)

  useEffect(() => {
    if (current === undefined) return
    const url = new URL(window.location.href)
    const token = url.searchParams.get('memorySnapshot')
    if (token === null) return
    url.searchParams.delete('memorySnapshot')
    window.history.replaceState(null, '', url)
    let active = true
    void executeShare(remote, current, 'inspect', { token }).then(value => { if (active) setIncoming({ token, view: value as IncomingLinkView }) }, caught => { if (active) setIncomingError(messageOf(caught)) })
    return () => { active = false }
  }, [current, remote])

  const dismissIncoming = (): void => {
    const url = new URL(window.location.href)
    url.searchParams.delete('memorySnapshot'); url.searchParams.delete('memoryInvite')
    window.history.replaceState(null, '', url)
    setIncoming(null); setOpened(null); setIncomingError('')
  }
  const openIncoming = async (): Promise<void> => {
    if (incoming === null || current === undefined) return
    setIncomingBusy(true); setIncomingError('')
    try { setOpened(await executeShare(remote, current, 'open-conversation', { token: incoming.token }) as OpenSnapshotView); setIncoming(null) }
    catch (caught) { setIncomingError(messageOf(caught)) }
    finally { setIncomingBusy(false) }
  }
  return <>
    {state.dialog?.kind === 'manage' && state.dialog.sessions[0] !== undefined && <GovernanceDialog key={state.dialog.sessions[0].sessionId} controller={controller} remote={remote} session={state.dialog.sessions[0]} useSessions={useSessions} useWorkspaces={useWorkspaces} />}
    {state.dialog?.kind === 'connect' && state.dialog.sessions[0] !== undefined && <ConnectDialog controller={controller} remote={remote} governing={state.dialog.sessions[0]} initialSessions={state.dialog.sessions} preferredSpaceName={state.dialog.spaceName} createNew={state.dialog.createNew ?? false} useSessions={useSessions} useWorkspaces={useWorkspaces} />}
    {state.dialog?.kind === 'snapshot' && state.dialog.sessions[0] !== undefined && <SnapshotDialog controller={controller} remote={remote} session={state.dialog.sessions[0]} nodes={nodes} selectedMessages={state.messages} />}
    <Modal open={incoming !== null || incomingError !== ''} onClose={dismissIncoming} title="打开只读会话快照" description="此链接只提供所选对话的只读副本，不会成为记忆来源，也不会让会话使用空间记忆。" footer={incoming === null ? <Button variant="primary" onClick={dismissIncoming}>关闭</Button> : <><Button variant="outline" onClick={dismissIncoming}>取消</Button><Button variant="primary" disabled={incomingBusy} onClick={() => { void openIncoming() }}>查看快照</Button></>}>
      {incoming !== null && <div className={css.summaryCard}><p><strong>有效期至</strong><span>{new Date(incoming.view.link.expiresAt).toLocaleString('zh-CN')}</span></p><p><strong>已打开次数</strong><span>{incoming.view.link.useCount} / {incoming.view.link.maxUses}</span></p></div>}
      {incomingError !== '' && <p className={css.error} role="alert">{incomingError}</p>}
    </Modal>
    <Modal open={opened !== null} onClose={dismissIncoming} title="分享的对话快照" footer={<Button variant="primary" onClick={dismissIncoming}>完成</Button>} contentClassName={css.snapshotModal ?? ''}>
      {opened?.snapshots.map((snapshot, index) => <section className={css.snapshot} key={`${snapshot.title}-${index}`}><h3>{snapshot.title}</h3><pre>{snapshot.content}</pre></section>)}
    </Modal>
  </>
}

interface MemberPresentation { title: string; workspace: string }
type GovernanceMutationResult = MemoryGovernanceState | { readonly state: MemoryGovernanceState }
type GovernanceMutation = (operation: string, payload: object) => Promise<MemoryGovernanceState | undefined>

function GovernanceDialog({ controller, remote, session, useSessions, useWorkspaces }: {
  controller: MemoryShareController
  remote: ClientRemote
  session: SelectedSession
  useSessions: HeaderProps['useSessions']
  useWorkspaces: HeaderProps['useWorkspaces']
}) {
  const [state, setState] = useState<MemoryGovernanceState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>()
  const [expandedMemory, setExpandedMemory] = useState<string>()
  const [deleteSpace, setDeleteSpace] = useState<SessionSpaceView>()
  const sessionRows = useSessions(snapshot => snapshot.byId)
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  useEffect(() => { let active = true; void executeMemoryUi<MemoryGovernanceState>(remote, session.sessionId, 'state', {}).then(value => { if (active) setState(value) }, caught => { if (active) setError(messageOf(caught)) }); return () => { active = false } }, [remote, session.sessionId])
  const mutate: GovernanceMutation = async (operation, payload) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await executeMemoryUi<GovernanceMutationResult>(remote, session.sessionId, operation, payload)
      const next = 'state' in result ? result.state : result
      setState(next)
      return next
    }
    catch (caught) { setError(messageOf(caught)); return undefined }
    finally { setBusy(false) }
  }
  const create = async (): Promise<void> => {
    const normalizedName = spaceName.trim()
    if (normalizedName === '') return
    const next = await mutate('create-space', { spaceName: normalizedName })
    if (next === undefined) return
    const created = next.spaces.find(view => view.space.name === normalizedName)
    if (created !== undefined) setSelectedSpaceId(created.space.id)
    setSpaceName('')
    setNotice(`已创建空间“${normalizedName}”`)
  }
  const selectedView = state?.spaces.find(view => view.space.id === selectedSpaceId) ?? state?.spaces[0]
  const presentMember = (memberSessionId: SessionId): MemberPresentation => {
    const workspace = workspaces.find(item => item.sessionIds.includes(memberSessionId))
    const sourceTitle = state?.memories.find(memory => memory.sourceSessionId === memberSessionId)?.sourceSessionTitle
    return {
      title: sessionRows[memberSessionId]?.displayTitle ?? sourceTitle ?? `会话 ${shortId(memberSessionId)}`,
      workspace: workspace?.title ?? '未归属工作区',
    }
  }
  return <Modal open onClose={() => { controller.close() }} title="记忆空间管理" description={`当前治理会话：${session.title}。记忆来源与使用会话相互独立，任何操作都不会删除原始 DSH 会话。`} className={css.governanceModal ?? ''} contentClassName={css.governanceContent ?? ''} footer={<Button variant="primary" data-memory-spaces-done onClick={() => { controller.close() }}>完成</Button>}>
    <div className={css.governance} data-memory-spaces-governance>
      <section className={css.managerToolbar}><div><h3>当前会话内容</h3><p>在插件管理器中多选已加载的用户和模型消息，再保存为可追溯记忆或创建只读快照。</p></div><Button variant="outline" icon={<IconShareOutline16 />} onClick={() => { controller.openSnapshot(session) }}>选择历史对话…</Button></section>
      <section className={css.createSpace}><div><h3>新建空间</h3><p>创建后，当前会话成为所有者，并默认自动使用空间记忆。</p></div><div className={css.inlineForm}><Input value={spaceName} data-memory-space-name placeholder="空间名称" onChange={event => { setSpaceName(event.currentTarget.value) }} /><Button variant="outline" data-memory-space-create disabled={busy || spaceName.trim() === ''} onClick={() => { void create() }}>创建</Button></div></section>
      {notice !== '' && <p className={css.creationStatus} data-memory-space-status role="status">{notice}</p>}
      {state === null && error === '' && <p className={css.empty}>正在读取空间状态…</p>}
      {state?.spaces.length === 0 && <p className={css.empty}>当前会话尚未加入任何记忆空间。</p>}
      {state !== null && state.spaces.length > 0 && selectedView !== undefined && <div className={css.managerLayout}>
        <nav className={css.spaceRail} aria-label="现有记忆空间">
          <div className={css.railHeading}><strong>现有空间</strong><span>{state.spaces.length}</span></div>
          {state.spaces.map(view => <button key={view.space.id} type="button" data-active={view.space.id === selectedView.space.id || undefined} onClick={() => { setSelectedSpaceId(view.space.id); setExpandedMemory(undefined) }}><span><strong>{view.space.name}</strong>{view.space.ownerSessionId === session.sessionId && <small>所有者</small>}</span><span>{state.sources.filter(source => source.source.spaceId === view.space.id).length} 个来源 · {state.consumers.filter(consumer => consumer.consumer.spaceId === view.space.id).length} 个使用会话</span><span>{view.activeMemoryCount} 条有效记忆</span></button>)}
        </nav>
        <SpaceWorkspace
          key={selectedView.space.id}
          view={selectedView}
          sources={state.sources.filter(source => source.source.spaceId === selectedView.space.id)}
          consumers={state.consumers.filter(consumer => consumer.consumer.spaceId === selectedView.space.id)}
          memories={state.memories.filter(memory => memory.spaceId === selectedView.space.id)}
          session={session}
          busy={busy}
          presentMember={presentMember}
          {...expandedMemory === undefined ? {} : { expandedMemory }}
          onExpand={setExpandedMemory}
          onMutate={mutate}
          onDelete={() => { setDeleteSpace(selectedView) }}
          onConnect={() => { controller.openConnect(session, selectedView.space.name) }}
        />
      </div>}
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
    </div>
    {deleteSpace !== undefined && <DeleteSpacePanel view={deleteSpace} busy={busy} onClose={() => { setDeleteSpace(undefined) }} onConfirm={() => { void mutate('delete-space', { spaceName: deleteSpace.space.name }).then(changed => { if (changed) setDeleteSpace(undefined) }) }} />}
  </Modal>
}

function SpaceWorkspace({ view, sources, consumers, memories, session, busy, presentMember, expandedMemory, onExpand, onMutate, onDelete, onConnect }: { view: SessionSpaceView; sources: readonly SpaceSourceView[]; consumers: readonly SpaceConsumerView[]; memories: readonly SharedMemory[]; session: SelectedSession; busy: boolean; presentMember: (sessionId: SessionId) => MemberPresentation; expandedMemory?: string; onExpand: (id: string | undefined) => void; onMutate: GovernanceMutation; onDelete: () => void; onConnect: () => void }) {
  const owner = view.space.ownerSessionId === session.sessionId
  const [tab, setTab] = useState<'sources' | 'consumers' | 'memories'>('sources')
  return <section className={css.spaceWorkspace}>
    <header className={css.spaceHeader}><div><div className={css.spaceTitleLine}><h3>{view.space.name}</h3>{owner && <span className={css.ownerBadge}>所有者</span>}{view.source !== undefined && <span className={css.ownerBadge}>记忆来源</span>}</div><p>{view.activeMemoryCount} 条有效记忆 · 当前会话贡献 {view.contributionCount} 个版本</p></div><div className={css.spaceActions}>
      {view.consumer !== undefined && <label className={css.compactField}><span>当前会话使用方式</span><select className={css.select} value={view.consumer.mode} disabled={busy} onChange={event => { void onMutate('set-own-use-mode', { spaceName: view.space.name, mode: event.currentTarget.value }) }}>{MEMORY_USE_MODE_OPTIONS.map(mode => <option key={mode} value={mode}>{useModeLabel(mode)}</option>)}</select></label>}
      {owner && <Button size="sm" variant="outline" disabled={busy} onClick={onConnect}>连接其他会话…</Button>}
      <Button size="sm" variant="outline" disabled={busy || (!owner && view.source === undefined)} onClick={() => { void onMutate('import-history', { spaceName: view.space.name, sourceSessionTitle: session.title }) }}>总结并导入当前历史</Button>
      {owner && <Button size="sm" variant="ghost" onClick={onDelete}>删除空间…</Button>}
    </div></header>
    <div className={css.aclHelp}>{view.consumer === undefined ? '当前会话不使用这个空间的记忆。' : useModeDescription(view.consumer.mode)}</div>
    <div className={css.workspaceTabs}><button type="button" data-active={tab === 'sources' || undefined} onClick={() => { setTab('sources') }}>记忆来源 <span>{sources.length}</span></button><button type="button" data-active={tab === 'consumers' || undefined} onClick={() => { setTab('consumers') }}>使用会话 <span>{consumers.length}</span></button><button type="button" data-active={tab === 'memories' || undefined} onClick={() => { setTab('memories') }}>空间记忆 <span>{memories.length}</span></button></div>
    {tab === 'sources' && <SourcesPanel view={view} sources={sources} owner={owner} currentSessionId={session.sessionId} busy={busy} presentMember={presentMember} onMutate={onMutate} />}
    {tab === 'consumers' && <ConsumersPanel view={view} consumers={consumers} owner={owner} currentSessionId={session.sessionId} busy={busy} presentMember={presentMember} onMutate={onMutate} />}
    {tab === 'memories' && <div className={css.memoryList}>{memories.length === 0 && <p className={css.empty}>这个会话当前看不到任何记忆版本。</p>}{memories.map(memory => <MemoryRow key={memory.id} memory={memory} manageable={owner || (view.source !== undefined && memory.sourceSessionId === session.sessionId)} expanded={expandedMemory === memory.id} busy={busy} sessionTitle={session.title} onExpand={() => { onExpand(expandedMemory === memory.id ? undefined : memory.id) }} onMutate={onMutate} />)}</div>}
  </section>
}

function SourcesPanel({ view, sources, owner, currentSessionId, busy, presentMember, onMutate }: { view: SessionSpaceView; sources: readonly SpaceSourceView[]; owner: boolean; currentSessionId: SessionId; busy: boolean; presentMember: (sessionId: SessionId) => MemberPresentation; onMutate: GovernanceMutation }) {
  const manageable = owner ? sources : sources.filter(source => source.source.sessionId === currentSessionId)
  const [selectedIds, setSelectedIds] = useState<readonly SessionId[]>([])
  const [removalIds, setRemovalIds] = useState<readonly SessionId[]>([])
  const selected = sources.filter(source => selectedIds.includes(source.source.sessionId))
  const allSelected = manageable.length > 0 && manageable.every(source => selectedIds.includes(source.source.sessionId))
  const toggle = (sessionId: SessionId): void => { setSelectedIds(current => current.includes(sessionId) ? current.filter(id => id !== sessionId) : [...current, sessionId]) }
  return <div className={css.membersPanel}>
    <div className={css.membersIntro}><div><strong>记忆来源</strong><p>只有用户明确保存、导入或同步的内容才会进入空间。</p></div><span>{sources.length} 个来源会话</span></div>
    <div className={css.memberTable} role="table" aria-label={`${view.space.name} 的记忆来源`}>
      <div className={`${css.memberRow} ${css.memberTableHead}`} role="row"><span>{manageable.length > 1 && <input type="checkbox" aria-label="选择全部可移除来源" checked={allSelected} disabled={busy} onChange={() => { setSelectedIds(allSelected ? [] : manageable.map(source => source.source.sessionId)) }} />}</span><span>来源会话</span><span>贡献版本</span><span>最近贡献</span><span /><span /></div>
      {sources.map(source => {
        const identity = presentMember(source.source.sessionId)
        const selectedRow = selectedIds.includes(source.source.sessionId)
        const canManage = owner || source.source.sessionId === currentSessionId
        return <div className={css.memberRow} role="row" key={source.source.sessionId} data-selected={selectedRow || undefined}>
          <span>{canManage && <input type="checkbox" aria-label={`选择来源会话 ${identity.title}`} checked={selectedRow} disabled={busy} onChange={() => { toggle(source.source.sessionId) }} />}</span>
          <span className={css.memberIdentity}><strong>{identity.title}{source.isOwner && <small>所有者</small>}</strong><span>{identity.workspace} · {shortId(source.source.sessionId)}</span><span>添加于 {formatTime(source.source.addedAt)}</span></span>
          <span className={css.contributionCount}><strong>{source.contributionCount}</strong><small>{source.nonDeletedContributionCount} 个未删除</small></span>
          <span className={css.memberActivity}><small>{formatOptionalTime(source.lastContributionAt)}</small></span>
          <span />
          <span>{canManage && <button className={css.removeMember} type="button" disabled={busy} onClick={() => { setSelectedIds([source.source.sessionId]); setRemovalIds([source.source.sessionId]) }}>移除…</button>}</span>
        </div>
      })}
    </div>
    {selected.length > 0 && <div className={css.batchBar}><strong>已选择 {selected.length} 个来源</strong><span>原始会话不会被删除</span><Button size="sm" variant="primary" disabled={busy} onClick={() => { setRemovalIds(selectedIds) }}>移除来源…</Button></div>}
    {removalIds.length > 0 && <SourceRemovalPanel view={view} sources={sources.filter(source => removalIds.includes(source.source.sessionId))} presentMember={presentMember} busy={busy} onClose={() => { setRemovalIds([]) }} onConfirm={async disposition => { const operation = owner ? 'remove-sources' : 'remove-own-source'; const payload = owner ? { spaceName: view.space.name, targetSessionIds: removalIds, disposition } : { spaceName: view.space.name, disposition }; const changed = await onMutate(operation, payload); if (changed) { setRemovalIds([]); setSelectedIds([]) } }} />}
  </div>
}

function SourceRemovalPanel({ view, sources, presentMember, busy, onClose, onConfirm }: { view: SessionSpaceView; sources: readonly SpaceSourceView[]; presentMember: (sessionId: SessionId) => MemberPresentation; busy: boolean; onClose: () => void; onConfirm: (disposition: LeaveDisposition) => Promise<void> }) {
  const [disposition, setDisposition] = useState<LeaveDisposition>('retain')
  const contributionCount = sources.reduce((total, source) => total + source.contributionCount, 0)
  const nonDeletedCount = sources.reduce((total, source) => total + source.nonDeletedContributionCount, 0)
  const affected = disposition === 'retain' ? 0 : disposition === 'delete_contributions' ? nonDeletedCount : contributionCount
  return <div className={css.subpanel} role="dialog" aria-label="移除记忆来源">
    <div className={css.subpanelHeader}><div><h3>从“{view.space.name}”移除 {sources.length} 个记忆来源</h3><p>这只解除来源关系，不会删除任何原始 DSH 会话或工作区。</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></div>
    <div className={css.removalPreview}><strong>影响预览</strong><dl><div><dt>来源</dt><dd>{sources.length}</dd></div><div><dt>贡献版本</dt><dd>{contributionCount}</dd></div><div><dt>本次影响记忆</dt><dd>{affected}</dd></div></dl><p>{sources.slice(0, 6).map(source => presentMember(source.source.sessionId).title).join('、')}{sources.length > 6 ? ` 等 ${sources.length} 个来源` : ''}</p></div>
    <fieldset className={css.exitChoices}><legend>如何处理这些来源的既有贡献</legend><ExitChoice checked={disposition === 'retain'} title="仅解除来源关系" detail="保留贡献内容和完整来源追溯；该会话不能再贡献新内容。" onChange={() => { setDisposition('retain') }} /><ExitChoice checked={disposition === 'delete_contributions'} title="解除关系并删除贡献记忆" detail={`将 ${nonDeletedCount} 个未删除版本标记为 deleted；审计记录仍保留。`} onChange={() => { setDisposition('delete_contributions') }} /><ExitChoice checked={disposition === 'clear_provenance'} title="解除关系并彻底清除来源" detail={`保留记忆内容，但从 ${contributionCount} 个版本清除会话、标题、事件范围和原始消息。此操作不可逆。`} onChange={() => { setDisposition('clear_provenance') }} /></fieldset>
    <div className={css.subpanelFooter}><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy} onClick={() => { void onConfirm(disposition) }}>{busy ? '正在移除…' : `确认移除 ${sources.length} 个来源`}</Button></div>
  </div>
}

function ConsumersPanel({ view, consumers, owner, currentSessionId, busy, presentMember, onMutate }: { view: SessionSpaceView; consumers: readonly SpaceConsumerView[]; owner: boolean; currentSessionId: SessionId; busy: boolean; presentMember: (sessionId: SessionId) => MemberPresentation; onMutate: GovernanceMutation }) {
  const manageable = owner ? consumers : consumers.filter(consumer => consumer.consumer.sessionId === currentSessionId)
  const [selectedIds, setSelectedIds] = useState<readonly SessionId[]>([])
  const [batchMode, setBatchMode] = useState<MemoryUseMode>('automatic')
  const [removalIds, setRemovalIds] = useState<readonly SessionId[]>([])
  const selected = consumers.filter(consumer => selectedIds.includes(consumer.consumer.sessionId))
  const allSelected = manageable.length > 0 && manageable.every(consumer => selectedIds.includes(consumer.consumer.sessionId))
  const toggle = (sessionId: SessionId): void => { setSelectedIds(current => current.includes(sessionId) ? current.filter(id => id !== sessionId) : [...current, sessionId]) }
  const changeMode = async (sessionIds: readonly SessionId[], mode: MemoryUseMode): Promise<void> => {
    const operation = owner ? 'set-consumer-modes' : 'set-own-use-mode'
    const payload = owner ? { spaceName: view.space.name, targetSessionIds: sessionIds, mode } : { spaceName: view.space.name, mode }
    if (await onMutate(operation, payload)) setSelectedIds([])
  }
  return <div className={css.membersPanel}>
    <div className={css.membersIntro}><div><strong>使用这些记忆的会话</strong><p>使用方式只控制回答时是否取用记忆，不授予写入能力。</p></div><span>{consumers.length} 个使用会话</span></div>
    <div className={css.memberTable} role="table" aria-label={`${view.space.name} 的使用会话`}>
      <div className={`${css.memberRow} ${css.memberTableHead}`} role="row"><span>{manageable.length > 1 && <input type="checkbox" aria-label="选择全部使用会话" checked={allSelected} disabled={busy} onChange={() => { setSelectedIds(allSelected ? [] : manageable.map(consumer => consumer.consumer.sessionId)) }} />}</span><span>会话</span><span>使用方式</span><span>最近使用</span><span /><span /></div>
      {consumers.map(consumer => {
        const identity = presentMember(consumer.consumer.sessionId)
        const selectedRow = selectedIds.includes(consumer.consumer.sessionId)
        const canManage = owner || consumer.consumer.sessionId === currentSessionId
        return <div className={css.memberRow} role="row" key={consumer.consumer.sessionId} data-selected={selectedRow || undefined}>
          <span>{canManage && <input type="checkbox" aria-label={`选择使用会话 ${identity.title}`} checked={selectedRow} disabled={busy} onChange={() => { toggle(consumer.consumer.sessionId) }} />}</span>
          <span className={css.memberIdentity}><strong>{identity.title}{consumer.isOwner && <small>所有者</small>}</strong><span>{identity.workspace} · {shortId(consumer.consumer.sessionId)}</span><span>连接于 {formatTime(consumer.consumer.connectedAt)}</span></span>
          <span>{canManage ? <select className={css.memberAcl} aria-label={`${identity.title} 的使用方式`} value={consumer.consumer.mode} disabled={busy} onChange={event => { void changeMode([consumer.consumer.sessionId], event.currentTarget.value as MemoryUseMode) }}>{MEMORY_USE_MODE_OPTIONS.map(mode => <option value={mode} key={mode}>{useModeLabel(mode)}</option>)}</select> : <span className={css.aclBadge}>{useModeLabel(consumer.consumer.mode)}</span>}</span>
          <span className={css.memberActivity}><small>{formatOptionalTime(consumer.lastUsedAt)}</small></span>
          <span />
          <span>{canManage && <button className={css.removeMember} type="button" disabled={busy} onClick={() => { setSelectedIds([consumer.consumer.sessionId]); setRemovalIds([consumer.consumer.sessionId]) }}>停止使用…</button>}</span>
        </div>
      })}
    </div>
    {selected.length > 0 && <div className={css.batchBar}><strong>已选择 {selected.length} 个使用会话</strong><span>只改变回答时的记忆使用方式</span>{owner && <><select className={css.memberAcl} value={batchMode} aria-label="批量使用方式" onChange={event => { setBatchMode(event.currentTarget.value as MemoryUseMode) }}>{MEMORY_USE_MODE_OPTIONS.map(mode => <option key={mode} value={mode}>设为{useModeLabel(mode)}</option>)}</select><Button size="sm" variant="outline" disabled={busy} onClick={() => { void changeMode(selectedIds, batchMode) }}>应用</Button></>}<Button size="sm" variant="primary" disabled={busy} onClick={() => { setRemovalIds(selectedIds) }}>停止使用…</Button></div>}
    {removalIds.length > 0 && <ConsumerRemovalPanel view={view} consumers={consumers.filter(consumer => removalIds.includes(consumer.consumer.sessionId))} presentMember={presentMember} busy={busy} onClose={() => { setRemovalIds([]) }} onConfirm={async () => { const operation = owner ? 'remove-consumers' : 'remove-own-consumer'; const payload = owner ? { spaceName: view.space.name, targetSessionIds: removalIds } : { spaceName: view.space.name }; const changed = await onMutate(operation, payload); if (changed) { setRemovalIds([]); setSelectedIds([]) } }} />}
  </div>
}

function ConsumerRemovalPanel({ view, consumers, presentMember, busy, onClose, onConfirm }: { view: SessionSpaceView; consumers: readonly SpaceConsumerView[]; presentMember: (sessionId: SessionId) => MemberPresentation; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <div className={css.subpanel} role="dialog" aria-label="停止使用空间记忆">
    <div className={css.subpanelHeader}><div><h3>停止 {consumers.length} 个会话使用“{view.space.name}”</h3><p>这些会话将不再自动检索或在发送前选择本空间记忆。</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></div>
    <div className={css.removalPreview}><strong>影响预览</strong><dl><div><dt>使用会话</dt><dd>{consumers.length}</dd></div><div><dt>删除记忆</dt><dd>0</dd></div><div><dt>删除原始会话</dt><dd>0</dd></div></dl><p>{consumers.map(consumer => presentMember(consumer.consumer.sessionId).title).join('、')}</p></div>
    <p className={css.inlineHint}>记忆来源、空间内容和原始 DSH 会话都会保留；以后可以重新连接。</p>
    <div className={css.subpanelFooter}><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy} onClick={() => { void onConfirm() }}>{busy ? '正在处理…' : `确认停止 ${consumers.length} 个会话使用`}</Button></div>
  </div>
}

function MemoryRow({ memory, manageable, expanded, busy, sessionTitle, onExpand, onMutate }: { memory: SharedMemory; manageable: boolean; expanded: boolean; busy: boolean; sessionTitle: string; onExpand: () => void; onMutate: GovernanceMutation }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(memory.content)
  const [type, setType] = useState<MemoryType>(memory.type)
  return <article className={css.memoryRow} data-status={memory.status}>
    <button className={css.memorySummary} type="button" onClick={onExpand}><span className={`${css.statusDot} ${css[`status_${memory.status}`] ?? ''}`} /><span className={css.memoryContent}><span className={css.memoryMeta}>{typeLabel(memory.type)} · v{memory.versionNumber} · {statusLabel(memory.status)}</span><strong>{memory.content}</strong></span><span className={css.disclosure}>{expanded ? '−' : '+'}</span></button>
    {expanded && <div className={css.memoryDetails}>
      <dl className={css.provenanceGrid}><div><dt>来源会话</dt><dd>{memory.provenanceCleared ? '已清除来源关系' : memory.sourceSessionTitle ?? '未记录标题'}</dd></div><div><dt>会话 ID</dt><dd>{memory.sourceSessionId ?? '已清除'}</dd></div><div><dt>事件范围</dt><dd>{formatRange(memory)}</dd></div><div><dt>保存方式</dt><dd>{memory.creationMethod === 'manual' ? '用户确认 / 人工保存' : '模型提炼'}</dd></div><div><dt>创建时间</dt><dd>{formatTime(memory.createdAt)}</dd></div><div><dt>版本链</dt><dd>根 {shortId(memory.versionRootId)}{memory.previousVersionId === undefined ? '' : ` · 上一版 ${shortId(memory.previousVersionId)}`}{memory.supersededById === undefined ? '' : ` · 被 ${shortId(memory.supersededById)} 替代`}</dd></div></dl>
      <div className={css.detailSection}><h4>使用的原始消息</h4>{memory.sourceMessages.length === 0 ? <p className={css.empty}>未保留原始消息摘录。</p> : memory.sourceMessages.map(message => <div className={css.sourceMessage} key={message.seq}><span>seq {message.seq} · {sourceRoleLabel(message.role)}</span><p>{message.excerpt}</p></div>)}</div>
      <div className={css.detailSection}><h4>最近调用记录</h4>{memory.recentUsages.length === 0 ? <p className={css.empty}>尚未注入任何回答。</p> : memory.recentUsages.map((usage, index) => <p className={css.usage} key={`${usage.targetSessionId}-${usage.usedAt}-${index}`}>会话 {shortId(usage.targetSessionId)}{usage.responseSeq === undefined ? '' : ` · 回答 seq ${usage.responseSeq}`} · {formatTime(usage.usedAt)}</p>)}</div>
      {manageable && <div className={css.memoryControls}><label className={css.compactField}><span>状态</span><select className={css.select} value={memory.status} disabled={busy} onChange={event => { void onMutate('set-memory-status', { memoryId: memory.id, status: event.currentTarget.value }) }}>{(['active', 'superseded', 'disputed', 'expired', 'deleted'] as const).map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(value => !value) }}>创建新版本</Button></div>}
      {editing && <div className={css.versionEditor}><select className={css.select} value={type} onChange={event => { setType(event.currentTarget.value as MemoryType) }}>{MEMORY_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea value={content} onChange={event => { setContent(event.currentTarget.value) }} /><div className={css.editorActions}><Button size="sm" variant="ghost" onClick={() => { setEditing(false) }}>取消</Button><Button size="sm" variant="primary" disabled={busy || content.trim() === '' || content.trim() === memory.content} onClick={() => { void onMutate('update-memory', { memoryId: memory.id, content, type, sourceSessionTitle: sessionTitle }).then(changed => { if (changed !== undefined) setEditing(false) }) }}>保存为新版本</Button></div></div>}
    </div>}
  </article>
}

function ExitChoice({ checked, title, detail, onChange }: { checked: boolean; title: string; detail: string; onChange: () => void }) { return <label className={css.exitChoice}><input type="radio" checked={checked} onChange={onChange} /><span><strong>{title}</strong><small>{detail}</small></span></label> }

function DeleteSpacePanel({ view, busy, onClose, onConfirm }: { view: SessionSpaceView; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  return <div className={css.subpanel} role="dialog" aria-label="删除整个记忆空间"><div className={css.subpanelHeader}><div><h3>删除整个空间</h3><p>这会删除空间、全部来源与使用关系、所有记忆版本和来源追溯。</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></div><div className={css.dangerBox}><IconWarningOutline16 size={18} /><p>请输入空间名 <strong>{view.space.name}</strong> 以确认。此操作不可恢复。</p></div><Input value={confirmation} placeholder={view.space.name} onChange={event => { setConfirmation(event.currentTarget.value) }} /><div className={css.subpanelFooter}><Button variant="outline" onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || confirmation !== view.space.name} onClick={onConfirm}>永久删除空间</Button></div></div>
}

function ConnectDialog({
  controller, remote, governing, initialSessions, preferredSpaceName, createNew, useSessions, useWorkspaces,
}: {
  controller: MemoryShareController
  remote: ClientRemote
  governing: SelectedSession
  initialSessions: readonly SelectedSession[]
  preferredSpaceName: string | undefined
  createNew: boolean
  useSessions: HeaderProps['useSessions']
  useWorkspaces: HeaderProps['useWorkspaces']
}) {
  const sessionState = useSessions(snapshot => snapshot)
  const workspaceState = useWorkspaces(snapshot => snapshot)
  const [state, setState] = useState<MemoryGovernanceState | null>(null)
  const [choice, setChoice] = useState<'existing' | 'new'>(createNew || preferredSpaceName === undefined ? 'new' : 'existing')
  const [spaceName, setSpaceName] = useState(preferredSpaceName ?? '')
  const [relation, setRelation] = useState<'source' | 'consumer'>('source')
  const [mode, setMode] = useState<MemoryUseMode>('automatic')
  const [importHistory, setImportHistory] = useState(false)
  const [selectedIds, setSelectedIds] = useState<readonly SessionId[]>(() => initialSessions.slice(1).map(session => session.sessionId))
  const [query, setQuery] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    let active = true
    void executeMemoryUi<MemoryGovernanceState>(remote, governing.sessionId, 'state', {}).then(value => {
      if (!active) return
      setState(value)
      if (createNew) return
      const preferred = value.ownedSpaces.find(space => space.name === preferredSpaceName)
      const fallback = value.ownedSpaces[0]
      if (preferred !== undefined || (preferredSpaceName === undefined && fallback !== undefined)) {
        setChoice('existing')
        setSpaceName((preferred ?? fallback)?.name ?? '')
      }
    }, caught => { if (active) setError(messageOf(caught)) })
    return () => { active = false }
  }, [createNew, governing.sessionId, preferredSpaceName, remote])

  const archived = new Set(workspaceState.archivedSessionIds)
  const availableSessions = useMemo(() => sessionState.ids
    .filter(sessionId => sessionId !== governing.sessionId && !archived.has(sessionId))
    .map(sessionId => sessionState.byId[sessionId])
    .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined)
    .filter(summary => {
      const normalized = query.trim().toLocaleLowerCase('zh-CN')
      return normalized === '' || summary.displayTitle.toLocaleLowerCase('zh-CN').includes(normalized)
    }), [governing.sessionId, query, sessionState, workspaceState.archivedSessionIds])
  const selectedSessions = selectedIds
    .map(sessionId => sessionState.byId[sessionId])
    .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined)
    .map(summary => ({ sessionId: summary.id, title: summary.displayTitle }))
  const toggleSession = (sessionId: SessionId): void => {
    setSelectedIds(current => current.includes(sessionId)
      ? current.filter(id => id !== sessionId)
      : [...current, sessionId])
  }
  const submit = async (): Promise<void> => {
    if (selectedSessions.length === 0 || spaceName.trim() === '' || !acknowledged) return
    setBusy(true); setError('')
    try {
      if (choice === 'new') await executeMemoryUi(remote, governing.sessionId, 'create-space', { spaceName })
      const sessions = [governing, ...selectedSessions]
      await connectSelectedSessions(remote, relation === 'source'
        ? { sessions, spaceName, relation, importHistory }
        : { sessions, spaceName, relation, mode })
      setDone(true)
    }
    catch (caught) { setError(messageOf(caught)) }
    finally { setBusy(false) }
  }
  const targetCount = selectedSessions.length
  return <Modal open onClose={() => { controller.close() }} title="把会话连接到记忆空间" description={`当前会话“${governing.title}”负责治理。可跨工作区选择多个本地会话。`} className={css.dialogModal ?? ''} contentClassName={css.dialogContent ?? ''} footer={done ? <Button variant="primary" onClick={() => { controller.clear() }}>完成</Button> : <><Button variant="outline" onClick={() => { controller.close() }}>取消</Button><Button variant="primary" disabled={busy || !acknowledged || spaceName.trim() === '' || targetCount === 0} onClick={() => { void submit() }}>{busy ? '正在连接…' : `连接 ${targetCount} 个会话`}</Button></>}>
    {done ? <div className={css.success}><div className={css.successIcon}><IconCheckOutline14 size={18} /></div><h3>{targetCount} 个会话已连接</h3><p>{relation === 'source' ? `它们已成为“${spaceName}”的记忆来源。${importHistory ? '所选历史已经分别总结并导入。' : '既有历史没有被复制，后续内容也不会自动写入。'}` : `它们现在以“${useModeLabel(mode)}”方式使用“${spaceName}”的记忆。`}</p></div> : <div className={css.form}>
      <fieldset className={css.section}><legend>选择会话</legend><Input value={query} placeholder="按会话标题搜索" onChange={event => { setQuery(event.currentTarget.value) }} /><div className={css.sessionPicker} role="group" aria-label="可连接的本地会话">{availableSessions.length === 0 && <p className={css.empty}>没有匹配的可连接会话。</p>}{availableSessions.map(summary => { const workspace = workspaceState.items.find(item => item.sessionIds.includes(summary.id)); return <label className={css.sessionChoice} key={summary.id} data-selected={selectedIds.includes(summary.id) || undefined}><input type="checkbox" checked={selectedIds.includes(summary.id)} onChange={() => { toggleSession(summary.id) }} /><span><strong>{summary.displayTitle}</strong><small>{workspace?.title ?? '未归属工作区'} · {shortId(summary.id)}{summary.blank ? ' · 空白会话' : ''}</small></span></label> })}</div><p className={css.inlineHint}>已选择 {targetCount} 个会话。此处只建立关系，不删除或移动原始会话。</p></fieldset>
      <fieldset className={css.section}><legend>空间</legend><Radio label="使用当前会话拥有的空间" checked={choice === 'existing'} disabled={(state?.ownedSpaces.length ?? 0) === 0} onChange={() => { setChoice('existing'); setSpaceName(state?.ownedSpaces[0]?.name ?? '') }} />{choice === 'existing' && <select className={css.select} value={spaceName} onChange={event => { setSpaceName(event.currentTarget.value) }}>{state?.ownedSpaces.map(space => <option key={space.id} value={space.name}>{space.name}</option>)}</select>}<Radio label="新建记忆空间后连接" checked={choice === 'new'} onChange={() => { setChoice('new'); setSpaceName('') }} />{choice === 'new' && <Input value={spaceName} placeholder="新空间名称" onChange={event => { setSpaceName(event.currentTarget.value) }} />}</fieldset>
      <fieldset className={css.section}><legend>这些会话在空间中的作用</legend><Radio label="作为记忆来源" checked={relation === 'source'} onChange={() => { setRelation('source') }} /><p className={css.inlineHint}>只有你明确保存、导入或同步的内容才会进入空间。</p><Radio label="使用空间记忆" checked={relation === 'consumer'} onChange={() => { setRelation('consumer'); setImportHistory(false) }} /><p className={css.inlineHint}>只控制回答时如何取用记忆，不允许写入。</p></fieldset>
      {relation === 'source' ? <fieldset className={css.section}><legend>历史对话</legend><label className={css.check}><input type="checkbox" checked={importHistory} onChange={event => { setImportHistory(event.currentTarget.checked) }} />将每个来源会话的现有历史总结后导入（可选）</label><p className={css.inlineHint}>不勾选时只建立来源关系；既有历史和后续对话都不会自动写入。</p></fieldset> : <fieldset className={css.section}><legend>使用方式</legend><select className={css.select} value={mode} onChange={event => { setMode(event.currentTarget.value as MemoryUseMode) }}>{MEMORY_USE_MODE_OPTIONS.map(value => <option key={value} value={value}>{useModeLabel(value)}</option>)}</select><p className={css.inlineHint}>{useModeDescription(mode)}</p></fieldset>}
      <SensitiveNotice action="连接或导入前" /><label className={css.ack}><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.currentTarget.checked) }} />我已检查所选会话不含不应共享的 API Key、密码、私钥、访问令牌或其他敏感信息，并确认由我明确建立这些来源或使用关系。</label>{error !== '' && <p className={css.error} role="alert">{error}</p>}
    </div>}
  </Modal>
}

function SnapshotDialog({ controller, remote, session, nodes, selectedMessages }: { controller: MemoryShareController; remote: ClientRemote; session: SelectedSession; nodes: readonly ConversationNode[]; selectedMessages: Readonly<Record<string, Readonly<Record<number, { seq: number; text?: string }>>>> }) {
  const first = session
  const sessions = [session]
  const selectableMessages = useMemo(() => projectSelectableMessages(nodes), [nodes])
  const totalSelected = countSelectedMessages(selectedMessages)
  const [tab, setTab] = useState<'save' | 'link'>(totalSelected > 0 ? 'save' : 'link')
  const [state, setState] = useState<MemoryGovernanceState | null>(null)
  const [spaceName, setSpaceName] = useState('')
  const [memoryType, setMemoryType] = useState<MemoryType>('fact')
  const [content, setContent] = useState(() => selectedText(selectedMessages))
  const [includeTools, setIncludeTools] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false)
  const [sensitiveLabels, setSensitiveLabels] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [completion, setCompletion] = useState<{ kind: 'saved' } | { kind: 'link'; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setContent(selectedText(selectedMessages)) }, [selectedMessages])
  useEffect(() => { if (first === undefined) return; let active = true; void executeMemoryUi<MemoryGovernanceState>(remote, first.sessionId, 'state', {}).then(value => { if (!active) return; setState(value); const sourceSpace = value.spaces.find(space => space.source !== undefined || space.space.ownerSessionId === first.sessionId); if (sourceSpace !== undefined) setSpaceName(sourceSpace.space.name) }, () => { /* Link creation remains available without a source space. */ }); return () => { active = false } }, [first, remote])
  const save = async (): Promise<void> => {
    if (first === undefined || totalSelected === 0 || spaceName === '' || content.trim() === '' || !acknowledged) return
    setBusy(true); setError('')
    try { const seqs = selectedSeqs(selectedMessages, first.sessionId); if (seqs === undefined) throw new Error('请在同一个会话中至少选择一条对话。'); await executeMemoryUi(remote, first.sessionId, 'save-selection', { spaceName, sourceSessionTitle: first.title, seqs, includeToolResults: includeTools, acknowledgeSensitive: sensitiveConfirmed, type: memoryType, content }); setCompletion({ kind: 'saved' }) }
    catch (caught) { if (caught instanceof MemoryUiRequestError && caught.code === 'sensitive-content') { setSensitiveLabels(caught.labels); setError('检测到疑似敏感内容。请取消、调整选择，或在逐项检查后明确确认。') } else setError(messageOf(caught)) }
    finally { setBusy(false) }
  }
  const createLink = async (): Promise<void> => {
    if (first === undefined || totalSelected === 0 || !acknowledged) return
    setBusy(true); setError('')
    try { const accessToken = randomBearerToken(); const editToken = randomBearerToken(); const firstSeqs = selectedSeqs(selectedMessages, first.sessionId); if (firstSeqs === undefined) throw new Error('请至少选择一条对话后再创建链接。'); await executeShare(remote, first.sessionId, 'create-conversation', { title: first.title, seqs: firstSeqs, includeToolResults: includeTools, acknowledgeSensitive: sensitiveConfirmed, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1_000, maxUses: 100, accessToken, editToken }); for (const session of sessions.slice(1)) { const seqs = selectedSeqs(selectedMessages, session.sessionId); if (seqs === undefined) continue; await executeShare(remote, session.sessionId, 'append-conversation', { editToken, title: session.title, seqs, includeToolResults: includeTools, acknowledgeSensitive: sensitiveConfirmed }) } setCompletion({ kind: 'link', url: makeShareUrl(accessToken) }) }
    catch (caught) { if (caught instanceof ShareRequestError && caught.code === 'sensitive-content') { setSensitiveLabels(caught.labels); setError('检测到疑似敏感内容。请取消、调整选择，或在逐项检查后明确确认。') } else setError(messageOf(caught)) }
    finally { setBusy(false) }
  }
  const sourceSpaces = state?.spaces.filter(space => space.source !== undefined || space.space.ownerSessionId === first?.sessionId) ?? []
  const canSubmit = acknowledged && !busy && first !== undefined && totalSelected > 0 && (tab === 'link' || (spaceName !== '' && content.trim() !== ''))
  return <Modal open onClose={() => { controller.close() }} title="保存或分享所选对话" description={totalSelected > 0 ? `精确选择了 ${totalSelected} 条对话。` : '请先选择至少一条具体消息；插件不会隐式分享整段会话历史。'} className={css.dialogModal ?? ''} contentClassName={css.dialogContent ?? ''} footer={completion === null ? <><Button variant="outline" onClick={() => { controller.close() }}>取消</Button><Button variant="primary" disabled={!canSubmit} onClick={() => { void (tab === 'save' ? save() : createLink()) }}>{busy ? '正在处理…' : tab === 'save' ? '保存到记忆空间' : '创建只读链接'}</Button></> : completion.kind === 'link' ? <><Button variant="outline" onClick={() => { controller.clear() }}>完成</Button><Button variant="primary" icon={<IconCopyOutline16 />} onClick={() => { void writeClipboard(completion.url).then(setCopied) }}>{copied ? '已复制' : '复制链接'}</Button></> : <Button variant="primary" onClick={() => { controller.clear() }}>完成</Button>}>
    {completion === null ? <div className={css.form}>
      <fieldset className={css.section}><legend>选择当前会话的历史消息</legend><div className={css.messagePicker} role="group" aria-label="当前会话中可选择的历史消息">{selectableMessages.length === 0 && <p className={css.empty}>当前已加载记录中没有可选择的用户或模型消息。</p>}{selectableMessages.map(message => { const selected = selectedMessages[session.sessionId]?.[message.seq] !== undefined; return <label className={css.messageChoice} key={`${message.role}-${message.seq}`} data-selected={selected || undefined}><input type="checkbox" checked={selected} onChange={() => { controller.toggleMessage(session, { seq: message.seq, text: message.text }) }} /><span className={css.messageRole}>{message.role === 'user' ? '用户' : '模型'}</span><span><strong>{message.text}</strong><small>seq {message.seq} · {formatTime(message.time)}</small></span></label> })}</div><p className={css.inlineHint}>这里只显示当前浏览器已加载的历史。需要选择更早消息时，先返回会话向上加载历史，再重新打开此窗口。</p></fieldset>
      <div className={css.tabs}><button type="button" data-active={tab === 'save' || undefined} disabled={totalSelected === 0} onClick={() => { setTab('save') }}>保存为可追溯记忆</button><button type="button" data-active={tab === 'link' || undefined} onClick={() => { setTab('link') }}><IconLinkOutline16 size={14} />只读会话链接</button></div>
      {tab === 'save' ? <>{sourceSpaces.length === 0 ? <p className={css.error}>当前会话还不是任何空间的记忆来源。请先在“会话记忆空间”中将它连接为来源。</p> : <fieldset className={css.section}><legend>记忆内容</legend><select className={css.select} value={spaceName} onChange={event => { setSpaceName(event.currentTarget.value) }}>{sourceSpaces.map(space => <option key={space.space.id} value={space.space.name}>{space.space.name} · {space.space.ownerSessionId === first?.sessionId ? '空间所有者' : '记忆来源'}</option>)}</select><select className={css.select} value={memoryType} onChange={event => { setMemoryType(event.currentTarget.value as MemoryType) }}>{MEMORY_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea className={css.contentEditor} value={content} placeholder="整理成一条明确、可复用的记忆" onChange={event => { setContent(event.currentTarget.value) }} /><p className={css.inlineHint}>只有这次明确保存的内容会进入空间。来源会话、事件序号和所选原始消息会一起保存，方式标记为“用户确认”。</p></fieldset>}</> : <div className={css.localLinkNotice}><strong>这是只读快照，不是记忆空间连接</strong><p>链接不会让会话互相读取记忆。当前地址是本机 127.0.0.1；跨设备访问需要部署可公开访问的 Harness 服务。</p></div>}
      <label className={css.check}><input type="checkbox" checked={includeTools} onChange={event => { setIncludeTools(event.currentTarget.checked) }} />包含工具调用结果（默认不包含）</label><SensitiveNotice action={tab === 'save' ? '保存前' : '发送链接前'} /><label className={css.ack}><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.currentTarget.checked) }} />我已检查所选内容，不包含不应共享的 API Key、密码、私钥、访问令牌或其他私密敏感信息。</label>{sensitiveLabels.length > 0 && <label className={css.sensitiveAck}><input type="checkbox" checked={sensitiveConfirmed} onChange={event => { setSensitiveConfirmed(event.currentTarget.checked) }} />已复核检测项（{sensitiveLabels.join('、')}），仍然继续。</label>}{error !== '' && <p className={css.error} role="alert">{error}</p>}
    </div> : completion.kind === 'saved' ? <div className={css.success}><div className={css.successIcon}><IconCheckOutline14 size={18} /></div><h3>已保存为可追溯记忆</h3><p>可在会话记忆空间中查看来源消息、事件范围、版本状态和最近调用记录。</p></div> : <div className={css.success}><div className={css.successIcon}><IconCheckOutline14 size={18} /></div><h3>只读链接已创建</h3><p>链接仅显示一次；本机地址只能从当前设备访问。</p><code>{completion.url}</code></div>}
  </Modal>
}

function SensitiveNotice({ action }: { action: string }) { return <div className={css.securityNotice}><IconWarningOutline16 size={18} /><div><strong>{action}检查内容</strong><p>不要包含 API Key、密码、私钥、访问令牌、身份证件或其他私密敏感信息。系统也会检测常见凭据格式。</p></div></div> }
function Radio({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) { return <label className={css.radio}><input type="radio" checked={checked} disabled={disabled} onChange={onChange} />{label}</label> }
interface SelectableConversationMessage { readonly seq: number; readonly time: number; readonly role: 'user' | 'assistant'; readonly text: string }
function projectSelectableMessages(nodes: readonly ConversationNode[]): SelectableConversationMessage[] {
  const projected: SelectableConversationMessage[] = []
  for (const node of nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
      if (text !== '') projected.push({ seq: node.seq, time: node.time, role: 'user', text })
      continue
    }
    if (node.kind !== 'assistant' || node.messageId === undefined) continue
    const text = node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n').trim()
    if (text !== '') projected.push({ seq: node.seq, time: node.time, role: 'assistant', text })
  }
  return projected
}
function selectedSeqs(selected: Readonly<Record<string, Readonly<Record<number, { seq: number }>>>>, sessionId: SessionId): number[] | undefined { const messages = selected[sessionId]; if (messages === undefined) return; const seqs = Object.values(messages).map(message => message.seq).sort((left, right) => left - right); return seqs.length === 0 ? undefined : seqs }
function countSelectedMessages(selected: Readonly<Record<string, Readonly<Record<number, unknown>>>>): number { return Object.values(selected).reduce((count, messages) => count + Object.keys(messages).length, 0) }
function selectedText(selected: Readonly<Record<string, Readonly<Record<number, { text?: string }>>>>): string { return Object.values(selected).flatMap(messages => Object.values(messages)).map(message => message.text?.trim()).filter((text): text is string => text !== undefined && text !== '').join('\n\n') }
function makeShareUrl(token: string): string { const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('memorySnapshot', token); return url.toString() }
function useModeLabel(mode: MemoryUseMode): string { return { automatic: '自动使用', confirm: '发送前确认', paused: '暂停使用' }[mode] }
function useModeDescription(mode: MemoryUseMode): string { return { automatic: '模型回答时自动检索并注入匹配记忆。', confirm: '发送前显示匹配记忆，由你选择本轮使用哪些。', paused: '保留连接，但不检索或注入这个空间的记忆。' }[mode] }
function typeLabel(type: MemoryType): string { return MEMORY_TYPE_OPTIONS.find(([value]) => value === type)?.[1] ?? type }
function statusLabel(status: MemoryStatus): string { return { active: '有效', superseded: '已替代', disputed: '有争议', expired: '已过期', deleted: '已删除' }[status] }
function sourceRoleLabel(role: SharedMemory['sourceMessages'][number]['role']): string { return { user: '用户', assistant: '模型', tool: '工具', summary: '摘要', context: '上下文' }[role] }
function formatRange(memory: SharedMemory): string { return memory.sourceSeqStart === undefined || memory.sourceSeqEnd === undefined ? '未记录' : `seq ${memory.sourceSeqStart}–${memory.sourceSeqEnd}` }
function formatTime(value: number): string { return new Date(value).toLocaleString('zh-CN') }
function formatOptionalTime(value: number | undefined): string { return value === undefined ? '尚无' : formatTime(value) }
function shortId(value: string): string { return value.length <= 12 ? value : `${value.slice(0, 8)}…` }
function messageOf(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught) }
