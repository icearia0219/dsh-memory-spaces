import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

const profileRoot = resolve(process.argv[2] ?? process.env.DSH_HOME ?? '')
const workspaceRoot = resolve(process.argv[3] ?? join(profileRoot, 'synthetic-workspace'))
if (profileRoot === resolve('')) throw new Error('Pass DSH_HOME as the first argument or environment variable.')

const createdAt = '2026-08-25T08:00:00.000Z'
const storage = {
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, workspaceIds: ['synthetic-workspace'], archivedSessionIds: [] },
  tables: {
    workspaces: {
      'synthetic-workspace': {
        path: workspaceRoot,
        title: 'Memory Spaces Verification',
        sessionIds: [],
        createdAt,
        updatedAt: createdAt,
      },
    },
  },
}

await mkdir(workspaceRoot, { recursive: true })
await mkdir(join(profileRoot, 'storages'), { recursive: true })
await writeFile(join(profileRoot, 'storages', 'workspace.json'), `${JSON.stringify(storage, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({ profileRoot, workspaceRoot })}\n`)
