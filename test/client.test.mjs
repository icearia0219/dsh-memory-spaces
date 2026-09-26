import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  memoryCommandInputDefinition,
  memoryCommandText,
} from '../src/client/memory-command-input.ts'
import { ConversationEventRegistryBridge } from '../src/client/conversation-events.ts'
import { MEMORY_SPACES_CLIENT_INJECT } from '../src/client/dependencies.ts'
import { executeCommandCompat } from '../src/client/execute-command.ts'
import { connectSelectedSessions } from '../src/client/session-connection.ts'
import { MemoryShareController } from '../src/client/share-controller.ts'

const event = {
  type: 'command/run',
  seq: 7,
  time: 1_787_536_129_804,
  data: {
    commandId: 'command-memory-1',
    name: 'memory',
    args: ' create Sellora-中文测试',
    source: { kind: 'user' },
  },
}

test('memory command input becomes a replayable visible chat node', () => {
  assert.equal(memoryCommandText(event), '/memory create Sellora-中文测试')
  const match = memoryCommandInputDefinition.match(event)
  assert.deepEqual(match, { id: 'command-memory-1', role: 'start' })
  const state = memoryCommandInputDefinition.start(
    {},
    { event, view: undefined, role: 'start' },
    {},
  )
  const node = memoryCommandInputDefinition.buildViewNode({
    key: 'memory-command-input:command-memory-1',
    id: 'command-memory-1',
    state,
    start: { event, view: undefined, role: 'start', location: { kind: 'unresolved' } },
    matches: [],
  })
  assert.equal(node.kind, 'memory-command-input')
  assert.equal(node.anchorSeq, 6.9)
  assert.equal(node.data.text, '/memory create Sellora-中文测试')
})

test('memory sharing waits for the commands Remote namespace', () => {
  assert.deepEqual(MEMORY_SPACES_CLIENT_INJECT, [
    'slots',
    'locale',
    'remote',
    'remote.commands',
  ])
})

test('conversation event registration prefers uiConversation and falls back to the legacy service', () => {
  const definition = { kind: 'memory-command-input' }
  const calls = []
  const registry = (name) => ({
    register: (value) => {
      assert.equal(value, definition)
      calls.push(`register:${name}`)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        calls.push(`dispose:${name}`)
      }
    },
  })
  const bridge = new ConversationEventRegistryBridge(definition)

  const detachLegacy = bridge.attach('conversationEvents', registry('legacy'))
  const detachModern = bridge.attach('uiConversation', registry('modern'))
  detachModern()
  detachLegacy()

  assert.deepEqual(calls, [
    'register:legacy',
    'dispose:legacy',
    'register:modern',
    'dispose:modern',
    'register:legacy',
    'dispose:legacy',
  ])
})

test('command transport supports attachment-aware DSH and rc.7 without replaying non-arity failures', async () => {
  const attachmentCalls = []
  const attachmentRemote = {
    commands: {
      execute: async (...args) => {
        attachmentCalls.push(args)
        return { ok: true, value: undefined }
      },
    },
  }
  assert.deepEqual(await executeCommandCompat(attachmentRemote, 'session', '/memory list'), {
    ok: true,
    value: undefined,
  })
  assert.deepEqual(attachmentCalls.map(args => args.length), [3])
  assert.deepEqual(attachmentCalls[0][2], [])

  const rcSevenCalls = []
  const rcSevenRemote = {
    commands: {
      execute: async (...args) => {
        rcSevenCalls.push(args)
        if (args.length === 3) {
          throw new Error('client api: commands/execute expected 2 business argument(s) plus an optional AbortSignal, got 3')
        }
        return { ok: true, value: undefined }
      },
    },
  }
  assert.deepEqual(await executeCommandCompat(rcSevenRemote, 'session', '/memory list'), {
    ok: true,
    value: undefined,
  })
  assert.deepEqual(rcSevenCalls.map(args => args.length), [3, 2])

  let attempts = 0
  const failingRemote = {
    commands: {
      execute: async () => {
        attempts += 1
        throw new Error('network unavailable')
      },
    },
  }
  await assert.rejects(
    () => executeCommandCompat(failingRemote, 'session', '/memory list'),
    /network unavailable/u,
  )
  assert.equal(attempts, 1)
})

test('the client uses only published stock DSH slots', async () => {
  const source = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const slots = [...source.matchAll(/name: '([^']+)'/gu)].map(match => match[1])
  assert.deepEqual(slots, [
    'conversation.chat.node',
    'conversation.session.header.actions',
    'conversation.input.dock',
    'sidebar.workspaces.session.leading',
    'sidebar.workspaces.overlay',
    'conversation.chat.commandview',
    'conversation.chat.commandview',
  ])
  assert.doesNotMatch(source, /name: 'sidebar\.workspaces'|conversation\.chat\.(?:user|assistant)-actions/u)
})

