import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
await copyFile(
  resolve(packageRoot, 'src/client-entry.d.cts'),
  resolve(packageRoot, 'lib/client.d.cts'),
)
