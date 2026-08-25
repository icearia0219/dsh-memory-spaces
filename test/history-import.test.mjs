import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { collectSessionHistory } from '../lib/index.js'

test('history selection excludes recalled context and reasoning while retaining the recent tail', () => {
  const events = [
    {
      seq: 0,
      type: 'user/message',
      data: createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: `Initial goal ${'甲'.repeat(1_000)}` }],
      }),
      surfaceOp: 'append',
    },
    {
      seq: 1,
      type: 'user/message',
      data: createUserMessage({
        source: { kind: 'plugin', plugin: 'memory-spaces', form: 'recall' },
        content: [{ type: 'text', text: 'RECALLED MEMORY MUST NOT LOOP BACK' }],
      }),
      surfaceOp: 'append',
    },
    {
      seq: 2,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          source: { provider: 'test', model: 'test' },
          content: [
            { type: 'reasoning', text: 'PRIVATE REASONING MUST NOT BE IMPORTED' },
            { type: 'text', text: 'Confirmed tail fact: one Cordis record was found.' },
          ],
        }),
      },
      surfaceOp: 'append',
    },
  ]
  const session = { events, surface: { nodes: [0, 1, 2] } }

  const transcript = collectSessionHistory(session, 1_024)

  assert.equal(transcript.sourceSeqStart, 0)
  assert.equal(transcript.sourceSeqEnd, 2)
  assert.equal(transcript.includedEntries, 2)
  assert.equal(transcript.omittedEntries, 0)
  assert.equal(transcript.truncated, true)
  assert.match(transcript.text, /first transcript entry truncated/u)
  assert.match(transcript.text, /Confirmed tail fact/u)
  assert.doesNotMatch(transcript.text, /RECALLED MEMORY/u)
  assert.doesNotMatch(transcript.text, /PRIVATE REASONING/u)
  assert.ok(Buffer.byteLength(transcript.text, 'utf8') <= 1_024)
})
