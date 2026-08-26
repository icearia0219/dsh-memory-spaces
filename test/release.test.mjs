import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { verifyReleaseMetadata } from '../scripts/release-metadata.mjs'

test('storefront screenshots remain declared package files', async () => {
  const [packageJson, screenshotsJson] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../screenshots.json', import.meta.url), 'utf8'),
  ])
  const packageMetadata = JSON.parse(packageJson)
  const screenshots = JSON.parse(screenshotsJson)

  assert.ok(packageMetadata.files.includes('screenshots.json'))
  assert.ok(packageMetadata.files.includes('assets'))
  assert.ok(Array.isArray(screenshots))
  assert.ok(screenshots.length >= 1 && screenshots.length <= 8)
  for (const screenshot of screenshots) {
    assert.match(screenshot, /^assets\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/u)
    await access(new URL(`../${screenshot}`, import.meta.url))
  }
})

test('release metadata requires the tag, package version, and changelog section to agree', () => {
  const result = verifyReleaseMetadata({
    tag: 'v1.2.3',
    packageJson: JSON.stringify({ version: '1.2.3' }),
    changelog: '# Changelog\n\n## [1.2.3] - 2026-08-25\n\n- Release note.\n\n## [1.2.2]\n\n- Older.\n',
  })
  assert.deepEqual(result, { version: '1.2.3', notes: '- Release note.' })
})

test('release metadata rejects a mismatched tag', () => {
  assert.throws(
    () => verifyReleaseMetadata({
      tag: 'v1.2.4',
      packageJson: JSON.stringify({ version: '1.2.3' }),
      changelog: '## [1.2.3]\n\n- Release note.\n',
    }),
    /must equal "v1\.2\.3"/u,
  )
})

test('release metadata rejects a missing changelog section', () => {
  assert.throws(
    () => verifyReleaseMetadata({
      tag: 'v1.2.3',
      packageJson: JSON.stringify({ version: '1.2.3' }),
      changelog: '## [1.2.2]\n\n- Older.\n',
    }),
    /must contain a non-empty/u,
  )
})
