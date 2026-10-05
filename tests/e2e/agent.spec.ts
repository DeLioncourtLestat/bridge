import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { addProject, launch, makeSandbox, newItem } from './helpers'

test('chat: attach task and note, agent runs in the fork, history, errors, stop', async () => {
  const sb = makeSandbox()
  const { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  await newItem(page, 'task')
  await page.fill('#tTitle', 'Export JSON')
  await page.fill('#tDesc', 'Buttons in the header')
  await page.click('[data-tab="notes"]')
  await newItem(page, 'note')
  await page.fill('#nTitle', 'Decisions')
  await page.fill('#nDesc', 'Use SQLite')
  await page.keyboard.press('Escape')

  // unnamed fork takes its name and branch from the first task
  await page.click('#newFork')
  await page.click('.modal .btn.pri')
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText('Fork 1')
  await expect(page.locator('.empty-chat')).toContainText('New fork')

  await page.click('[data-pick="task"]')
  await page.click('.pop [data-att]')
  await expect(page.locator('#prompt')).toHaveValue('Export JSON. Buttons in the header')
  await page.click('[data-pick="note"]')
  await expect(page.locator('.pop')).toContainText('Use SQLite')
  await page.click('.pop [data-att]')
  await expect(page.locator('.composer .chip')).toHaveText(['Task: Export JSON×', 'Note: Decisions×'])
  await page.press('#prompt', 'Enter')

  await expect(page.locator('.msg.me .chip')).toHaveText(['Task: Export JSON', 'Note: Decisions'])
  await expect(page.locator('.msg .tool span')).toHaveText(['Read README.md', 'Wrote AGENT_WORK.md', 'Edited README.md'])
  await expect(page.locator('.msg:not(.me) .body')).toHaveText('Done. I wrote AGENT_WORK.md and updated README.md.')
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText('Export JSON')
  await expect(page.locator('.branch .b')).toHaveText('agent/export-json')

  const wt = path.join(path.dirname(sb.repoA), 'easy-calendar_worktrees', 'export-json')
  expect(fs.readFileSync(path.join(wt, 'AGENT_WORK.md'), 'utf8')).toContain('Note: Decisions\nUse SQLite')
  const call = sb.readLog()[0]
  expect(call).toMatchObject({ mode: 'agent', config: path.join(sb.home, '.claude-personal'), resume: false })
  expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(wt))
  expect(call.prompt).toContain('Task: Export JSON')

  // the task moved to In progress
  await page.click('[data-tab="tasks"]')
  await expect(page.locator('.ti .stat')).toHaveText(['In progress'])
  await page.locator('.tab:has-text("Export JSON")').click()

  // history in the left panel jumps to a message
  await expect(page.locator('[data-jump]')).toHaveCount(2)
  await expect(page.locator('[data-jump] .hw')).toHaveText(['You', 'Agent'])
  await page.click('[data-jump="0"]')
  await expect(page.locator('#msg-0')).toHaveClass(/flash/)

  // a failing turn shows the error and resumes the same session
  await page.fill('#prompt', 'FAIL now')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.msg.err')).toHaveText('Simulated failure')
  expect(sb.readLog()[1]).toMatchObject({ resume: true, session: call.session })

  // a long turn can be stopped
  await page.fill('#prompt', 'SLOW one')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.working')).toBeVisible()
  await expect(page.locator('.tab[aria-selected="true"] .sq')).toHaveClass(/run/)
  await expect(page.locator('.pj .st.run')).toBeVisible() // project icon shows a running agent
  await page.click('#stopAgent')
  await expect(page.locator('.working')).toHaveCount(0)
  await expect(page.locator('#sendBtn')).toBeVisible()
  await expect(page.locator('.pj .st')).toHaveCount(0)
  await app.close()
})
