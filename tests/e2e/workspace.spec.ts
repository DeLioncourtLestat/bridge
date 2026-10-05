import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { addProject, git, launch, makeSandbox } from './helpers'

async function forkWithAgentWork(sb: ReturnType<typeof makeSandbox>) {
  const r = await launch(sb)
  await addProject(r.app, r.page, sb.repoA)
  await r.page.click('#newFork')
  await r.page.fill('#fName', 'Work')
  await r.page.click('.modal .btn.pri')
  await r.page.fill('#prompt', 'make changes')
  await r.page.press('#prompt', 'Enter')
  await expect(r.page.locator('.msg:not(.me) .body')).toContainText('Done.')
  return r
}

test('changes and explorer: diffs, open in explorer, edit with highlight and autosave', async () => {
  const sb = makeSandbox()
  const { app, page } = await forkWithAgentWork(sb)
  const wt = path.join(path.dirname(sb.repoA), 'easy-calendar_worktrees', 'work')

  await page.click('[data-v="changes"]')
  await expect(page.locator('[data-v="changes"] .cdot')).toBeVisible()
  await expect(page.locator('[data-change]')).toHaveText(['AGENT_WORK.md+3−0', 'README.md+2−0'])
  await page.click('[data-change="README.md"]')
  await expect(page.locator('.dl.add .tx')).toHaveText(['', 'Edited by the agent.'])
  await page.click('#openInFiles')
  await expect(page.locator('[data-v="files"]')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-file="README.md"]')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-file="README.md"] .st')).toHaveText('M')
  await expect(page.locator('[data-file="AGENT_WORK.md"] .st')).toHaveText('A')
  // folders first in the tree
  await expect(page.locator('.llist .fi').first()).toHaveText('src/')
  await expect(page.locator('.cm-changed-line')).toHaveCount(2)

  // edit app.ts by hand: saved to disk, changed line highlighted, counted in Changes
  await page.click('[data-file="src/app.ts"]')
  await expect(page.locator('.cm-content')).toContainText('export const answer = 42')
  await expect(page.locator('.cm-changed-line')).toHaveCount(0)
  await page.locator('.cm-line').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' // edited')
  await expect(page.locator('.cm-changed-line')).toHaveCount(1)
  await expect.poll(() => fs.readFileSync(path.join(wt, 'src/app.ts'), 'utf8')).toContain('export const answer = 42 // edited')
  await expect(page.locator('.saved')).toHaveText('Saved')
  await page.click('[data-v="changes"]')
  await expect(page.locator('[data-change="src/app.ts"]')).toHaveText('src/app.ts+1−1')
  // main checkout is untouched
  expect(fs.readFileSync(path.join(sb.repoA, 'src/app.ts'), 'utf8')).not.toContain('edited')
  expect(git(sb.repoA, 'status', '--porcelain').trim()).toBe('')
  await app.close()
})

test('git: commit selected files, history, push, pull, commit detail', async () => {
  const sb = makeSandbox()
  const { app, page } = await forkWithAgentWork(sb)
  await page.click('[data-v="git"]')
  await expect(page.locator('#gCommit')).toHaveText('✓ Commit 2')
  await expect(page.locator('[data-commit]')).toHaveCount(1)
  await page.click('#gCommit')
  const modal = page.locator('.modal.xl')
  expect((await modal.boundingBox())!.width).toBeGreaterThan(700)
  await expect(page.locator('#cMsg')).toHaveAttribute('rows', '5')
  await page.uncheck('[data-p="README.md"]')
  await expect(page.locator('#cInfo')).toHaveText('1 of 2 files')
  await page.fill('#cMsg', 'Add agent notes')
  await page.click('.modal .btn.pri')
  await expect(page.locator('.toast')).toContainText('Committed')
  await expect(page.locator('#gCommit')).toHaveText('✓ Commit 1')
  await expect(page.locator('#gPush')).toHaveText('↑ Push 1')
  await expect(page.locator('.fi.cmt').first()).toContainText('Add agent notes')
  await expect(page.locator('.fi.cmt').first().locator('.np')).toBeVisible()
  await expect(page.locator('[data-v="git"] .cdot')).toBeVisible()
  // commit detail with diff
  await page.locator('.fi.cmt').first().click()
  await expect(page.locator('.chead .t')).toHaveText('Add agent notes')
  await expect(page.locator('.chead')).toContainText('not pushed')
  await expect(page.locator('.main .mhead .p')).toHaveText(['AGENT_WORK.md'])
  // pull before push: no upstream yet
  await page.click('#gPull')
  await expect(page.locator('.toast')).toContainText('no upstream')
  await page.click('#gPush')
  await expect(page.locator('.toast')).toContainText('Pushed agent/work to origin')
  await expect(page.locator('#gPush')).toHaveText('↑ Push')
  await expect(page.locator('.fi.cmt .np')).toHaveCount(0)
  const remote = path.join(sb.base, 'remotes', 'easy-calendar.git')
  expect(git(remote, 'log', '--format=%s', '-1', 'agent/work').trim()).toBe('Add agent notes')
  await page.click('#gPull')
  await expect(page.locator('.toast')).toContainText('Already up to date')
  await app.close()
})

test('terminals: real shell in the fork folder, rename, close, persist', async () => {
  const sb = makeSandbox()
  let { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  await page.click('#newFork')
  await page.fill('#fName', 'Term')
  await page.click('.modal .btn.pri')
  await page.click('[data-v="term"]')
  await expect(page.locator('[data-term]')).toHaveText(['zsh 1'])
  const rows = page.locator('.xterm-rows')
  await page.click('.xhost')
  await page.keyboard.type('echo marker-$((40+2)) && pwd\n')
  await expect(rows).toContainText('marker-42')
  await expect(rows).toContainText('easy-calendar_worktrees/term')
  // rename by double-click
  await page.dblclick('[data-term]')
  await page.fill('#renTerm', 'dev-server')
  await page.press('#renTerm', 'Enter')
  await expect(page.locator('[data-term]')).toHaveText(['dev-server'])
  // second terminal, then close it
  await page.click('#addTerm')
  await expect(page.locator('[data-term]')).toHaveText(['dev-server', 'zsh 2'])
  await page.locator('.fi.trm', { has: page.locator('[data-term]', { hasText: 'zsh 2' }) }).locator('[data-kill]').click()
  await expect(page.locator('[data-term]')).toHaveText(['dev-server'])
  await page.waitForTimeout(1500) // output is saved about once a second
  await app.close()

  ;({ app, page } = await launch(sb))
  await page.click('.tab:has-text("Term")')
  await page.click('[data-v="term"]')
  await expect(page.locator('[data-term]')).toHaveText(['dev-server'])
  await expect(page.locator('.xterm-rows')).toContainText('marker-42')
  await app.close()
})
