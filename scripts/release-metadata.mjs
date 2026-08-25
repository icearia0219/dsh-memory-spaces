import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/**
 * Validate one release tag and extract its matching changelog section.
 *
 * @param {{ tag: string, packageJson: string, changelog: string }} input release metadata input
 * @returns {{ version: string, notes: string }} verified version and release notes
 */
export function verifyReleaseMetadata(input) {
  const packageMetadata = JSON.parse(input.packageJson)
  const version = packageMetadata.version
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('package.json must contain a non-empty version.')
  }
  const expectedTag = `v${version}`
  if (input.tag !== expectedTag) {
    throw new Error(`Release tag ${JSON.stringify(input.tag)} must equal ${JSON.stringify(expectedTag)}.`)
  }

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const headingPattern = new RegExp(`^## \\[${escapedVersion}\\][^\\n]*$`, 'mu')
  const heading = headingPattern.exec(input.changelog)
  const sectionStart = heading === null ? -1 : heading.index + heading[0].length
  const remaining = sectionStart < 0 ? '' : input.changelog.slice(sectionStart)
  const nextSection = remaining.search(/^## \[/mu)
  const notes = (nextSection < 0 ? remaining : remaining.slice(0, nextSection)).trim()
  if (notes.length === 0) {
    throw new Error(`CHANGELOG.md must contain a non-empty ## [${version}] section.`)
  }
  return { version, notes }
}

async function main() {
  const tag = process.argv[2]
  if (tag === undefined) throw new Error('Usage: node scripts/release-metadata.mjs <tag> [notes-path]')
  const [packageJson, changelog] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8'),
  ])
  const result = verifyReleaseMetadata({ tag, packageJson, changelog })
  const notesPath = process.argv[3]
  if (notesPath !== undefined) await writeFile(notesPath, `${result.notes}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ version: result.version, notesPath: notesPath ?? null })}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
