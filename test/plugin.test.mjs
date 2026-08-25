import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { apply, decodeMemoryShareResult, decodeMemoryUiResult } from '../lib/index.js'

function harness(overrides = {}, summaryTexts = ['## Goals and context\n- Test summary']) {
  const disposers = []
  const warnings = []
  const summaryRequests = []
  const commands = new Map()
  let preStep
  let sessionEvent
  const ctx = {
    commands: {
      register(definition) {
        commands.set(definition.name, definition)
        return () => { commands.delete(definition.name) }
      },
    },
    effect(factory) {
      disposers.push(factory())
    },
    on(event, listener) {
      if (event === 'agent/pre-step') preStep = listener
      if (event === 'session/event') sessionEvent = listener
      return () => {
        if (event === 'agent/pre-step') preStep = undefined
        if (event === 'session/event') sessionEvent = undefined
      }
    },
    logger: {
      warn(message) { warnings.push(message) },
      error(message) { warnings.push(message) },
    },
    llm: {
      async *stream(options) {
        summaryRequests.push(options)
        const text = summaryTexts[summaryRequests.length - 1] ?? summaryTexts.at(-1)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  }
  apply(ctx, {
    databasePath: ':memory:',
    journalMode: 'wal',
    busyTimeoutMs: 100,
    maxMemoryBytes: 8_192,
    maxQueryBytes: 4_096,
    maxRecallItems: 8,
    maxRecallBytes: 16_384,
    ...overrides,
  })
  return {
    commands,
    get preStep() { return preStep },
    warnings,
    summaryRequests,
    emitSessionEvent(session, event) { sessionEvent?.(session, event) },
    close() { for (const dispose of disposers.reverse()) dispose() },
  }
}

function agent(id) {
  const events = []
  return {
    id,
    options: { provider: 'test-provider', model: 'test-model' },
    session: {
      id,
      events,
      surface: {
        get nodes() {
          return events.filter(event => event.surfaceOp !== undefined).map(event => event.seq)
        },
      },
      requestHeader() {
        return { config: { provider: 'test-provider', model: 'test-model' } }
      },
    },
  }
}

function appendUser(currentAgent, seq, text, source = { kind: 'user' }) {
  currentAgent.session.events[seq] = {
    seq,
    type: 'user/message',
    data: createUserMessage({ source, content: [{ type: 'text', text }] }),
    surfaceOp: 'append',
  }
}

function appendAssistant(currentAgent, seq, text) {
  currentAgent.session.events[seq] = {
    seq,
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test-provider', model: 'test-model' },
        content: [{ type: 'text', text }],
      }),
    },
    surfaceOp: 'append',
  }
}

async function runCommand(subject, currentAgent, seq, rawInput, source = { kind: 'user' }) {
  const commandId = `command-${seq}`
  currentAgent.session.events[seq] = {
    seq,
    type: 'command/run',
    data: { commandId, name: 'memory', args: rawInput, source },
  }
  return subject.commands.get('memory').handler({
    commandId,
    agent: currentAgent,
    rawInput,
    signal: new AbortController().signal,
  })
}

