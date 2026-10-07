import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { addProject, git, launch, makeSandbox } from './helpers'

test('forks: new and existing branches, busy branches, close and reopen', async () => {
  const sb = makeSandbox()
  const { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  const wtRoot = path.join(path.dirname(sb.repoA), 'easy-calendar_worktrees')

  await page.click('#newFork')
  await page.fill('#fName', 'Recurring events')
  await expect(page.locator('#fBranch')).toHaveAttribute('placeholder', 'agent/recurring-events')
  await expect(page.locator('#fFolder')).toHaveText(path.join(wtRoot, 'recurring-events'))
  await expect(page.locator('.modal')).toContainText('Agent: Claude · personal (project account)')
  // invalid / taken names
  await page.fill('#fBranch', 'bad..name')
  await page.click('.modal .btn.pri')
  await expect(page.locator('#fErr')).toContainText('letters, digits')
  await page.fill('#fBranch', 'feature/existing')
  await page.click('.modal .btn.pri')
  await expect(page.locator('#fErr')).toContainText('already exists')
  await page.fill('#fBranch', '')
  await page.click('.modal .btn.pri')
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText('Recurring events')
  expect(fs.existsSync(path.join(wtRoot, 'recurring-events', 'README.md'))).toBe(true)
  expect(git(path.join(wtRoot, 'recurring-events'), 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('agent/recurring-events')

  // branch label: accent colour, one line, ellipsis
  const label = page.locator('.branch .b')
  await expect(label).toHaveText('agent/recurring-events')
  const style = await label.evaluate((el) => { const s = getComputedStyle(el); return [s.color, s.whiteSpace, s.textOverflow] })
  expect(style).toEqual(['rgb(96, 165, 250)', 'nowrap', 'ellipsis'])
  // views sit in the middle of the bottom bar; chat has no side column, the others open one
  await expect(page.locator('.sbar .itab')).toHaveText(['Chat', 'Changes', 'Explorer', 'Terminal', 'Git', 'Instructions'])
  await expect(page.locator('.sbar .kind')).toHaveText('Fork')
  await expect(page.locator('.lp')).toHaveCount(0)
  const bar = (await page.locator('.sbar').boundingBox())!
  const tabs = (await page.locator('.sbar .itabs').boundingBox())!
  expect(Math.abs(tabs.x + tabs.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(2)
  await page.click('[data-v="files"]')
  expect((await page.locator('.lp').boundingBox())!.width).toBeCloseTo(360, 0)
  await page.click('[data-v="chat"]')

  // existing branches: busy ones are disabled with a reason
  await page.click('#newFork')
  await page.click('[data-bmode="existing"]')
  await expect(page.locator('[data-pick="main"]')).toBeDisabled()
  await expect(page.locator('[data-pick="main"]')).toContainText('checked out in the project folder')
  await expect(page.locator('[data-pick="agent/recurring-events"]')).toBeDisabled()
  await expect(page.locator('[data-pick="agent/recurring-events"]')).toContainText('used by “Recurring events”')
  await expect(page.locator('[data-pick="main"] .mono')).toHaveCSS('text-decoration-line', 'line-through')
  await page.click('[data-pick="feature/existing"]')
  await expect(page.locator('#fFolder')).toHaveText(path.join(wtRoot, 'existing'))
  await page.click('.modal .btn.pri')
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText('Fork 2')
  await expect(page.locator('.branch .b')).toHaveText('feature/existing')

  // closing hides the tab; the fork stays and can be reopened
  await page.locator('.tab[aria-selected="true"] .x').click()
  await expect(page.locator('.tab:has-text("Fork 2")')).toHaveCount(0)
  await expect(page.locator('[data-tab="tasks"]')).toHaveAttribute('aria-selected', 'true')
  expect(fs.existsSync(path.join(wtRoot, 'existing'))).toBe(true)
  await page.click('#newFork')
  await page.click('[data-mode="open"]')
  await expect(page.locator('[data-mode="open"]')).toHaveText('Open existing (1)')
  await page.click('[data-reopen]')
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText('Fork 2')
  // File → New Fork… (⌘N) opens the same dialog
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) { if (i.label === 'New Fork or Ghost…') return i; const s = i.submenu && find(i.submenu.items); if (s) return s }
    }
    find(Menu.getApplicationMenu()!.items)!.click()
  })
  await expect(page.locator('.modal h2')).toHaveText('Fork')
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal')).toHaveCount(0)
  await app.close()
})

test('ghosts: several agents in the project folder on the same branch, no worktree', async () => {
  const sb = makeSandbox()
  const { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  const wtRoot = path.join(path.dirname(sb.repoA), 'easy-calendar_worktrees')

  for (const name of ['Header', 'Footer']) {
    await page.click('#newFork')
    await page.click('[data-mode="ghost"]')
    await expect(page.locator('.modal')).toContainText('(main)')
    await page.fill('#gName', name)
    await page.click('#gCreate')
    await expect(page.locator('.tab[aria-selected="true"]')).toContainText(name)
    await expect(page.locator('.tab[aria-selected="true"] .ghi')).toHaveCount(1)
    await expect(page.locator('.branch .b')).toHaveText('main')
    await expect(page.locator('.branch .ghost')).toContainText('Ghost')
    await page.fill('#prompt', `work on the ${name}`)
    await page.press('#prompt', 'Enter')
  }
  expect(fs.existsSync(wtRoot)).toBe(false)
  // both ran in the project folder
  await expect(page.locator('.msg:not(.me) .body')).toContainText('Done.')
  await page.click('.tab:has-text("Header")')
  await expect(page.locator('.msg:not(.me) .body')).toContainText('Done.')
  expect(fs.readFileSync(path.join(sb.repoA, 'AGENT_WORK.md'), 'utf8')).toContain('work on the')
  expect(git(sb.repoA, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
  await app.close()
})
