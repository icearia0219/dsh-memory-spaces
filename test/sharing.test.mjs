import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { collectConversationShare, MemorySpaceError, MemoryStore, scanSensitiveContent } from '../lib/index.js'

function createStore() {
  return new MemoryStore({
    databasePath: ':memory:',
    journalMode: 'wal',
    busyTimeoutMs: 100,
    maxMemoryBytes: 8_192,
  })
}

test('conversation projection includes only selected visible text', () => {
  const events = []
  events[0] = {
    seq: 0, type: 'user/message', surfaceOp: 'append',
    data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '<script>alert(1)</script>' }] }),
  }
  events[1] = {
    seq: 1, type: 'assistant/message', surfaceOp: 'append',
    data: {
      turn: 1, step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [
          { type: 'reasoning', text: 'hidden chain of thought' },
          { type: 'text', text: 'Visible answer.' },
        ],
      }),
    },
  }
  events[2] = {
    seq: 2, type: 'user/message', surfaceOp: 'append',
    data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Unselected message.' }] }),
  }
  events[3] = {
    seq: 3, type: 'user/message', surfaceOp: 'append',
    data: createUserMessage({
      source: { kind: 'plugin', plugin: 'memory-spaces', form: 'recall' },
      content: [{ type: 'text', text: 'Injected memory must not be shared.' }],
    }),
  }
  const session = { id: 'session', events, surface: { nodes: [0, 1, 2, 3] } }
  const selected = collectConversationShare(session, {
    seqs: [0, 1, 3], includeToolResults: false, maxBytes: 8_192,
  })

  assert.match(selected.text, /<script>alert\(1\)<\/script>/u)
  assert.match(selected.text, /Visible answer/u)
  assert.doesNotMatch(selected.text, /hidden chain|Unselected|Injected memory/u)
  assert.deepEqual(selected.sourceMessages.map(message => message.seq), [0, 1])
})

test('read-only snapshot links never create a memory-space relationship', (t) => {
  const store = createStore()
  t.after(() => store.close())
  store.createSpace('Sellora', 'owner')
  const shared = store.createConversationShare({
    sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 2,
    title: 'Selected messages', content: '[用户 · 事件 1]\n共享快照',
    expiresAt: Date.now() + 60_000,
    maxUses: 1,
    accessToken: 'A'.repeat(43), editToken: 'B'.repeat(43),
  })
  assert.equal(store.openConversationShare(shared.token).snapshots.length, 1)
  assert.deepEqual(store.listSpaces('remote-session'), [])
  assert.equal(typeof store.createSpaceInvite, 'undefined')
  assert.equal(typeof store.acceptSpaceInvite, 'undefined')
})

test('snapshot links are revocable and use-limited', (t) => {
  const store = createStore()
  t.after(() => store.close())
  const limited = store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: 'One use', content: 'one use', expiresAt: Date.now() + 60_000, maxUses: 1, accessToken: 'E'.repeat(43), editToken: 'F'.repeat(43) })
  assert.equal(store.inspectShareLink(limited.token).link.useCount, 0)
  store.openConversationShare(limited.token)
  assert.throws(
    () => store.openConversationShare(limited.token),
    error => error instanceof MemorySpaceError
      && error.code === 'INVALID_INPUT'
      && error.message.includes('use limit'),
  )
  const revoked = store.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 2, sourceSeqEnd: 2, title: 'Revoked', content: 'revoked', expiresAt: Date.now() + 60_000, maxUses: 2 })
  store.revokeShareLink(revoked.link.id, 'owner')
  assert.throws(
    () => store.inspectShareLink(revoked.token),
    error => error instanceof MemorySpaceError
      && error.code === 'INVALID_INPUT'
      && error.message.includes('revoked'),
  )
})

