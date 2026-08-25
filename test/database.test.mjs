import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { HISTORY_SUMMARY_PREFIX, MemorySpaceError, MemoryStore } from '../lib/index.js'

function createStore() {
  return new MemoryStore({ databasePath: ':memory:', journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 })
}

function createFullSchemaThreeFixture(databasePath) {
  const seed = new MemoryStore({ databasePath, journalMode: 'delete', busyTimeoutMs: 5_000, maxMemoryBytes: 8_192 })
  seed.createSpace('Legacy', 'owner')
  seed.createSpace('Archive', 'archive-owner')
  seed.addSource('Legacy', 'owner', 'writer')
  const first = seed.remember({
    spaceName: 'Legacy', sourceSessionId: 'writer', sourceSessionTitle: 'Legacy source',
    sourceSeqStart: 10, sourceSeqEnd: 11, type: 'constraint', content: 'Legacy title limit is 80 characters.',
    sourceMessages: [{ seq: 10, role: 'user', excerpt: 'Keep titles short.' }],
  }).memory
  const second = seed.createVersion(first.id, 'writer', {
    type: 'constraint', content: 'Legacy title limit is 70 to 75 characters.', sourceSeq: 12,
    sourceMessages: [{ seq: 12, role: 'user', excerpt: 'Use the revised title limit.' }],
  })
  const disputed = seed.remember({
    spaceName: 'Legacy', sourceSessionId: 'writer', type: 'decision', content: 'The deployment target is disputed.',
  }).memory
  seed.setMemoryStatus(disputed.id, 'writer', 'disputed')
  const archive = seed.remember({
    spaceName: 'Archive', sourceSessionId: 'archive-owner', type: 'fact', content: 'Archive space survives migration.',
  }).memory
  seed.recordRecallUsage([second.id], 'owner')
  seed.attachRecallUsages('owner', 42)
  const share = seed.createConversationShare({
    sourceSessionId: 'owner', sourceSeqStart: 3, sourceSeqEnd: 4,
    title: 'Selected legacy messages', content: 'user: selected\nassistant: selected reply',
    expiresAt: Date.now() + 60_000, maxUses: 3,
  })
  seed.close()

  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    DROP INDEX space_consumers_by_session;
    DROP TABLE space_consumers;
    DROP INDEX space_sources_by_session;
    DROP TABLE space_sources;
    CREATE TABLE space_sessions (
      space_id TEXT NOT NULL, session_id TEXT NOT NULL,
      mode TEXT NOT NULL, joined_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, session_id)
    );
    CREATE INDEX space_sessions_by_session ON space_sessions(session_id, space_id);
    INSERT INTO space_sessions
      SELECT id, owner_session_id, 'read_write', created_at, updated_at FROM memory_spaces;
    INSERT INTO space_sessions
      SELECT id, 'reader', 'read', created_at, updated_at FROM memory_spaces WHERE name = 'Legacy';
    INSERT INTO space_sessions
      SELECT id, 'writer', 'write', created_at, updated_at FROM memory_spaces WHERE name = 'Legacy';
    INSERT INTO space_sessions
      SELECT id, 'both', 'read_write', created_at, updated_at FROM memory_spaces WHERE name = 'Legacy';
    INSERT INTO space_sessions
      SELECT id, 'manual', 'manual_only', created_at, updated_at FROM memory_spaces WHERE name = 'Legacy';
    PRAGMA user_version = 3;
  `)
  legacy.close()
  return { first, second, disputed, archive, accessToken: share.token }
}

function runMigrationProcess(databasePath) {
  const fixture = fileURLToPath(new URL('./fixtures/open-store.mjs', import.meta.url))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, databasePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`migration child exited ${code}: ${stderr}`))
    })
  })
}

test('memory sources and consumers are independent relationships', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Sellora', 'owner')
  const saved = store.remember({
    spaceName: 'Sellora', sourceSessionId: 'owner', sourceSessionTitle: '库存销售系统 UI 改造',
    sourceSeqStart: 184, sourceSeqEnd: 191, creationMethod: 'manual', type: 'constraint',
    content: '所有 UI 改造不得修改业务 API、路由、权限或数据结构。',
    sourceMessages: [{ seq: 184, role: 'user', excerpt: '只改 UI，不改业务 API。' }],
  })

  assert.deepEqual(store.search('reader', '业务 API 可以修改吗', 8), [])
  store.addConsumer('Sellora', 'owner', 'reader', 'automatic')
  assert.equal(store.search('reader', '业务 API 可以修改吗', 8, 'automatic')[0].id, saved.memory.id)
  assert.throws(() => store.remember({ spaceName: 'Sellora', sourceSessionId: 'reader', type: 'fact', content: '不能写。' }), error => error instanceof MemorySpaceError && error.code === 'SOURCE_REQUIRED')

  store.addSource('Sellora', 'owner', 'writer')
  assert.deepEqual(store.search('writer', '业务 API', 8, 'automatic'), [])
  store.remember({ spaceName: 'Sellora', sourceSessionId: 'writer', type: 'decision', content: '部署使用本地 profile。' })

  store.addConsumer('Sellora', 'owner', 'confirming', 'confirm')
  assert.deepEqual(store.search('confirming', '业务 API', 8, 'automatic'), [])
  assert.equal(store.search('confirming', '业务 API', 8, 'confirm').length, 1)

  assert.equal(store.setOwnUseMode('Sellora', 'reader', 'paused').mode, 'paused')
  assert.deepEqual(store.search('reader', '业务 API', 8, 'automatic'), [])
  assert.equal(store.setOwnUseMode('Sellora', 'reader', 'automatic').mode, 'automatic')
  assert.deepEqual(store.listSpaceSources('Sellora', 'owner').map(view => view.source.sessionId).sort(), ['owner', 'writer'])
  assert.deepEqual(store.listSpaceConsumers('Sellora', 'owner').map(view => view.consumer.sessionId).sort(), ['confirming', 'owner', 'reader'])
})

test('role matrix denies cross-role governance and preserves database state', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Roles', 'owner')
  store.addSource('Roles', 'owner', 'source')
  store.addConsumer('Roles', 'owner', 'consumer', 'automatic')
  store.addSource('Roles', 'owner', 'both')
  store.addConsumer('Roles', 'owner', 'both', 'confirm')
  const ownerMemory = store.remember({
    spaceName: 'Roles', sourceSessionId: 'owner', type: 'fact', content: 'Owner-only contribution.',
  }).memory
  const sourceMemory = store.remember({
    spaceName: 'Roles', sourceSessionId: 'source', type: 'fact', content: 'Source contribution.',
  }).memory

  assert.deepEqual(store.search('source', 'contribution', 8), [])
  assert.deepEqual(store.listMemories('Roles', 'source', 20).map(memory => memory.id), [sourceMemory.id])
  assert.deepEqual(store.listMemories('Roles', 'consumer', 20).map(memory => memory.id).sort(), [ownerMemory.id, sourceMemory.id].sort())
  assert.deepEqual(store.search('both', 'contribution', 8), [])
  assert.equal(store.search('both', 'contribution', 8, 'confirm').length, 2)
  assert.deepEqual(store.search('none', 'contribution', 8), [])
  assert.throws(
    () => store.listMemories('Roles', 'none', 20),
    error => error instanceof MemorySpaceError && error.code === 'RELATION_REQUIRED',
  )
  assert.throws(
    () => store.remember({ spaceName: 'Roles', sourceSessionId: 'consumer', type: 'fact', content: 'Denied.' }),
    error => error instanceof MemorySpaceError && error.code === 'SOURCE_REQUIRED',
  )
  assert.throws(
    () => store.addConsumer('Roles', 'source', 'none', 'automatic'),
    error => error instanceof MemorySpaceError && error.code === 'OWNER_REQUIRED',
  )
  assert.throws(
    () => store.setOwnUseMode('Roles', 'source', 'paused'),
    error => error instanceof MemorySpaceError && error.code === 'USE_DENIED',
  )
  assert.throws(
    () => store.forget(ownerMemory.id, 'source'),
    error => error instanceof MemorySpaceError && error.code === 'OWNER_REQUIRED',
  )

  assert.equal(store.listMemories('Roles', 'owner', 20).length, 2)
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
})

test('governance state applies its memory limit across all visible spaces', (t) => {
  const store = createStore()
  t.after(() => store.close())
  for (const spaceName of ['First', 'Second']) {
    store.createSpace(spaceName, 'owner')
    for (let index = 0; index < 4; index += 1) {
      store.remember({
        spaceName,
        sourceSessionId: 'owner',
        type: 'fact',
        content: `${spaceName} bounded governance memory ${String(index)}`,
      })
    }
  }

  const state = store.governanceState('owner', 3)
  assert.equal(state.spaces.length, 2)
  assert.equal(state.memories.length, 3)
})

test('one owner can batch-remove one thousand source relationships', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Large membership', 'owner')
  const sessionIds = Array.from({ length: 1_000 }, (_, index) => `source-${String(index)}`)
  for (const sessionId of sessionIds) store.addSource('Large membership', 'owner', sessionId)

  assert.deepEqual(store.removeSources('Large membership', 'owner', sessionIds, 'retain'), {
    removedSources: 1_000,
    changedMemoryVersions: 0,
  })
  assert.deepEqual(store.listSpaceSources('Large membership', 'owner'), [])
})

test('provenance, lifecycle states, version chains, and recall usage remain inspectable', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Project', 'owner')
  const first = store.remember({
    spaceName: 'Project', sourceSessionId: 'owner', sourceSessionTitle: '标题规范',
    sourceSeqStart: 10, sourceSeqEnd: 12, creationMethod: 'manual', type: 'constraint',
    content: '标题必须控制在 80 个字符内。',
    sourceMessages: [
      { seq: 10, role: 'user', excerpt: '标题上限 80。' },
      { seq: 12, role: 'assistant', excerpt: '已确认 80 个字符。' },
    ],
  }).memory
  const second = store.createVersion(first.id, 'owner', {
    content: '标题必须控制在 70–75 个字符。', type: 'constraint', sourceSessionTitle: '标题规范修订',
  })
  const versions = store.listMemories('Project', 'owner', 20)
  assert.equal(versions.find(memory => memory.id === first.id).status, 'superseded')
  assert.equal(versions.find(memory => memory.id === first.id).supersededById, second.id)
  assert.equal(second.previousVersionId, first.id)
  assert.equal(second.versionRootId, first.id)
  assert.equal(second.versionNumber, 2)
  assert.equal(store.search('owner', '70–75', 8)[0].id, second.id)

  store.setMemoryStatus(second.id, 'owner', 'disputed')
  assert.deepEqual(store.search('owner', '70–75', 8), [])
  store.setMemoryStatus(second.id, 'owner', 'active')
  store.recordRecallUsage([second.id], 'owner')
  const pending = store.listMemories('Project', 'owner', 20).find(memory => memory.id === second.id)
  assert.deepEqual(pending.recentUsages, [])
  store.attachRecallUsages('owner', 77)
  const inspected = store.listMemories('Project', 'owner', 20).find(memory => memory.id === second.id)
  assert.equal(inspected.sourceSessionTitle, '标题规范修订')
  assert.deepEqual(inspected.sourceMessages.map(message => message.seq), [10, 12])
  assert.deepEqual(inspected.recentUsages[0], { targetSessionId: 'owner', responseSeq: 77, usedAt: inspected.recentUsages[0].usedAt })
})

test('time-expired active memories are removed from recall and the FTS index', async (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Expiry', 'owner')
  const memory = store.remember({
    spaceName: 'Expiry', sourceSessionId: 'owner', type: 'temporary',
    content: '短期部署口令已经失效。', expiresAt: Date.now() + 10,
  }).memory
  await new Promise(resolve => setTimeout(resolve, 20))

  assert.deepEqual(store.search('owner', '部署口令', 8), [])
  assert.equal(store.listMemories('Expiry', 'owner', 10).find(value => value.id === memory.id).status, 'expired')
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
})

test('FTS and fallback queries handle multilingual text and reserved syntax deterministically', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Queries', 'owner')
  store.remember({
    spaceName: 'Queries', sourceSessionId: 'owner', type: 'fact',
    content: '商品型号 AB-123 的 ASIN 是 B0TEST123，支持中文检索和 Überprüfung。',
  })
  const queries = [
    '', '商', '商品', '商品型', 'ASIN', 'Überprüfung', '中文 ASIN', 'AB-123',
    '"quoted"', '(parentheses)', '*', '-', 'AND OR NOT NEAR', '😀', '商品\nASIN',
  ]
  for (const query of queries) {
    const first = store.search('owner', query, 8).map(memory => memory.id)
    const second = store.search('owner', query, 8).map(memory => memory.id)
    assert.deepEqual(second, first, `query ${JSON.stringify(query)} must be stable`)
  }
  assert.equal(store.search('owner', '商品', 8).length, 1)
  assert.equal(store.search('owner', '商品型', 8).length, 1)
  assert.equal(store.search('owner', 'AB-123', 8).length, 1)
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
})

test('database boundary validation rejects malformed governance, provenance, and snapshot input', (t) => {
  const store = createStore()
  t.after(() => store.close())
  const invalid = operation => assert.throws(
    operation,
    error => error instanceof MemorySpaceError && error.code === 'INVALID_INPUT',
  )
  invalid(() => store.createSpace('', 'owner'))
  invalid(() => store.createSpace('x'.repeat(81), 'owner'))
  store.createSpace('Bounds', 'owner')
  assert.throws(
    () => store.createSpace('bounds', 'owner'),
    error => error instanceof MemorySpaceError && error.code === 'SPACE_EXISTS',
  )
  invalid(() => store.addConsumer('Bounds', 'owner', 'consumer', 'invalid'))
  invalid(() => store.setConsumerModes('Bounds', 'owner', [], 'automatic'))
  invalid(() => store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'invalid', content: 'value' }))
  invalid(() => store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', creationMethod: 'invalid', content: 'value' }))
  invalid(() => store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: '   ' }))
  invalid(() => store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'x'.repeat(8_193) }))
  invalid(() => store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'value', sourceSeqStart: 1 }))
  invalid(() => store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'value', sourceSeqStart: 2, sourceSeqEnd: 1 }))
  invalid(() => store.remember({
    spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'value',
    sourceMessages: [{ seq: 1, role: 'user', excerpt: 'a' }, { seq: 1, role: 'assistant', excerpt: 'b' }],
  }))
  invalid(() => store.remember({
    spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'value',
    sourceMessages: [{ seq: 1, role: 'invalid', excerpt: 'a' }],
  }))
  invalid(() => store.remember({
    spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'value', expiresAt: Date.now() - 1,
  }))
  invalid(() => store.listMemories('Bounds', 'owner', 0))
  const memory = store.remember({ spaceName: 'Bounds', sourceSessionId: 'owner', type: 'fact', content: 'valid' }).memory
  invalid(() => store.setMemoryStatus(memory.id, 'owner', 'invalid'))
  assert.equal(store.attachRecallUsages('owner', -1), 0)
  assert.equal(store.attachRecallUsages('owner', 1.5), 0)
  assert.deepEqual(store.memoriesByIds('owner', [memory.id, 'missing-memory-id']), [memory])

  invalid(() => store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: 'Past', content: 'value', expiresAt: Date.now() - 1, maxUses: 1 }))
  invalid(() => store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: 'Uses', content: 'value', expiresAt: Date.now() + 60_000, maxUses: 0 }))
  invalid(() => store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: '', content: 'value', expiresAt: Date.now() + 60_000, maxUses: 1 }))
  invalid(() => store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: 'Empty', content: ' ', expiresAt: Date.now() + 60_000, maxUses: 1 }))
  invalid(() => store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: 'Large', content: 'x'.repeat(65_537), expiresAt: Date.now() + 60_000, maxUses: 1 }))
  invalid(() => store.inspectShareLink('short'))
  assert.equal(store.listMemories('Bounds', 'owner', 20).length, 1)
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
})

test('source removal preserves the independent consumer relation and offers three contribution dispositions', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Shared', 'owner')
  store.addSource('Shared', 'owner', 'peer')
  store.addConsumer('Shared', 'owner', 'peer', 'automatic')
  const retained = store.remember({ spaceName: 'Shared', sourceSessionId: 'peer', sourceSessionTitle: 'Peer', sourceSeqStart: 1, sourceSeqEnd: 2, type: 'fact', content: '保留这条贡献。', sourceMessages: [{ seq: 1, role: 'user', excerpt: '保留。' }] }).memory
  assert.equal(store.removeOwnSource('Shared', 'peer', 'retain'), 0)
  assert.equal(store.search('owner', '保留这条', 8)[0].id, retained.id)
  assert.equal(store.listSpaces('peer')[0].consumer.mode, 'automatic')
  assert.equal(store.listSpaces('peer')[0].source, undefined)

  store.addSource('Shared', 'owner', 'peer')
  const deleted = store.remember({ spaceName: 'Shared', sourceSessionId: 'peer', type: 'fact', content: '删除这条贡献。' }).memory
  assert.equal(store.removeOwnSource('Shared', 'peer', 'delete_contributions'), 2)
  assert.equal(store.listMemories('Shared', 'owner', 20).find(memory => memory.id === deleted.id).status, 'deleted')

  store.addSource('Shared', 'owner', 'peer')
  const cleared = store.remember({ spaceName: 'Shared', sourceSessionId: 'peer', sourceSessionTitle: '敏感来源', sourceSeqStart: 9, sourceSeqEnd: 9, type: 'fact', content: '保留内容但清除来源。', sourceMessages: [{ seq: 9, role: 'user', excerpt: '原始来源。' }] }).memory
  assert.equal(store.removeOwnSource('Shared', 'peer', 'clear_provenance'), 3)
  const after = store.listMemories('Shared', 'owner', 20).find(memory => memory.id === cleared.id)
  assert.equal(after.provenanceCleared, true)
  assert.equal(after.sourceSessionId, undefined)
  assert.deepEqual(after.sourceMessages, [])
  store.removeOwnConsumer('Shared', 'peer')
  assert.deepEqual(store.listSpaces('peer'), [])
})

test('owners inspect and update source and consumer relationships independently', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Managed', 'owner')
  store.addSource('Managed', 'owner', 'design')
  store.addSource('Managed', 'owner', 'api')
  store.addConsumer('Managed', 'owner', 'design', 'automatic')
  store.addConsumer('Managed', 'owner', 'api', 'paused')
  const designMemory = store.remember({ spaceName: 'Managed', sourceSessionId: 'design', type: 'decision', content: '设计会话贡献。' }).memory
  store.remember({ spaceName: 'Managed', sourceSessionId: 'api', type: 'fact', content: '接口会话贡献。' })
  store.recordRecallUsage([designMemory.id], 'design')
  store.attachRecallUsages('design', 20)

  const sources = store.listSpaceSources('Managed', 'design')
  assert.deepEqual(sources.map(view => view.source.sessionId).sort(), ['api', 'design'])
  assert.equal(sources.find(view => view.source.sessionId === 'design').contributionCount, 1)
  const consumers = store.listSpaceConsumers('Managed', 'design')
  assert.deepEqual(consumers.map(view => view.consumer.sessionId).sort(), ['api', 'design', 'owner'])
  assert.equal(typeof consumers.find(view => view.consumer.sessionId === 'design').lastUsedAt, 'number')

  const changed = store.setConsumerModes('Managed', 'owner', ['design', 'api'], 'confirm')
  assert.deepEqual(changed.map(consumer => consumer.mode), ['confirm', 'confirm'])
  assert.throws(
    () => store.setConsumerModes('Managed', 'owner', ['design', 'missing'], 'automatic'),
    error => error instanceof MemorySpaceError && error.code === 'USE_DENIED',
  )
  assert.equal(store.listSpaceConsumers('Managed', 'owner').find(view => view.consumer.sessionId === 'design').consumer.mode, 'confirm')

  const removedSources = store.removeSources('Managed', 'owner', ['design', 'api'], 'delete_contributions')
  assert.deepEqual(removedSources, { removedSources: 2, changedMemoryVersions: 2 })
  assert.deepEqual(store.listSpaceSources('Managed', 'owner'), [])
  assert.deepEqual(store.listSpaceConsumers('Managed', 'owner').map(view => view.consumer.sessionId).sort(), ['api', 'design', 'owner'])
  assert.deepEqual(store.removeConsumers('Managed', 'owner', ['design', 'api']), { removedConsumers: 2 })
  assert.deepEqual(store.listSpaceConsumers('Managed', 'owner').map(view => view.consumer.sessionId), ['owner'])
  assert.equal(store.listMemories('Managed', 'owner', 20).find(memory => memory.id === designMemory.id).status, 'deleted')
})

test('only active records remain searchable and deleting a space requires its owner', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('UI', 'owner')
  const saved = store.remember({ spaceName: 'UI', sourceSessionId: 'owner', type: 'preference', content: 'UI cards should use compact spacing.' }).memory
  assert.equal(store.search('owner', 'compact spacing', 8).length, 1)
  store.setMemoryStatus(saved.id, 'owner', 'expired')
  assert.deepEqual(store.search('owner', 'compact spacing', 8), [])
  assert.throws(() => store.deleteSpace('UI', 'outsider'), error => error instanceof MemorySpaceError && error.code === 'OWNER_REQUIRED')
  store.deleteSpace('UI', 'owner')
  assert.deepEqual(store.listSpaces('owner'), [])
})

test('memory lifecycle rejects arbitrary jumps and stale-version revision', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Lifecycle', 'owner')
  const first = store.remember({
    spaceName: 'Lifecycle', sourceSessionId: 'owner', type: 'constraint', content: 'Use version one.',
  }).memory
  const second = store.createVersion(first.id, 'owner', {
    type: 'constraint', content: 'Use version two.',
  })

  assert.throws(
    () => store.createVersion(first.id, 'owner', { type: 'constraint', content: 'Stale branch.' }),
    error => error instanceof MemorySpaceError
      && error.code === 'INVALID_INPUT'
      && error.message.includes('current active'),
  )
  assert.throws(
    () => store.setMemoryStatus(first.id, 'owner', 'active'),
    error => error instanceof MemorySpaceError
      && error.code === 'INVALID_INPUT'
      && error.message.includes('cannot change'),
  )
  store.setMemoryStatus(second.id, 'owner', 'disputed')
  assert.throws(
    () => store.setMemoryStatus(second.id, 'owner', 'expired'),
    error => error instanceof MemorySpaceError && error.code === 'INVALID_INPUT',
  )
  assert.deepEqual(store.search('owner', 'version two', 8), [])
  assert.equal(store.listMemories('Lifecycle', 'owner', 10).find(memory => memory.id === second.id).status, 'disputed')
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
})

test('a later generated history import supersedes only that Session previous summary', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Shared', 'owner')
  store.addSource('Shared', 'owner', 'peer')
  const first = store.replaceHistorySummary({ spaceName: 'Shared', sourceSessionId: 'peer', sourceSessionTitle: 'Peer', sourceSeqStart: 1, sourceSeqEnd: 8, sourceMessages: [], content: `${HISTORY_SUMMARY_PREFIX}\n\nFound one Cordis record.` })
  store.remember({ spaceName: 'Shared', sourceSessionId: 'peer', type: 'fact', content: 'A manually selected fact remains active.' })
  const second = store.replaceHistorySummary({ spaceName: 'Shared', sourceSessionId: 'peer', sourceSessionTitle: 'Peer', sourceSeqStart: 1, sourceSeqEnd: 12, sourceMessages: [], content: `${HISTORY_SUMMARY_PREFIX}\n\nFound two Cordis records.` })
  assert.equal(first.replacedSummaries, 0)
  assert.equal(second.replacedSummaries, 1)
  const versions = store.listMemories('Shared', 'owner', 20)
  assert.equal(versions.find(memory => memory.id === first.memory.id).status, 'superseded')
  assert.equal(versions.find(memory => memory.id === second.memory.id).status, 'active')
  assert.equal(store.search('owner', 'manually selected fact', 8).length, 1)
})

test('schema version 3 memberships migrate without losing their intended relationships', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-spaces-v3-'))
  const databasePath = join(directory, 'memory.sqlite')
  const fixture = createFullSchemaThreeFixture(databasePath)

  const store = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 })
  t.after(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  assert.equal(store.listSpaces('reader')[0].consumer.mode, 'automatic')
  assert.equal(store.listSpaces('reader')[0].source, undefined)
  assert.equal(store.listSpaces('writer')[0].consumer, undefined)
  assert.equal(store.listSpaces('writer')[0].source.sessionId, 'writer')
  assert.equal(store.listSpaces('both')[0].consumer.mode, 'automatic')
  assert.equal(store.listSpaces('both')[0].source.sessionId, 'both')
  assert.equal(store.listSpaces('manual')[0].consumer.mode, 'confirm')
  assert.equal(store.listSpaces('manual')[0].source.sessionId, 'manual')
  assert.equal(store.listSpaces('archive-owner')[0].space.name, 'Archive')
  const memories = store.listMemories('Legacy', 'owner', 20)
  assert.equal(memories.find(memory => memory.id === fixture.first.id).status, 'superseded')
  assert.equal(memories.find(memory => memory.id === fixture.second.id).status, 'active')
  assert.equal(memories.find(memory => memory.id === fixture.second.id).recentUsages[0].responseSeq, 42)
  assert.equal(memories.find(memory => memory.id === fixture.disputed.id).status, 'disputed')
  assert.equal(store.listMemories('Archive', 'archive-owner', 20)[0].id, fixture.archive.id)
  assert.equal(store.search('owner', '70 75 characters', 8)[0].id, fixture.second.id)
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
  assert.equal(store.openConversationShare(fixture.accessToken).snapshots[0].sourceSeqStart, 3)
  const backups = readdirSync(directory).filter(name => name.includes('.schema-3-backup-') && name.endsWith('.sqlite'))
  assert.equal(backups.length, 1)
  const backupPath = join(directory, backups[0])
  assert.equal(existsSync(backupPath), true)
  const backup = new DatabaseSync(backupPath, { readOnly: true })
  assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 3)
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  backup.close()
})

test('two processes can race to migrate one schema 3 database without corruption', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-spaces-v3-race-'))
  const databasePath = join(directory, 'memory.sqlite')
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  const fixture = createFullSchemaThreeFixture(databasePath)

  await Promise.all([runMigrationProcess(databasePath), runMigrationProcess(databasePath)])

  const database = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 4)
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM space_consumers').get().count, 5)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM space_sources').get().count, 5)
  assert.equal(database.prepare('SELECT status FROM memories WHERE id = ?').get(fixture.second.id).status, 'active')
  database.close()

  const reopened = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 5_000, maxMemoryBytes: 8_192 })
  assert.deepEqual(reopened.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
  reopened.close()
})

test('unknown schemas fail without changing their version, data, or journal mode', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-spaces-unknown-'))
  const databasePath = join(directory, 'memory.sqlite')
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  const unknown = new DatabaseSync(databasePath)
  unknown.exec(`
    CREATE TABLE marker (value TEXT NOT NULL);
    INSERT INTO marker VALUES ('preserve-me');
    PRAGMA user_version = 99;
  `)
  assert.equal(unknown.prepare('PRAGMA journal_mode').get().journal_mode, 'delete')
  unknown.close()

  assert.throws(
    () => new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 }),
    /schema 99 is unsupported/u,
  )

  const after = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 99)
  assert.equal(after.prepare('SELECT value FROM marker').get().value, 'preserve-me')
  assert.equal(after.prepare('PRAGMA journal_mode').get().journal_mode, 'delete')
  after.close()
  assert.equal(readdirSync(directory).some(name => name.endsWith('-wal')), false)
})

test('spaces, provenance, lifecycle, and FTS survive a database restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-spaces-restart-'))
  const databasePath = join(directory, 'memory.sqlite')
  let store = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 })
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  store.createSpace('Persistent', 'owner')
  const saved = store.remember({
    spaceName: 'Persistent', sourceSessionId: 'owner', sourceSessionTitle: 'Persistent source',
    sourceSeqStart: 3, sourceSeqEnd: 3, type: 'decision', content: 'Persist the FTS record.',
    sourceMessages: [{ seq: 3, role: 'user', excerpt: 'Persist it.' }],
  }).memory
  store.close()
  store.close()

  store = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 })
  assert.equal(store.search('owner', 'Persist FTS', 8)[0].id, saved.id)
  const restored = store.listMemories('Persistent', 'owner', 8)[0]
  assert.equal(restored.sourceSessionTitle, 'Persistent source')
  assert.deepEqual(restored.sourceMessages.map(message => message.seq), [3])
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
  store.close()
  const database = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  database.close()
})

test('a failed schema 3 migration rolls back and can be repaired from the untouched source database', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-spaces-migration-failure-'))
  const databasePath = join(directory, 'memory.sqlite')
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    CREATE TABLE memory_spaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      owner_session_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE space_sessions (
      space_id TEXT NOT NULL, session_id TEXT NOT NULL,
      mode TEXT NOT NULL, joined_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, session_id)
    );
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, status TEXT NOT NULL,
      source_session_id TEXT, updated_at INTEGER NOT NULL, expires_at INTEGER
    );
    INSERT INTO memory_spaces VALUES ('space', 'Recoverable', 'owner', 1, 1);
    INSERT INTO space_sessions VALUES ('space', 'reader', 'read', 1, 1);
    PRAGMA user_version = 3;
  `)
  legacy.close()

  assert.throws(
    () => new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 }),
    /no such index: space_sessions_by_session/u,
  )
  const rolledBack = new DatabaseSync(databasePath)
  assert.equal(rolledBack.prepare('PRAGMA user_version').get().user_version, 3)
  assert.equal(rolledBack.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'space_consumers'").get().count, 0)
  assert.equal(rolledBack.prepare('SELECT COUNT(*) AS count FROM space_sessions').get().count, 1)
  assert.equal(rolledBack.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  rolledBack.exec('CREATE INDEX space_sessions_by_session ON space_sessions(session_id, space_id)')
  rolledBack.close()

  const recovered = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 })
  assert.equal(recovered.listSpaces('reader')[0].consumer.mode, 'automatic')
  recovered.close()
  assert.ok(readdirSync(directory).some(name => name.includes('.schema-3-backup-')))
})