async function runUi(subject, currentAgent, seq, operation, payload, source = { kind: 'user' }) {
  const commandId = `memory-ui-${seq}`
  currentAgent.session.events[seq] = {
    seq,
    type: 'command/run',
    data: { commandId, name: 'memory-space-ui', args: operation, source },
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return subject.commands.get('memory-space-ui').handler({
    commandId,
    agent: currentAgent,
    rawInput: `${operation} ${encoded}`,
    signal: new AbortController().signal,
  })
}

async function runShare(subject, currentAgent, seq, operation, payload, source = { kind: 'user' }) {
  const commandId = `memory-share-${seq}`
  currentAgent.session.events[seq] = {
    seq,
    type: 'command/run',
    data: { commandId, name: 'memory-share', args: operation, source },
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return subject.commands.get('memory-share').handler({
    commandId,
    agent: currentAgent,
    rawInput: `${operation} ${encoded}`,
    signal: new AbortController().signal,
  })
}

async function runRawPrivate(subject, currentAgent, seq, name, rawInput) {
  const commandId = `${name}-${seq}`
  currentAgent.session.events[seq] = {
    seq,
    type: 'command/run',
    data: { commandId, name, args: rawInput, source: { kind: 'user' } },
  }
  return subject.commands.get(name).handler({
    commandId,
    agent: currentAgent,
    rawInput,
    signal: new AbortController().signal,
  })
}

async function createSpace(subject, owner, seq, name = 'Sellora') {
  const created = await runUi(subject, owner, seq, 'create-space', { spaceName: name })
  assert.equal(created.kind, 'success')
}

async function addSource(subject, owner, target, seq) {
  const added = await runUi(subject, owner, seq, 'add-source', {
    spaceName: 'Sellora', targetSessionId: target.id,
  })
  assert.equal(added.kind, 'success')
}

async function addConsumer(subject, owner, target, seq, mode = 'automatic') {
  const added = await runUi(subject, owner, seq, 'add-consumer', {
    spaceName: 'Sellora', targetSessionId: target.id, mode,
  })
  assert.equal(added.kind, 'success')
}

test('human commands establish sharing and pre-step injects durable untrusted context', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const source = agent('source-session')
  const target = agent('target-session')

  await createSpace(subject, source, 1)
  assert.equal((await runCommand(
    subject,
    source,
    2,
    ' remember Sellora constraint "UI changes must not alter API routes."',
  )).kind, 'success')
  await addConsumer(subject, source, target, 3)

  const direct = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'May I alter the API routes for this UI change?' }],
  })
  const decision = await subject.preStep(
    { agent: target, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [direct] }),
  )
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 2)
  assert.deepEqual(decision.messages[0].source, {
    kind: 'plugin',
    plugin: 'memory-spaces',
    form: 'recall',
    sections: [{
      name: 'shared-memory-spaces',
      text: decision.messages[0].content[0].text,
    }],
  })
  assert.match(decision.messages[0].content[0].text, /"source"/u)
  assert.equal(decision.messages[1], direct)
})

test('durable public commands reject non-user command events without changing memory', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  await createSpace(subject, owner, 0)

  const generated = await runCommand(
    subject,
    owner,
    1,
    ' remember Sellora fact "must not persist"',
    { kind: 'model', provider: 'test', model: 'test' },
  )

  assert.equal(generated.kind, 'error')
  assert.match(generated.text, /direct user command/u)
  const shown = await runCommand(subject, owner, 2, ' show Sellora')
  assert.match(shown.text, /No memory versions/u)
})

test('public command validation returns safe failures without changing memory', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  await createSpace(subject, owner, 0)
  const help = await runCommand(subject, owner, 1, '')
  assert.match(help.text, /Usage:/u)
  assert.equal((await runCommand(subject, owner, 2, ' remember Sellora fact')).kind, 'error')
  assert.match((await runCommand(subject, owner, 3, ' remember Sellora invalid value')).text, /Memory type/u)
  assert.match((await runCommand(subject, owner, 4, ' forget')).text, /Usage:/u)
  assert.match((await runCommand(subject, owner, 5, ' show')).text, /Usage:/u)
  assert.match((await runCommand(subject, owner, 6, ' preview')).text, /Usage:/u)
  assert.match((await runCommand(subject, owner, 7, ' unknown')).text, /Unknown memory command/u)
  const shown = await runCommand(subject, owner, 8, ' show Sellora')
  assert.match(shown.text, /No memory versions/u)
})

