import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveProfileDatabasePath } from '../lib/index.js'

test('profile database paths remain isolated across installed DSH profiles', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-profile-path-'))
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  const firstRoot = join(directory, 'profiles', 'first')
  const secondRoot = join(directory, 'profiles', 'second')
  const installedModule = root => pathToFileURL(join(
    root,
    'node_modules',
    '.pnpm',
    'dsh-memory-spaces@0.1.0',
    'node_modules',
    'dsh-memory-spaces',
    'lib',
    'index.js',
  )).href

  const first = resolveProfileDatabasePath('profile:memory-spaces-v4.sqlite', installedModule(firstRoot))
  const second = resolveProfileDatabasePath('profile:memory-spaces-v4.sqlite', installedModule(secondRoot))

  assert.equal(first, join(firstRoot, 'memory-spaces-v4.sqlite'))
  assert.equal(second, join(secondRoot, 'memory-spaces-v4.sqlite'))
  assert.notEqual(first, second)
})

test('profile storage fails closed outside an installed profile and rejects traversal', () => {
  const sourceModule = pathToFileURL(join(tmpdir(), 'dsh-memory-spaces', 'lib', 'index.js')).href
  assert.throws(
    () => resolveProfileDatabasePath('profile:memory-spaces-v4.sqlite', sourceModule),
    /cannot locate the owning DSH profile/u,
  )
  assert.throws(
    () => resolveProfileDatabasePath('profile:..\\outside.sqlite', sourceModule),
    /plain file name/u,
  )
})
