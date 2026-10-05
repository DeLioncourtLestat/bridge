import { _electron as electron, expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeSandbox, newItem, stubFolder } from '../e2e/helpers'

// The built Bridge.app: native modules (SQLite, terminals) must load from inside the package.
const APP = path.resolve(__dirname, '../../release/mac-arm64/Bridge.app/Contents/MacOS/Bridge')

test('packaged app: database, git fork, agent, terminal', async () => {
  test.skip(!fs.existsSync(APP), 'run npm run dist:mac first')
  const sb = makeSandbox()
  const env = { ...process.env, BRIDGE_USER_DATA: sb.userData, BRIDGE_HOME: sb.home, BRIDGE_CLAUDE_BIN: path.resolve(__dirname, '../fixtures/fake-claude.cjs'), BRIDGE_FAKE_LOG: sb.fakeLog }
  let app = await electron.launch({ executablePath: APP, env })
  let page = await app.firstWindow()
  await stubFolder(app, sb.repoA)
  await page.click('#addProj')
  await newItem(page, 'task')
  await page.fill('#tTitle', 'Packaged task')
  await page.click('#newFork')
  await page.fill('#fName', 'Pkg')
  await page.click('.modal .btn.pri')
  await page.fill('#prompt', 'hello')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.msg:not(.me) .body')).toContainText('Done.')
  await page.click('[data-v="term"]')
  await page.click('.xhost')
  await page.keyboard.type('echo packaged-$((6*7))\n')
  await expect(page.locator('.xterm-rows')).toContainText('packaged-42')
  await page.waitForTimeout(1200)
  await app.close()
  app = await electron.launch({ executablePath: APP, env })
  page = await app.firstWindow()
  await page.click('[data-tab="tasks"]')
  await expect(page.locator('.ti b')).toHaveText(['Packaged task'])
  await expect(page.locator('.tab:has-text("Pkg")')).toBeVisible()
  await app.close()
})