test('automatic recall is injected at most once before the target turn ends', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const target = agent('target-session')
  await createSpace(subject, owner, 0)
  await runCommand(subject, owner, 1, ' remember Sellora constraint "Do not change API routes."')
  await addConsumer(subject, owner, target, 2)
  const direct = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Can API routes change?' }] })

  const first = await subject.preStep({ agent: target, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [direct] }))
  const second = await subject.preStep({ agent: target, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [direct] }))

  assert.equal(first.messages.length, 2)
  assert.equal(second.messages.length, 1)
  subject.emitSessionEvent(target.session, { type: 'assistant/message', seq: 8, data: { turn: 1, step: 1, message: {} } })
  subject.emitSessionEvent(target.session, { type: 'turn/end', seq: 9, data: { turn: 1, reason: { kind: 'stop' } } })
  const nextTurn = await subject.preStep({ agent: target, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [direct] }))
  assert.equal(nextTurn.messages.length, 2)
})

test('disposing the plugin unregisters all command contributions', () => {
  const subject = harness()
  assert.equal(subject.commands.size, 3)
  assert.equal(subject.commands.get('memory-space-ui').recordInput, false)
  assert.equal(subject.commands.get('memory-share').recordInput, false)
  subject.close()
  assert.equal(subject.commands.size, 0)
})

test('browser-only governance and sharing reject non-user durable origins', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const modelSource = { kind: 'model', provider: 'test', model: 'test' }

  const create = decodeMemoryUiResult((await runUi(
    subject,
    owner,
    0,
    'create-space',
    { spaceName: 'Forbidden' },
    modelSource,
  )).text)
  assert.equal(create.ok, false)
  assert.match(create.error.message, /direct user command event/u)

  const shared = decodeMemoryShareResult((await runShare(
    subject,
    owner,
    1,
    'state',
    {},
    modelSource,
  )).text)
  assert.equal(shared.ok, false)
  assert.match(shared.error.message, /direct user command event/u)

  const state = decodeMemoryUiResult((await runUi(subject, owner, 2, 'state', {})).text)
  assert.deepEqual(state.value.spaces, [])
})

test('conversation links reject an omitted message selection', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  appendUser(owner, 0, 'This message must not be shared implicitly.')

  const result = decodeMemoryShareResult((await runShare(subject, owner, 1, 'create-conversation', {
    title: 'Implicit history',
    includeToolResults: false,
    acknowledgeSensitive: true,
    expiresAt: Date.now() + 60_000,
    maxUses: 1,
    accessToken: 'A'.repeat(43),
    editToken: 'B'.repeat(43),
  })).text)

  assert.equal(result.ok, false)
  assert.match(result.error.message, /seqs must be a non-empty array/u)
  const state = decodeMemoryShareResult((await runShare(subject, owner, 2, 'state', {})).text)
  assert.deepEqual(state.value.links, [])
})

test('browser snapshot transport covers selection, append, open, and owner-only revocation', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const contributor = agent('contributor-session')
  const outsider = agent('outsider-session')
  appendUser(owner, 0, 'Selected owner message.')
  appendAssistant(owner, 1, 'Selected assistant response.')
  appendUser(contributor, 0, 'Selected appended message.')
  const accessToken = 'C'.repeat(43)
  const editToken = 'D'.repeat(43)

  const created = decodeMemoryShareResult((await runShare(subject, owner, 2, 'create-conversation', {
    title: 'Owner selection', seqs: [0, 1], includeToolResults: false,
    acknowledgeSensitive: false, expiresAt: Date.now() + 60_000, maxUses: 3,
    accessToken, editToken,
  })).text)
  assert.equal(created.ok, true)
  const linkId = created.value.link.id

  const appended = decodeMemoryShareResult((await runShare(subject, contributor, 1, 'append-conversation', {
    editToken, title: 'Contributor selection', seqs: [0],
    includeToolResults: false, acknowledgeSensitive: false,
  })).text)
  assert.equal(appended.ok, true)
  appendUser(contributor, 2, 'access_token=abcdefghijklmnopqrstuvwxyz123456')
  const blockedAppend = decodeMemoryShareResult((await runShare(subject, contributor, 3, 'append-conversation', {
    editToken, title: 'Blocked selection', seqs: [2],
    includeToolResults: false, acknowledgeSensitive: false,
  })).text)
  assert.equal(blockedAppend.ok, false)
  assert.equal(blockedAppend.error.code, 'sensitive-content')
  const inspected = decodeMemoryShareResult((await runShare(subject, outsider, 0, 'inspect', { token: accessToken })).text)
  assert.equal(inspected.value.link.useCount, 0)
  const opened = decodeMemoryShareResult((await runShare(subject, outsider, 1, 'open-conversation', { token: accessToken })).text)
  assert.deepEqual(opened.value.snapshots.map(snapshot => snapshot.title), ['Owner selection', 'Contributor selection'])

  const denied = decodeMemoryShareResult((await runShare(subject, outsider, 2, 'revoke', { linkId })).text)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'INVALID_INPUT')
  const revoked = decodeMemoryShareResult((await runShare(subject, owner, 3, 'revoke', { linkId })).text)
  assert.equal(revoked.ok, true)
  const unavailable = decodeMemoryShareResult((await runShare(subject, owner, 4, 'inspect', { token: accessToken })).text)
  assert.equal(unavailable.ok, false)
  assert.match(unavailable.error.message, /revoked/u)
  const unknown = decodeMemoryShareResult((await runShare(subject, owner, 5, 'unknown', {})).text)
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'unknown-operation')
})

