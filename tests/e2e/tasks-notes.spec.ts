import { expect, test } from '@playwright/test'
import { addProject, launch, makeSandbox, newItem } from './helpers'

test('tasks: create, edit, status, priority, filter, sort, delete, persist', async () => {
  const sb = makeSandbox()
  let { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)

  const add = async (title: string, prio: string, status = 'open') => {
    await newItem(page, 'task')
    await page.fill('#tTitle', title)
    await page.click(`[data-seg="prio"] [data-val="${prio}"]`)
    if (status !== 'open') await page.click(`[data-seg="status"] [data-val="${status}"]`)
  }
  await add('Search notes', 'med')
  await add('Export JSON', 'high', 'progress')
  await add('Light theme', 'low')
  await add('Tasks with start/end', 'high', 'done')
  await page.fill('#tDesc', 'Resize by edges')

  // tab count = open tasks
  await expect(page.locator('[data-tab="tasks"] .n')).toHaveText('3')
  // status sort: in progress, open (by priority), done
  await expect(page.locator('.ti b')).toHaveText(['Export JSON', 'Search notes', 'Light theme', 'Tasks with start/end'])
  await expect(page.locator('.ti').last()).toHaveClass(/done/)
  // priority sort keeps done tasks at the bottom
  await page.selectOption('#tSort', 'prio')
  await expect(page.locator('.ti b')).toHaveText(['Export JSON', 'Search notes', 'Light theme', 'Tasks with start/end'])
  await page.click('.ti:has-text("Search notes")')
  await page.click('[data-seg="prio"] [data-val="high"]')
  await expect(page.locator('.ti b')).toHaveText(['Export JSON', 'Search notes', 'Light theme', 'Tasks with start/end'])
  await page.click('.ti:has-text("Light theme")')
  await page.click('[data-seg="prio"] [data-val="high"]')
  await expect(page.locator('.ti b').nth(3)).toHaveText('Tasks with start/end')

  // filters
  await page.click('[data-f="done"]')
  await expect(page.locator('.ti b')).toHaveText(['Tasks with start/end'])
  await page.click('[data-f="active"]')
  await expect(page.locator('.ti')).toHaveCount(3)
  await page.click('[data-f="all"]')

  // Delete sits on the title row; no "Saved automatically"
  const t = (await page.locator('#tTitle').boundingBox())!
  const d = (await page.locator('#tDel').boundingBox())!
  expect(Math.abs(t.y + t.height / 2 - (d.y + d.height / 2))).toBeLessThan(4)
  await expect(page.locator('body')).not.toContainText('Saved automatically')

  // delete asks first
  await page.click('.ti:has-text("Light theme")')
  await page.click('#tDel')
  await expect(page.locator('.modal')).toContainText('Delete task?')
  await page.click('.modal .btn:has-text("Cancel")')
  await expect(page.locator('.ti')).toHaveCount(4)
  await page.click('#tDel')
  await page.click('.modal .btn.danger')
  await expect(page.locator('.ti')).toHaveCount(3)

  // edits survive a restart
  await page.click('.ti:has-text("Tasks with start/end")')
  await page.fill('#tDesc', 'Resize by edges, create by dragging')
  await page.waitForTimeout(500)
  await app.close()
  ;({ app, page } = await launch(sb))
  await page.click('.ti:has-text("Tasks with start/end")')
  await expect(page.locator('#tDesc')).toHaveValue('Resize by edges, create by dragging')
  await expect(page.locator('#tSort')).toHaveValue('prio')
  await app.close()
})

test('notes: markdown view, edit mode, checkboxes, snippet, delete', async () => {
  const sb = makeSandbox()
  let { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  await page.click('[data-tab="notes"]')
  await newItem(page, 'note')
  await page.fill('#nTitle', 'Google OAuth')
  await page.fill('#nDesc', '## Scope\nNeeds the `calendar.readonly` scope and **7 days**.\n\n> Testing mode\n\n- [x] Create client\n- [ ] Switch to production\n\n[Docs](https://developers.google.com/calendar)')
  await page.keyboard.press('Escape')
  const view = page.locator('#nView')
  await expect(view.locator('h3')).toHaveText('Scope')
  await expect(view.locator('code')).toHaveText('calendar.readonly')
  await expect(view.locator('strong')).toHaveText('7 days')
  await expect(view.locator('blockquote')).toHaveText('Testing mode')
  await expect(view.locator('a')).toHaveAttribute('href', 'https://developers.google.com/calendar')
  await expect(page.locator('.ni span').first()).toHaveText('Scope')
  // checkbox toggles without entering edit mode
  await view.locator('.cb[aria-pressed="false"]').click()
  await expect(view.locator('.cb[aria-pressed="true"]')).toHaveCount(2)
  await expect(page.locator('#nDesc')).toHaveCount(0)
  // click text → edit; source shows the change
  await view.locator('p').first().click()
  await expect(page.locator('#nDesc')).toContainText('- [x] Switch to production')
  await page.keyboard.press('Escape')
  await expect(page.locator('#nView')).toBeVisible()
  await expect(page.locator('[data-tab="notes"] .n')).toHaveText('1')

  await newItem(page, 'note')
  await page.fill('#nTitle', 'Throwaway')
  await page.click('#nDel')
  await expect(page.locator('.modal')).toContainText('Delete note?')
  await page.click('.modal .btn.danger')
  await expect(page.locator('.ni')).toHaveCount(1)
  await page.waitForTimeout(500)

  await app.close()
  ;({ app, page } = await launch(sb))
  await page.click('[data-tab="notes"]')
  await expect(page.locator('#nView .cb[aria-pressed="true"]')).toHaveCount(2)
  await app.close()
})
