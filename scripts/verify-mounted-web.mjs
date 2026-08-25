import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:3095/'
const screenshotPath = resolve(process.argv[3] ?? 'mount-artifacts/mounted-web.png')
const verifyCoreFlow = process.argv.includes('--core')
const requireSidebarFlow = process.argv.includes('--sidebar')
const coreSpaceName = `CiSpace-${Date.now().toString(36)}`
let sidebarFlow = false
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
    await page.getByRole('button', { name: /^(新建会话|New session|New conversation)$/u }).last().click()
    const composer = page.locator('textarea').last()
    await composer.waitFor({ state: 'visible', timeout: 30_000 })
    await composer.fill('/memory list')
    await composer.press('Enter')
    await page.getByText('/memory list', { exact: true }).last().waitFor({ timeout: 30_000 })
    await dismissKnownOnboarding(page)

    await page.locator('[data-memory-spaces-open]').click()
    await page.locator('[data-memory-spaces-governance]').waitFor({ state: 'visible' })
    await page.locator('[data-memory-space-name]').fill(coreSpaceName)
    await page.locator('[data-memory-space-create]').click()
    await page.locator('[data-memory-space-status]').getByText(`已创建空间“${coreSpaceName}”`, { exact: true }).waitFor({ timeout: 30_000 })
    await page.getByRole('navigation', { name: '现有记忆空间' }).getByText(coreSpaceName, { exact: true }).waitFor({ timeout: 30_000 })
    assert.equal(await page.getByText('记忆空间操作已处理', { exact: true }).count(), 0, 'successful private governance commands should not clutter the transcript')
    await page.locator('[data-memory-spaces-done]').click()

    await composer.fill(`/memory remember ${coreSpaceName} constraint UI changes must not modify business APIs.`)
    await composer.press('Enter')
    await page.getByText('Saved shared memory.').last().waitFor({ timeout: 30_000 })
    await composer.fill('Can business APIs change?')
    const preview = page.locator('[data-memory-preview-count]').filter({ visible: true }).last()
    await preview.waitFor({ state: 'visible', timeout: 30_000 })
    assert.ok(Number(await preview.getAttribute('data-memory-preview-count')) > 0, 'preview did not recall any memory')
    assert.ok(Number(await preview.getAttribute('data-memory-preview-tokens')) > 0, 'preview did not estimate a positive token count')
    await page.locator('[data-memory-preview-toggle]').click()
    const stagedMemories = page.locator('[data-memory-preview-item]')
    await stagedMemories.first().waitFor({ state: 'visible' })
    const stagedCount = await stagedMemories.count()
    for (let index = 0; index < stagedCount; index += 1) {
      const stagedMemory = stagedMemories.first()
      assert.equal(await stagedMemory.isChecked(), true, 'recalled memory was not enabled by default')
      await stagedMemory.uncheck()
      await page.waitForFunction(expected => document.querySelectorAll('[data-memory-preview-item]').length === expected, stagedCount - index - 1)
    }
    await page.locator('[data-memory-preview-count="0"]').waitFor({ state: 'visible', timeout: 30_000 })

    const sidebarSelectors = page.locator('[data-memory-session-select]')
    const sidebarSelectorCount = await sidebarSelectors.count()
    assert.ok(!requireSidebarFlow || sidebarSelectorCount >= 2, 'sidebar did not expose at least two Session selectors')
    if (sidebarSelectorCount >= 2) {
      await sidebarSelectors.nth(0).click()
      await sidebarSelectors.nth(1).click()
      const selectionTray = page.locator('[data-memory-session-selection]')
      await selectionTray.getByText('已选择 2 个会话', { exact: true }).waitFor({ state: 'visible' })
      await selectionTray.getByRole('button', { name: '新建记忆空间' }).click()
      const connectDialog = page.getByRole('dialog', { name: '把会话连接到记忆空间' })
      await connectDialog.waitFor({ state: 'visible' })
      assert.equal(await connectDialog.getByLabel('新建记忆空间后连接').isChecked(), true, 'sidebar flow did not select new-space mode')
      assert.equal(await connectDialog.getByRole('group', { name: '可连接的本地会话' }).locator('input:checked').count(), 1, 'sidebar flow did not preselect the second Session')
      const scrollport = connectDialog.locator(':scope > div').first()
      const scrollMetrics = await scrollport.evaluate(element => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      }))
      assert.equal(scrollMetrics.overflowY, 'auto', 'connect dialog content is not a vertical scrollport')
      assert.ok(scrollMetrics.scrollHeight > scrollMetrics.clientHeight, 'connect dialog did not exercise its bounded scrollport')
      const acknowledgement = connectDialog.getByText(/我已检查所选会话不含不应共享的 API Key/u)
      await acknowledgement.scrollIntoViewIfNeeded()
      assert.equal(await acknowledgement.isVisible(), true, 'connect dialog could not scroll to its final acknowledgement')
      await connectDialog.getByRole('button', { name: '取消' }).click()
      await selectionTray.getByRole('button', { name: '取消选择' }).click()
      sidebarFlow = true
    }

    await composer.fill('')
    await page.locator('[data-memory-spaces-open]').click()
    const spaceNavigation = page.getByRole('navigation', { name: '现有记忆空间' })
    await spaceNavigation.getByText(coreSpaceName, { exact: true }).click()
    await page.getByRole('button', { name: '删除空间…' }).click()
    const deleteDialog = page.getByRole('dialog', { name: '删除整个记忆空间' })
    await deleteDialog.getByPlaceholder(coreSpaceName).fill(coreSpaceName)
    await deleteDialog.getByRole('button', { name: '永久删除空间' }).click()
    await spaceNavigation.getByText(coreSpaceName, { exact: true }).waitFor({ state: 'detached', timeout: 30_000 })
    await page.locator('[data-memory-spaces-done]').click()
  }
  await page.screenshot({ path: screenshotPath, fullPage: true })
  assert.deepEqual(
    browserErrors.filter(message => /memory-spaces|plugin|uncaught/iu.test(message)),
    [],
    `browser reported plugin errors: ${browserErrors.join('\n')}`,
  )
  process.stdout.write(`${JSON.stringify({ url, clientEntry: entry.id, bundleStatus, bodyReady: true, coreFlow: verifyCoreFlow, sidebarFlow })}\n`)
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