test('browser snapshot transport blocks detected credentials until explicit review', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  appendUser(owner, 0, 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456')
  const payload = {
    title: 'Sensitive selection', seqs: [0], includeToolResults: false,
    acknowledgeSensitive: false, expiresAt: Date.now() + 60_000, maxUses: 1,
    accessToken: 'E'.repeat(43), editToken: 'F'.repeat(43),
  }
  const blocked = decodeMemoryShareResult((await runShare(subject, owner, 1, 'create-conversation', payload)).text)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'sensitive-content')
  assert.deepEqual(blocked.error.labels, ['sk- 形式的 API Key', '疑似密钥或令牌赋值'])

  const accepted = decodeMemoryShareResult((await runShare(subject, owner, 2, 'create-conversation', {
    ...payload, acknowledgeSensitive: true,
  })).text)
  assert.equal(accepted.ok, true)
})

test('private command transports reject malformed payloads and invalid result envelopes', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const malformedUi = decodeMemoryUiResult((await runRawPrivate(
    subject, owner, 0, 'memory-space-ui', 'state not-base64!',
  )).text)
  assert.equal(malformedUi.ok, false)
  const malformedShare = decodeMemoryShareResult((await runRawPrivate(
    subject, owner, 1, 'memory-share', 'state not-base64!',
  )).text)
  assert.equal(malformedShare.ok, false)
  const unknownUi = decodeMemoryUiResult((await runUi(subject, owner, 2, 'unknown', {})).text)
  assert.equal(unknownUi.error.code, 'unknown-operation')
  assert.throws(() => decodeMemoryUiResult('invalid'), /invalid prefix/u)
  assert.throws(() => decodeMemoryShareResult('invalid'), /invalid prefix/u)
  const invalidEnvelope = Buffer.from('{}', 'utf8').toString('base64url')
  assert.throws(() => decodeMemoryUiResult(`DSH_MEMORY_UI_V1:${invalidEnvelope}`), /invalid JSON value/u)
  assert.throws(() => decodeMemoryShareResult(`DSH_MEMORY_SHARE_V1:${invalidEnvelope}`), /invalid JSON value/u)
})

test('a runtime database failure logs a warning and does not block the accepted chat step', async () => {
  const subject = harness()
  const target = agent('target-session')
  const direct = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Recall this after the store closes.' }],
  })
  subject.close()
  const downstream = { kind: 'enter', messages: [direct] }
  const decision = await subject.preStep(
    { agent: target, signal: new AbortController().signal },
    async () => downstream,
  )
  assert.equal(decision, downstream)
  assert.equal(subject.warnings.length, 1)
  assert.match(subject.warnings[0], /continuing without shared memory/u)
})

