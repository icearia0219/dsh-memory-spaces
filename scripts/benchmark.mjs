import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { MemoryStore, renderRecall } from '../lib/index.js'

const memoryCount = positiveIntegerArgument('memories', 10_000)
const spaceCount = positiveIntegerArgument('spaces', 100)
const relationCount = positiveIntegerArgument('relations', 1_000)
const sampleCount = positiveIntegerArgument('samples', 100)
const governanceSampleCount = positiveIntegerArgument('governance-samples', Math.min(sampleCount, 20))
const explicitDatabase = stringArgument('database')
const benchmarkRoot = explicitDatabase === undefined
  ? await mkdtemp(join(tmpdir(), 'dsh-memory-spaces-benchmark-'))
  : undefined
const databasePath = explicitDatabase === undefined
  ? join(benchmarkRoot, 'benchmark.sqlite')
  : resolve(explicitDatabase)
const ownerSessionId = 'benchmark-owner'
const storeOptions = {
  databasePath,
  journalMode: 'wal',
  busyTimeoutMs: 5_000,
  maxMemoryBytes: 8_192,
}

let store
try {
  const startup = measure(() => new MemoryStore(storeOptions))
  store = startup.value
  const spaces = Array.from({ length: spaceCount }, (_, index) => `Benchmark ${String(index).padStart(3, '0')}`)
  const createdSpaces = spaces.map(space => store.createSpace(space, ownerSessionId))
  store.close()
  store = undefined
  const population = measure(() => populateFixture(databasePath, createdSpaces.map(space => space.id), memoryCount, ownerSessionId))
  store = new MemoryStore(storeOptions)

  const relationSessions = Array.from({ length: relationCount }, (_, index) => `benchmark-member-${String(index)}`)
  const relationships = measure(() => {
    for (const sessionId of relationSessions) {
      store.addSource(spaces[0], ownerSessionId, sessionId)
      store.addConsumer(spaces[0], ownerSessionId, sessionId, 'paused')
    }
  })

  const recallDurations = sample(sampleCount, index => {
    const results = store.search(ownerSessionId, `benchmark segment${String(index % 100)}`, 8)
    assert.ok(results.length > 0)
  })
  const recallCandidates = store.search(ownerSessionId, 'benchmark catalog', 8)
  const assemblyDurations = sample(sampleCount, () => {
    assert.ok(renderRecall(recallCandidates, 16_384)?.memories.length)
  })
  const governanceDurations = sample(governanceSampleCount, () => {
    assert.ok(store.governanceState(ownerSessionId, 500).memories.length <= 500)
  })
  const remember = measure(() => store.remember({
    spaceName: spaces[0],
    sourceSessionId: ownerSessionId,
    type: 'fact',
    content: 'benchmark ordinary saved memory at populated scale',
  }))
  const version = measure(() => store.createVersion('benchmark-memory-0', ownerSessionId, {
    content: 'benchmark revised catalog rule',
    type: 'fact',
  }))
  const lifecycle = measure(() => store.setMemoryStatus('benchmark-memory-1', ownerSessionId, 'disputed'))
  const removal = measure(() => store.removeSources(spaces[0], ownerSessionId, relationSessions, 'retain'))
  assert.equal(removal.value.removedSources, relationCount)
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })

  store.close()
  store = undefined
  const restart = measure(() => new MemoryStore(storeOptions))
  store = restart.value
  assert.deepEqual(store.checkFtsIntegrity(), { missing: 0, unexpected: 0 })
  store.close()
  store = undefined

  const sqlite = new DatabaseSync(databasePath, { readOnly: true })
  const integrity = sqlite.prepare('PRAGMA integrity_check').get().integrity_check
  const schemaVersion = sqlite.prepare('PRAGMA user_version').get().user_version
  sqlite.close()
  assert.equal(integrity, 'ok')
  assert.equal(schemaVersion, 4)

  const result = {
    environment: {
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      memoryCount,
      spaceCount,
      relationCount,
      sampleCount,
      governanceSampleCount,
    },
    milliseconds: {
      startup: round(startup.duration),
      bulkFixtureAndFtsMaintenance: round(population.duration),
      relationshipPopulation: round(relationships.duration),
      recall: percentiles(recallDurations),
      contextAssembly: percentiles(assemblyDurations),
      governanceList: percentiles(governanceDurations),
      remember: round(remember.duration),
      createVersion: round(version.duration),
      lifecycleTransition: round(lifecycle.duration),
      batchRemoveSources: round(removal.duration),
      restart: round(restart.duration),
    },
    bytes: {
      databaseFiles: await databaseBytes(databasePath),
      residentSet: process.memoryUsage().rss,
    },
    integrity: { sqlite: integrity, schemaVersion, fts: { missing: 0, unexpected: 0 } },
    databasePath: explicitDatabase === undefined ? 'temporary database removed after benchmark' : databasePath,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  store?.close()
  if (benchmarkRoot !== undefined) await rm(benchmarkRoot, { recursive: true, force: true })
}

function measure(operation) {
  const startedAt = performance.now()
  const value = operation()
  return { value, duration: performance.now() - startedAt }
}

function sample(count, operation) {
  const durations = []
  for (let index = 0; index < count; index += 1) durations.push(measure(() => operation(index)).duration)
  return durations
}

function percentiles(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    p50: round(sorted[Math.max(0, Math.ceil(sorted.length * 0.50) - 1)]),
    p95: round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]),
  }
}

function round(value) {
  return Math.round(value * 100) / 100
}

function positiveIntegerArgument(name, fallback) {
  const raw = stringArgument(name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`--${name} must be a positive safe integer`)
  return parsed
}

function stringArgument(name) {
  const prefix = `--${name}=`
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

async function databaseBytes(path) {
  let total = 0
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      total += (await stat(candidate)).size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return total
}

function populateFixture(path, spaceIds, count, sourceSessionId) {
  const sqlite = new DatabaseSync(path)
  const insert = sqlite.prepare(`
    INSERT INTO memories (
      id, space_id, version_root_id, version_number, previous_version_id,
      superseded_by_id, status, source_session_id, source_session_title,
      source_seq_start, source_seq_end, creation_method, provenance_cleared,
      type, content, content_hash, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, 1, NULL, NULL, 'active', ?, 'Synthetic benchmark fixture',
      NULL, NULL, 'manual', 0, 'fact', ?, ?, ?, ?, NULL)
  `)
  const startedAt = Date.now()
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    for (let index = 0; index < count; index += 1) {
      const id = `benchmark-memory-${String(index)}`
      const content = `benchmark catalog segment${String(index % 100)} item${String(index)} reusable memory`
      const contentHash = createHash('sha256').update(content).digest('hex')
      const timestamp = startedAt + index
      insert.run(id, spaceIds[index % spaceIds.length], id, sourceSessionId, content, contentHash, timestamp, timestamp)
    }
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  } finally {
    sqlite.close()
  }
}
