import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:3095/'
const screenshotPath = resolve(process.argv[3] ?? 'mount-artifacts/mounted-web.png')
const verifyCoreFlow = process.argv.includes('--core')
await mkdir(dirname(screenshotPath), { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
try {
  const browserErrors = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  assert.ok(response?.ok(), `DSH Web returned ${String(response?.status())}`)
  const entry = await page.waitForFunction(() => {
    const boot = window.__DSH_BOOT__
    if (typeof boot !== 'object' || boot === null || !Array.isArray(boot.entries)) return undefined
    return boot.entries.find(value => value?.id === 'dsh-memory-spaces')
  }, undefined, { timeout: 30_000 }).then(handle => handle.jsonValue())
  assert.equal(typeof entry?.url, 'string', 'boot manifest did not advertise dsh-memory-spaces')
  const bundleStatus = await page.evaluate(async path => (await fetch(path)).status, entry.url)
  assert.equal(bundleStatus, 200, 'memory-spaces client bundle was not served')
  await page.waitForFunction(() => !document.body.innerText.includes('Loading plugins'), undefined, { timeout: 30_000 })
  await dismissKnownOnboarding(page)
  if (verifyCoreFlow) {
    const composer = page.locator('textarea').last()
    await composer.waitFor({ state: 'visible', timeout: 30_000 })
    await composer.fill('/memory list')
    await composer.press('Enter')
    await page.getByText('This Session has no memory-space relationship.').waitFor({ timeout: 30_000 })
    await dismissKnownOnboarding(page)

    await page.locator('[data-memory-spaces-open]').click()
    await page.locator('[data-memory-spaces-governance]').waitFor({ state: 'visible' })
    await page.locator('[data-memory-space-name]').fill('CiSpace')
    await page.locator('[data-memory-space-create]').click()
    await page.getByRole('navigation', { name: '现有记忆空间' }).getByText('CiSpace', { exact: true }).waitFor({ timeout: 30_000 })
    await page.locator('[data-memory-spaces-done]').click()

    await composer.fill('/memory remember CiSpace constraint UI changes must not modify business APIs.')
    await composer.press('Enter')
    await page.getByText('Saved shared memory.').waitFor({ timeout: 30_000 })
    await composer.fill('Can business APIs change?')
    const preview = page.locator('[data-memory-preview-count="1"]')
    await preview.waitFor({ state: 'visible', timeout: 30_000 })
    assert.ok(Number(await preview.getAttribute('data-memory-preview-tokens')) > 0, 'preview did not estimate a positive token count')
    await page.locator('[data-memory-preview-toggle]').click()
    const stagedMemory = page.locator('[data-memory-preview-item]')
    await stagedMemory.waitFor({ state: 'visible' })
    assert.equal(await stagedMemory.isChecked(), true, 'recalled memory was not enabled by default')
    await stagedMemory.uncheck()
    await page.locator('[data-memory-preview-count="0"]').waitFor({ state: 'visible', timeout: 30_000 })
  }
  await page.screenshot({ path: screenshotPath, fullPage: true })
  assert.deepEqual(
    browserErrors.filter(message => /memory-spaces|plugin|uncaught/iu.test(message)),
    [],
    `browser reported plugin errors: ${browserErrors.join('\n')}`,
  )
  process.stdout.write(`${JSON.stringify({ url, clientEntry: entry.id, bundleStatus, bodyReady: true, coreFlow: verifyCoreFlow })}\n`)
} catch (error) {
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  throw error
} finally {
  await browser.close()
}

async function dismissKnownOnboarding(page) {
  const buttonName = /^(继续|Continue|稍后配置|Configure later|Set up later)$/iu
  for (let count = 0; count < 4; count += 1) {
    const button = page.getByRole('button', { name: buttonName }).filter({ visible: true }).first()
    if (await button.count() === 0) return
    await button.click()
  }
}