test('a storage startup failure disables memory without blocking plugin activation', async (t) => {
  const subject = harness({ databasePath: process.cwd() })
  t.after(() => subject.close())
  const target = agent('target-session')
  const command = await runCommand(subject, target, 1, ' list')
  assert.deepEqual(command, {
    kind: 'error',
    text: 'Memory spaces are unavailable. See the host log for the storage failure.',
  })
  const ui = await runUi(subject, target, 2, 'state', {})
  assert.equal(ui.kind, 'error')
  const share = await runShare(subject, target, 3, 'state', {})
  assert.equal(share.kind, 'error')
  const direct = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Continue without memory.' }],
  })
  const downstream = { kind: 'enter', messages: [direct] }
  const decision = await subject.preStep(
    { agent: target, signal: new AbortController().signal },
    async () => downstream,
  )
  assert.equal(decision, downstream)
  assert.equal(subject.warnings.length, 1)
  assert.match(subject.warnings[0], /storage is unavailable/u)
})

test('configuration rejects invalid bounds and incomplete summary routes before registration', () => {
  assert.throws(() => harness({ databasePath: '' }), /databasePath must not be empty/u)
  assert.throws(() => harness({ maxRecallBytes: 511 }), /numeric bounds/u)
  assert.throws(() => harness({ maxRecallItems: 51 }), /numeric bounds/u)
  assert.throws(() => harness({ maxMemoryBytes: 1.5 }), /safe integer/u)
  assert.throws(
    () => harness({ historySummaryProvider: 'provider', historySummaryModel: '' }),
    /must both be set/u,
  )
  const defaults = harness({
    journalMode: undefined,
    busyTimeoutMs: undefined,
    maxMemoryBytes: undefined,
    maxQueryBytes: undefined,
    maxRecallItems: undefined,
    maxRecallBytes: undefined,
  })
  defaults.close()
})

test('pre-step leaves rejected, aborted, synthetic-only, and unmatched requests unchanged', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const target = agent('target-session')
  const rejected = { kind: 'reject', reason: 'blocked' }
  assert.equal(await subject.preStep(
    { agent: target, signal: new AbortController().signal },
    async () => rejected,
  ), rejected)

  const direct = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'No matches exist.' }] })
  const abortedController = new AbortController()
  abortedController.abort()
  const aborted = { kind: 'enter', messages: [direct] }
  assert.equal(await subject.preStep(
    { agent: target, signal: abortedController.signal },
    async () => aborted,
  ), aborted)

  const synthetic = createUserMessage({
    source: { kind: 'plugin', plugin: 'test' },
    content: [{ type: 'text', text: 'Synthetic query must be ignored.' }],
  })
  const syntheticDecision = { kind: 'enter', messages: [synthetic] }
  assert.equal(await subject.preStep(
    { agent: target, signal: new AbortController().signal },
    async () => syntheticDecision,
  ), syntheticDecision)
  const unmatched = { kind: 'enter', messages: [direct] }
  assert.equal(await subject.preStep(
    { agent: target, signal: new AbortController().signal },
    async () => unmatched,
  ), unmatched)
})