test('the client does not depend on DSH primitives removed by current next', async () => {
  const commandInput = await readFile(
    new URL('../src/client/MemoryCommandInputView.tsx', import.meta.url),
    'utf8',
  )
  const shareUi = await readFile(new URL('../src/client/MemoryShareUi.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(commandInput, /\bMessageText\b/u)
  const primitiveImport = shareUi.match(
    /import\s*\{(?<members>[\s\S]*?)\}\s*from '@deepseek-ai\/dsh-client-ui-primitives'/u,
  )
  assert.notEqual(primitiveImport, null)
  assert.doesNotMatch(
    primitiveImport.groups.members,
    /Icon(?:Check|Copy|Link|Share|Warning)Outline(?:14|16)/u,
  )
})

test('sidebar selection seeds a new-space flow with the first selected session as owner', () => {
  const controller = new MemoryShareController()
  const owner = { sessionId: 'session-owner', title: 'Owner' }
  const source = { sessionId: 'session-source', title: 'Source' }
  controller.toggleSession(owner)
  controller.toggleSession(source)
  controller.openNewSpaceFromSelection()
  assert.deepEqual(controller.getSnapshot().dialog, {
    kind: 'connect',
    sessions: [owner, source],
    createNew: true,
  })
  controller.toggleSession(source)
  assert.deepEqual(Object.keys(controller.getSnapshot().sidebarSessions), ['session-owner'])
})

test('governance dialogs own a bounded scrollport and successful private commands leave no transcript row', async () => {
  const ui = await readFile(new URL('../src/client/MemoryShareUi.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/client/MemoryShareUi.module.css', import.meta.url), 'utf8')
  const commandView = await readFile(new URL('../src/client/MemoryShareCommandView.tsx', import.meta.url), 'utf8')
  assert.match(ui, /contentClassName=\{css\.dialogContent/u)
  assert.match(css, /\.dialogContent\{[^}]*overflow-y:auto/u)
  assert.match(commandView, /if \(state === 'success'\) return null/u)
  assert.doesNotMatch(commandView, /记忆空间操作已处理|分享操作已处理/u)
})

test('snapshot UI renders text without raw HTML and removes bearer query data before inspection', async () => {
  const source = await readFile(new URL('../src/client/MemoryShareUi.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML\s*=/u)
  assert.match(source, /<pre>\{snapshot\.content\}<\/pre>/u)
  assert.match(source, /<GovernanceDialog key=\{state\.dialog\.sessions\[0\]\.sessionId\}/u)
  assert.match(source, /className=\{css\.error\} role="alert"/u)
  const removeAt = source.indexOf("url.searchParams.delete('memorySnapshot')")
  const replaceAt = source.indexOf("window.history.replaceState(null, '', url)", removeAt)
  const inspectAt = source.indexOf("executeShare(remote, current, 'inspect'", replaceAt)
  assert.ok(removeAt >= 0 && replaceAt > removeAt && inspectAt > replaceAt)
})

test('selected local sessions become explicit sources without exposing a share URL', async () => {
  const calls = []
  const remote = {
    commands: {
      execute: async (sessionId, line) => {
        calls.push({ sessionId, line })
        if (line.startsWith('/memory-space-ui ')) {
          const operation = line.split(' ')[1]
          const result = Buffer.from(JSON.stringify({ ok: true, operation, value: {} }))
            .toString('base64url')
          return {
            ok: true, value: { result: { kind: 'text', text: `DSH_MEMORY_UI_V1:${result}` } },
          }
        }
        throw new Error(`unexpected command ${line}`)
      },
    },
  }
  const sessions = [
    { sessionId: 'session-owner', title: 'Owner' },
    { sessionId: 'session-design', title: 'Design' },
    { sessionId: 'session-api', title: 'API' },
  ]

  await connectSelectedSessions(remote, {
    sessions,
    spaceName: '共享产品记忆',
    relation: 'source',
    importHistory: true,
  })

  assert.deepEqual(calls.map(call => call.sessionId), [
    'session-owner',
    'session-owner',
    'session-design',
    'session-api',
  ])
  assert.match(calls[0].line, /^\/memory-space-ui add-source /u)
  const payload = JSON.parse(Buffer.from(calls[0].line.split(' ')[2], 'base64url').toString())
  assert.equal(payload.spaceName, '共享产品记忆')
  assert.equal(payload.targetSessionId, 'session-design')
  assert.equal(payload.mode, undefined)
  assert.match(calls[1].line, /^\/memory-space-ui add-source /u)
  assert.deepEqual(calls.slice(2).map(call => call.line.split(' ')[1]), [
    'import-history', 'import-history',
  ])
  assert.equal(calls.some(call => call.line.includes('memory-share')), false)
})

test('selected local sessions can consume a space without becoming sources', async () => {
  const calls = []
  const remote = {
    commands: {
      execute: async (sessionId, line) => {
        calls.push({ sessionId, line })
        const operation = line.split(' ')[1]
        const result = Buffer.from(JSON.stringify({ ok: true, operation, value: {} })).toString('base64url')
        return { ok: true, value: { result: { kind: 'text', text: `DSH_MEMORY_UI_V1:${result}` } } }
      },
    },
  }
  await connectSelectedSessions(remote, {
    sessions: [
      { sessionId: 'session-owner', title: 'Owner' },
      { sessionId: 'session-reader', title: 'Reader' },
    ],
    spaceName: 'Sellora',
    relation: 'consumer',
    mode: 'confirm',
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, 'session-owner')
  assert.match(calls[0].line, /^\/memory-space-ui add-consumer /u)
  const payload = JSON.parse(Buffer.from(calls[0].line.split(' ')[2], 'base64url').toString())
  assert.deepEqual(payload, { spaceName: 'Sellora', targetSessionId: 'session-reader', mode: 'confirm' })
})
