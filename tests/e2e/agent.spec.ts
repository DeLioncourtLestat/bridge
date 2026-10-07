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
  await expect(page.locator('.msg .trow')).toHaveText(['Read README.md', 'Wrote AGENT_WORK.md', 'Edited README.md'])
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

  // the chat takes the full width: no history column
  await expect(page.locator('.lp')).toHaveCount(0)
  await expect(page.locator('[data-jump]')).toHaveCount(0)

  // a failing turn shows the error and resumes the same session
  await page.fill('#prompt', 'FAIL now')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.msg.err')).toHaveText('Simulated failure')
  expect(sb.readLog()[1]).toMatchObject({ resume: true, session: call.session })

  // a long turn can be stopped
  await page.fill('#prompt', 'SLOW one')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.working')).toBeVisible()
  await expect(page.locator('.tab[aria-selected="true"] .sq.run .spin')).toBeVisible() // spinner on the fork tab
  await expect(page.locator('.pj .st.run .spin')).toBeVisible() // and on the project icon
  await page.click('#stopAgent')
  await expect(page.locator('.working')).toHaveCount(0)
  await expect(page.locator('#sendBtn')).toBeVisible()
  await expect(page.locator('.pj .st')).toHaveCount(0)
  await app.close()
})

test('chat: the agent adds and changes tasks and notes through Bridge tools; no separate assistant', async () => {
  const sb = makeSandbox()
  const { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  await expect(page.locator('#openHelper')).toHaveCount(0)
  await page.click('#newFork')
  await page.click('[data-mode="ghost"]')
  await page.click('#gCreate')
  await page.fill('#prompt', 'BRIDGE: write down that we use SQLite and add a task for import')
  await page.press('#prompt', 'Enter')
  // steps in the chat, and the tool answers the agent got back
  await expect(page.locator('.msg .trow')).toHaveText(['Saved note “Decision”', 'Created task “Add import”', 'Updated task #1', 'Completed task #99999'])
  const reply = page.locator('.msg:not(.me) .body')
  await expect(reply).toContainText('Tools: list_tasks, create_task, update_task, list_notes, create_note, update_note')
  await expect(reply).toContainText('Saved note #1 “Decision”.')
  await expect(reply).toContainText('No task 99999 in this project')
  const call = sb.readLog().find((c) => c.mode === 'agent')
  expect(call).toMatchObject({ allowed: 'mcp__bridge' })
  // the task list and notes update without reloading
  await page.click('[data-tab="tasks"]')
  await expect(page.locator('.ti b')).toHaveText(['Add import'])
  await expect(page.locator('.ti .stat')).toHaveText(['In progress'])
  await expect(page.locator('.ti .prio')).toHaveText(['High'])
  await page.click('[data-tab="notes"]')
  await expect(page.locator('.ni b')).toHaveText(['Decision'])
  await app.close()
})

test('instructions: project tab, switched off or added per fork, sent to the agent', async () => {
  const sb = makeSandbox()
  const { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  await page.click('[data-tab="instructions"]')
  for (const [t, b] of [['Tests', 'Use RSpec, not Minitest.'], ['Language', 'Answer in Russian.']]) {
    const before = await page.locator('[data-instr]').count()
    await page.click('#addInstr')
    await page.locator('[data-instr]').nth(before).waitFor()
    await expect(page.locator('#iTitle')).toHaveValue('')
    await page.fill('#iTitle', t)
    await page.fill('#iBody', b)
    await page.locator('#iBody').blur()
  }
  await expect(page.locator('[data-tab="instructions"] .n')).toHaveText('2')
  await expect(page.locator('[data-instr] b')).toHaveText(['Tests', 'Language'])

  await page.click('#newFork'); await page.fill('#fName', 'Work'); await page.click('.modal .btn.pri')
  await page.click('[data-v="instr"]')
  await expect(page.locator('.sbar .itab')).toHaveCount(6)
  await expect(page.locator('[data-pinstr]')).toHaveText(['Tests', 'Language'])
  // switch Language off here, add a fork-only one
  await page.click('[data-pinstr]:has-text("Language")')
  await expect(page.locator('.ibanner')).toContainText('editing it changes it for every fork')
  await page.locator('.fi.instr', { hasText: 'Language' }).locator('[data-instr-on]').click()
  await expect(page.locator('.fi.instr', { hasText: 'Language' })).toHaveClass(/off/)
  await expect(page.locator('#instrToggle')).toHaveText('Turn on here')
  await page.click('#addForkInstr')
  await page.locator('[data-finstr]').first().waitFor()
  await expect(page.locator('#iTitle')).toHaveValue('')
  await page.fill('#iTitle', 'Scope')
  await page.fill('#iBody', 'Only touch app/models.')
  await page.locator('#iBody').blur()
  await expect(page.locator('[data-finstr]')).toHaveText(['Scope'])

  await page.click('[data-v="chat"]')
  await page.fill('#prompt', 'go')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.msg:not(.me) .body')).toContainText('Done.')
  const hint = sb.readLog().find((c) => c.mode === 'agent').hint as string
  expect(hint).toContain('## Tests\n\nUse RSpec, not Minitest.')
  expect(hint).toContain('## Scope\n\nOnly touch app/models.')
  expect(hint).not.toContain('Russian')
  // the project tab is untouched by the fork's choices
  await page.click('[data-tab="instructions"]')
  await expect(page.locator('[data-instr] b')).toHaveText(['Tests', 'Language'])
  await app.close()
})

test('fork tabs: spinner while working, a check when done and unseen, a notice, cleared on opening', async () => {
  const sb = makeSandbox()
  const { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  await page.click('#newFork'); await page.fill('#fName', 'Slow job'); await page.click('.modal .btn.pri')
  await page.fill('#prompt', 'SLOW work please')
  await page.press('#prompt', 'Enter')
  const tab = page.locator('.tab:has-text("Slow job")')
  await expect(tab.locator('.sq.run .spin')).toBeVisible()
  await page.click('[data-tab="tasks"]') // look away while it works
  await expect(tab.locator('.sq.wait')).toBeVisible({ timeout: 15_000 })
  await expect(tab.locator('.sq.wait')).toHaveAttribute('aria-label', 'Agent finished')
  await expect(page.locator('.pj .st.wait')).toBeVisible()
  await expect.poll(() => sb.notices()).toEqual([expect.objectContaining({ title: 'Fork “Slow job” · easy-calendar', body: 'Done. I wrote AGENT_WORK.md and updated README.md.' })])
  // opening the fork clears it
  await tab.click()
  await expect(tab.locator('.sq.idle')).toBeVisible()
  await expect(page.locator('.pj .st')).toHaveCount(0)
  // notices can be turned off
  await page.click('#openSettings')
  await page.click('[data-tog="notify"]')
  await page.keyboard.press('Escape')
  await page.fill('#prompt', 'again')
  await page.press('#prompt', 'Enter')
  await expect(page.locator('.msg:not(.me) .body')).toHaveCount(2)
  await page.waitForTimeout(300)
  expect(sb.notices()).toHaveLength(1)
  await app.close()
})