test('history import is opt-in, excludes recalled plugin context, and replaces its prior summary', async (t) => {
  const subject = harness({}, [
    '## Goals and context\n- Found one Cordis record.',
    '## Goals and context\n- Found one Cordis record and documented the inject rule.',
  ])
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const source = agent('source-session')
  await createSpace(subject, owner, 0)

  appendUser(source, 0, '搜索 Cordis 记录并告诉我数量。')
  appendUser(source, 1, 'SHOULD NOT BE REIMPORTED', {
    kind: 'plugin',
    plugin: 'memory-spaces',
    form: 'recall',
  })
  appendAssistant(source, 2, '找到 1 条记录，主题为 Cordis inject。')
  await addSource(subject, owner, source, 3)
  assert.equal(subject.summaryRequests.length, 0)

  const imported = await runCommand(subject, source, 4, ' import-history Sellora')
  assert.equal(imported.kind, 'success')
  assert.match(imported.text, /Imported a model-generated session history summary/u)
  assert.match(imported.text, /Summarized all 2 eligible conversation entries/u)
  assert.equal(subject.summaryRequests.length, 1)
  assert.equal(subject.summaryRequests[0].provider, 'test-provider')
  assert.equal(subject.summaryRequests[0].model, 'test-model')
  const summaryPrompt = subject.summaryRequests[0].messages[0].content[0].text
  assert.match(summaryPrompt, /搜索 Cordis/u)
  assert.match(summaryPrompt, /找到 1 条记录/u)
  assert.doesNotMatch(summaryPrompt, /SHOULD NOT BE REIMPORTED/u)

  appendUser(source, 5, '补充记录 inject 服务依赖规则。')
  const replaced = await runCommand(subject, source, 6, ' import-history Sellora')
  assert.equal(replaced.kind, 'success')
  assert.match(replaced.text, /Replaced 1 earlier generated summary/u)
  const shown = await runCommand(subject, owner, 1, ' show Sellora')
  assert.equal(shown.kind, 'success')
  assert.match(shown.text, /documented the inject rule/u)
  assert.match(shown.text, /\[superseded · artifact · v1\]/u)
  assert.match(shown.text, /Found one Cordis record\./u)
})

test('browser history import uses the selected source title and current Session model route', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const source = agent('source-session')
  await createSpace(subject, owner, 0)
  await addSource(subject, owner, source, 1)
  appendUser(source, 0, 'Import this browser-selected history.')

  const imported = decodeMemoryUiResult((await runUi(subject, source, 1, 'import-history', {
    spaceName: 'Sellora', sourceSessionTitle: 'Browser source title',
  })).text)
  assert.equal(imported.ok, true)
  assert.equal(imported.value.imported.memory.sourceSessionTitle, 'Browser source title')
  assert.equal(subject.summaryRequests.length, 1)
})

test('replaying the same durable command id returns its first result without a second write', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  await createSpace(subject, owner, 0)
  appendUser(owner, 1, 'History to summarize once.')
  const first = await runCommand(subject, owner, 2, ' import-history Sellora')
  const replayed = await runCommand(subject, owner, 2, ' import-history Sellora')

  assert.equal(subject.summaryRequests.length, 1)
  assert.equal(replayed, first)
  const shown = await runCommand(subject, owner, 3, ' show Sellora')
  assert.equal((shown.text.match(/\[active · artifact · v1\]/gu) ?? []).length, 1)
})

test('a consuming Session that is not a source refuses history import', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const reader = agent('reader-session')
  await createSpace(subject, owner, 0)
  appendUser(reader, 0, 'Private history.')

  await addConsumer(subject, owner, reader, 1)
  const rejected = await runCommand(subject, reader, 3, ' import-history Sellora')
  assert.equal(rejected.kind, 'error')
  assert.match(rejected.text, /not a memory source/u)
  const listed = await runCommand(subject, reader, 4, ' list')
  assert.match(listed.text, /Sellora \(uses: automatic/u)
  assert.equal(subject.summaryRequests.length, 0)
})

test('relationship mutations are UI-only and a space name cannot bypass authorization', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const outsider = agent('outsider-session')
  await createSpace(subject, owner, 0)
  const createRejected = await runCommand(subject, outsider, 1, ' create Other')
  assert.equal(createRejected.kind, 'error')
  assert.match(createRejected.text, /available only in the memory-space UI/u)
  const rejected = await runCommand(subject, outsider, 1, ' join read-write Sellora')
  assert.equal(rejected.kind, 'error')
  assert.match(rejected.text, /available only in the memory-space UI/u)
})

