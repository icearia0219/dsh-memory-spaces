import assert from 'node:assert/strict'
import test from 'node:test'
import { directUserCommandSeq } from '../src/command-source.ts'

const userEvent = {
  type: 'command/run',
  seq: 4,
  time: 1,
  data: {
    commandId: 'command-4',
    name: 'memory',
    source: { kind: 'user' },
  },
}

function invocation(session) {
  return {
    agent: { id: 'session', session },
    commandId: 'command-4',
    rawInput: ' list',
    attachments: [],
    signal: new AbortController().signal,
  }
}

test('direct user command lookup supports current Session snapshots', () => {
  assert.equal(directUserCommandSeq(invocation({ snapshotEvents: () => [userEvent] })), 4)
})

test('direct user command lookup retains legacy Session event-array support', () => {
  assert.equal(directUserCommandSeq(invocation({ events: [userEvent] })), 4)
})

test('direct user command lookup rejects a non-user current Session event', () => {
  const event = { ...userEvent, data: { ...userEvent.data, source: { kind: 'model' } } }
  assert.equal(directUserCommandSeq(invocation({ snapshotEvents: () => [event] })), undefined)
})
