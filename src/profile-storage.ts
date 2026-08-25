/** Resolve plugin-owned files relative to the DSH profile that installed the package. */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROFILE_PREFIX = 'profile:'

/**
 * Resolve a configured database path without allowing one profile to silently share another profile's data.
 * @param configuredPath - absolute/relative SQLite path, `:memory:`, or `profile:<file-name>`.
 * @param moduleUrl - installed module URL; exposed for deterministic packaging tests.
 * @returns an absolute filesystem path or `:memory:`.
 */
export function resolveProfileDatabasePath(
  configuredPath: string,
  moduleUrl = import.meta.url,
): string {
  const trimmed = configuredPath.trim()
  if (trimmed.length === 0) throw new TypeError('memory-spaces: databasePath must not be empty')
  if (trimmed === ':memory:') return trimmed
  if (!trimmed.startsWith(PROFILE_PREFIX)) return resolve(trimmed)

  const fileName = trimmed.slice(PROFILE_PREFIX.length)
  if (!/^[A-Za-z0-9._-]+$/u.test(fileName) || fileName === '.' || fileName === '..') {
    throw new TypeError('memory-spaces: a profile database path must contain one plain file name')
  }

  let current = dirname(fileURLToPath(moduleUrl))
  let profileRoot: string | undefined
  while (true) {
    if (current.split(/[\\/]/u).at(-1)?.toLocaleLowerCase() === 'node_modules') {
      profileRoot = dirname(current)
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  if (profileRoot === undefined) {
    throw new TypeError(
      'memory-spaces: cannot locate the owning DSH profile; set DSH_MEMORY_SPACES_DATABASE_PATH for a linked source install',
    )
  }
  return join(profileRoot, fileName)
}