test('owner UI operations list, update, and remove sources and consumers independently', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const design = agent('design-session')
  const api = agent('api-session')
  await createSpace(subject, owner, 0)
  await addSource(subject, owner, design, 1)
  await addSource(subject, owner, api, 2)
  await addConsumer(subject, owner, design, 3, 'automatic')
  await addConsumer(subject, owner, api, 4, 'paused')

  const state = decodeMemoryUiResult((await runUi(subject, owner, 5, 'state', {})).text).value
  assert.deepEqual(state.sources.map(view => view.source.sessionId).sort(), ['api-session', 'design-session'])
  assert.deepEqual(state.consumers.map(view => view.consumer.sessionId).sort(), ['api-session', 'design-session', 'owner-session'])
  const changed = decodeMemoryUiResult((await runUi(subject, owner, 6, 'set-consumer-modes', {
    spaceName: 'Sellora', targetSessionIds: ['design-session', 'api-session'], mode: 'confirm',
  })).text).value
  assert.deepEqual(changed.consumers.map(consumer => consumer.mode), ['confirm', 'confirm'])
  const removedSources = decodeMemoryUiResult((await runUi(subject, owner, 7, 'remove-sources', {
    spaceName: 'Sellora', targetSessionIds: ['design-session', 'api-session'], disposition: 'retain',
  })).text).value
  assert.deepEqual(removedSources.removed, { removedSources: 2, changedMemoryVersions: 0 })
  assert.deepEqual(removedSources.state.sources, [])
  assert.deepEqual(removedSources.state.consumers.map(view => view.consumer.sessionId).sort(), ['api-session', 'design-session', 'owner-session'])
  const removedConsumers = decodeMemoryUiResult((await runUi(subject, owner, 8, 'remove-consumers', {
    spaceName: 'Sellora', targetSessionIds: ['design-session', 'api-session'],
  })).text).value
  assert.deepEqual(removedConsumers.removed, { removedConsumers: 2 })
  assert.deepEqual(removedConsumers.state.consumers.map(view => view.consumer.sessionId), ['owner-session'])
})

test('browser governance saves selected text and applies version and lifecycle rules', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const consumer = agent('consumer-session')
  await createSpace(subject, owner, 0, 'Governed')
  appendUser(owner, 1, 'Only this selected message is provenance.')

  const saved = decodeMemoryUiResult((await runUi(subject, owner, 2, 'save-selection', {
    spaceName: 'Governed', sourceSessionTitle: 'Owner title', seqs: [1],
    includeToolResults: false, acknowledgeSensitive: false,
    type: 'constraint', content: 'Business routes stay unchanged.',
  })).text)
  assert.equal(saved.ok, true)
  const firstId = saved.value.remembered.memory.id
  assert.deepEqual(saved.value.remembered.memory.sourceMessages.map(message => message.seq), [1])

  const revised = decodeMemoryUiResult((await runUi(subject, owner, 3, 'update-memory', {
    memoryId: firstId, content: 'Business routes and permissions stay unchanged.',
    type: 'constraint', sourceSessionTitle: 'Owner title revised',
  })).text)
  assert.equal(revised.value.memory.versionNumber, 2)
  const secondId = revised.value.memory.id
  const disputed = decodeMemoryUiResult((await runUi(subject, owner, 4, 'set-memory-status', {
    memoryId: secondId, status: 'disputed',
  })).text)
  assert.equal(disputed.value.memory.status, 'disputed')

  await runUi(subject, owner, 5, 'add-consumer', {
    spaceName: 'Governed', targetSessionId: consumer.id, mode: 'automatic',
  })
  const paused = decodeMemoryUiResult((await runUi(subject, consumer, 0, 'set-own-use-mode', {
    spaceName: 'Governed', mode: 'paused',
  })).text)
  assert.equal(paused.value.spaces[0].consumer.mode, 'paused')
  const removed = decodeMemoryUiResult((await runUi(subject, consumer, 1, 'remove-own-consumer', {
    spaceName: 'Governed',
  })).text)
  assert.deepEqual(removed.value.spaces, [])

  const sourceRemoved = decodeMemoryUiResult((await runUi(subject, owner, 6, 'remove-own-source', {
    spaceName: 'Governed', disposition: 'retain',
  })).text)
  assert.equal(sourceRemoved.value.changed, 0)
  const deleted = decodeMemoryUiResult((await runUi(subject, owner, 7, 'delete-space', {
    spaceName: 'Governed',
  })).text)
  assert.deepEqual(deleted.value.spaces, [])
})