test('snapshot tokens are independent, hashed at rest, and omitted from errors', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-share-token-'))
  const databasePath = join(directory, 'memory.sqlite')
  const store = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 100, maxMemoryBytes: 8_192 })
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  const shared = store.createConversationShare({
    sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1,
    title: 'Hashed', content: 'hashed tokens', expiresAt: Date.now() + 60_000, maxUses: 2,
  })
  assert.equal(shared.token.length, 43)
  assert.equal(shared.editToken.length, 43)
  assert.notEqual(shared.token, shared.editToken)

  const database = new DatabaseSync(databasePath, { readOnly: true })
  const row = database.prepare('SELECT access_token_hash, edit_token_hash FROM share_links WHERE id = ?')
    .get(shared.link.id)
  database.close()
  assert.equal(row.access_token_hash, createHash('sha256').update(shared.token).digest('hex'))
  assert.equal(row.edit_token_hash, createHash('sha256').update(shared.editToken).digest('hex'))
  assert.equal(JSON.stringify(row).includes(shared.token), false)
  assert.equal(JSON.stringify(row).includes(shared.editToken), false)

  assert.throws(
    () => store.createConversationShare({
      sourceSessionId: 'owner', sourceSeqStart: 2, sourceSeqEnd: 2,
      title: 'Same', content: 'same token', expiresAt: Date.now() + 60_000, maxUses: 1,
      accessToken: 'Z'.repeat(43), editToken: 'Z'.repeat(43),
    }),
    error => error instanceof MemorySpaceError && error.message.includes('independent'),
  )
  const unknown = 'Y'.repeat(43)
  assert.throws(
    () => store.inspectShareLink(unknown),
    error => error instanceof MemorySpaceError && !error.message.includes(unknown),
  )
})

test('snapshot expiry is enforced without consuming a use', async (t) => {
  const store = createStore()
  t.after(() => store.close())
  const shared = store.createConversationShare({
    sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1,
    title: 'Expires', content: 'expires soon', expiresAt: Date.now() + 10, maxUses: 2,
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.throws(
    () => store.openConversationShare(shared.token),
    error => error instanceof MemorySpaceError && error.message.includes('expired'),
  )
  assert.equal(store.listShareLinks('owner')[0].useCount, 0)
})

test('a one-use snapshot remains atomic across many store handles', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-share-concurrency-'))
  const databasePath = join(directory, 'memory.sqlite')
  const creator = new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 1_000, maxMemoryBytes: 8_192 })
  const readers = Array.from({ length: 20 }, () => new MemoryStore({ databasePath, journalMode: 'wal', busyTimeoutMs: 1_000, maxMemoryBytes: 8_192 }))
  t.after(() => { creator.close(); for (const reader of readers) reader.close(); rmSync(directory, { recursive: true, force: true }) })
  const shared = creator.createConversationShare({ sourceSessionId: 'owner', sourceSeqStart: 1, sourceSeqEnd: 1, title: 'One', content: 'one', expiresAt: Date.now() + 60_000, maxUses: 1 })

  const results = readers.map(reader => {
    try { reader.openConversationShare(shared.token); return 'opened' }
    catch (error) { assert.ok(error instanceof MemorySpaceError); return 'rejected' }
  })

  assert.equal(results.filter(result => result === 'opened').length, 1)
  assert.equal(results.filter(result => result === 'rejected').length, 19)
})

test('conversation links use separate read and append tokens', (t) => {
  const store = createStore()
  t.after(() => store.close())
  const shared = store.createConversationShare({
    sourceSessionId: 'session-a',
    sourceSeqStart: 2,
    sourceSeqEnd: 4,
    title: 'Selected messages',
    content: '[用户 · 事件 2]\n你好\n\n[助手 · 事件 4]\n你好，需要什么帮助？',
    expiresAt: Date.now() + 60_000,
    maxUses: 2,
    accessToken: 'C'.repeat(43),
    editToken: 'D'.repeat(43),
  })
  assert.notEqual(shared.token, shared.editToken)
  assert.throws(() => store.appendConversationShare({
    editToken: shared.token,
    sourceSessionId: 'session-b',
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    title: 'Wrong token',
    content: 'must fail',
  }), error => error instanceof MemorySpaceError)
  store.appendConversationShare({
    editToken: shared.editToken,
    sourceSessionId: 'session-b',
    sourceSeqStart: 8,
    sourceSeqEnd: 9,
    title: 'Second history',
    content: '[用户 · 事件 8]\n第二份会话',
  })
  const opened = store.openConversationShare(shared.token)
  assert.deepEqual(opened.snapshots.map(snapshot => snapshot.title), ['Selected messages', 'Second history'])
  assert.equal(opened.link.useCount, 1)
})

test('sensitive review reports categories without echoing secret values', () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
  const findings = scanSensitiveContent(`请使用 API_KEY=${secret}`)
  assert.deepEqual(findings.map(finding => finding.label), [
    'sk- 形式的 API Key',
    '疑似密钥或令牌赋值',
  ])
  assert.equal(JSON.stringify(findings).includes(secret), false)
})
