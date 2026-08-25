import process from 'node:process'
import { MemoryStore } from '../lib/index.js'

const databasePath = process.argv[2]
if (databasePath === undefined || databasePath.trim().length === 0) {
  process.stderr.write('Usage: pnpm doctor:fts -- <database-path>\n')
  process.exitCode = 2
} else {
  const store = new MemoryStore({
    databasePath,
    journalMode: 'wal',
    busyTimeoutMs: 5_000,
    maxMemoryBytes: 8_192,
  })
  try {
    const integrity = store.checkFtsIntegrity()
    process.stdout.write(`${JSON.stringify({ schemaVersion: 4, fts5: integrity })}\n`)
    if (integrity.missing !== 0 || integrity.unexpected !== 0) process.exitCode = 1
  } finally {
    store.close()
  }
}
