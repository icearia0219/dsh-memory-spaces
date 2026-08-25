import { MemoryStore } from '../../lib/index.js'

const databasePath = process.argv[2]
if (databasePath === undefined) throw new Error('database path is required')

const store = new MemoryStore({
  databasePath,
  journalMode: 'wal',
  busyTimeoutMs: 5_000,
  maxMemoryBytes: 8_192,
})
store.close()