test('selected-memory saving blocks sensitive content until reviewed', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  await createSpace(subject, owner, 0)
  appendUser(owner, 1, 'password=abcdefghijklmnop')
  const blocked = decodeMemoryUiResult((await runUi(subject, owner, 2, 'save-selection', {
    spaceName: 'Sellora', sourceSessionTitle: 'Owner', seqs: [1], includeToolResults: false,
    acknowledgeSensitive: false, type: 'fact', content: 'A password was configured.',
  })).text)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'sensitive-content')
  const state = decodeMemoryUiResult((await runUi(subject, owner, 3, 'state', {})).text)
  assert.deepEqual(state.value.memories, [])
})

test('confirmation-mode preview choices are explicit and consumed by one matching send', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  const manual = agent('manual-session')
  await createSpace(subject, owner, 0)
  assert.equal((await runCommand(subject, owner, 1, ' remember Sellora constraint "Business APIs must not change."')).kind, 'success')
  await addConsumer(subject, owner, manual, 2, 'confirm')

  const initial = await runUi(subject, manual, 3, 'preview', {
    query: 'May the business APIs change?', disabledIds: [], includedIds: [],
  })
  const initialValue = decodeMemoryUiResult(initial.text).value
  assert.equal(initialValue.memories.length, 0)
  assert.equal(initialValue.confirmCandidates.length, 1)

  const selected = await runUi(subject, manual, 4, 'preview', {
    query: 'May the business APIs change?',
    disabledIds: [],
    includedIds: [initialValue.confirmCandidates[0].id],
  })
  assert.equal(decodeMemoryUiResult(selected.text).value.memories.length, 1)
  const direct = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'May the business APIs change?' }] })
  const first = await subject.preStep({ agent: manual, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [direct] }))
  assert.equal(first.messages.length, 2)
  const second = await subject.preStep({ agent: manual, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [direct] }))
  assert.equal(second.messages.length, 1)
})

test('composer preview can suppress an automatic memory and deduplicates explicit inclusion', async (t) => {
  const subject = harness()
  t.after(() => subject.close())
  const owner = agent('owner-session')
  await createSpace(subject, owner, 0)
  await runCommand(subject, owner, 1, ' remember Sellora constraint "Routes remain stable."')
  const preview = decodeMemoryUiResult((await runUi(subject, owner, 2, 'preview', {
    query: 'Can routes change?', disabledIds: [], includedIds: [],
  })).text).value
  assert.equal(preview.memories.length, 1)
  const id = preview.memories[0].id

  await runUi(subject, owner, 3, 'preview', {
    query: 'Can routes change?', disabledIds: [], includedIds: [id],
  })
  const direct = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Can routes change?' }] })
  const deduplicated = await subject.preStep(
    { agent: owner, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [direct] }),
  )
  assert.equal(deduplicated.messages.length, 2)
  const injected = deduplicated.messages[0].content[0].text
  const records = JSON.parse(injected.slice(
    injected.indexOf('<shared-memory-spaces>') + '<shared-memory-spaces>\n'.length,
    injected.indexOf('\n</shared-memory-spaces>'),
  ))
  assert.deepEqual(records.map(record => record.memoryId), [id])
  subject.emitSessionEvent(owner.session, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'stop' } } })

  await runUi(subject, owner, 5, 'preview', {
    query: 'Can routes change?', disabledIds: [id], includedIds: [],
  })
  const suppressed = await subject.preStep(
    { agent: owner, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [direct] }),
  )
  assert.equal(suppressed.messages.length, 1)
})
