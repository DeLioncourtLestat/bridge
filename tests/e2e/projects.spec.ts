import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { addProject, launch, makeSandbox, newItem, stubFolder } from './helpers'

test('projects: open, initialise plain folder, switch, remember', async () => {
  const sb = makeSandbox()
  let { app, page } = await launch(sb)
  await expect(page.locator('.empty')).toContainText('Open a project')

  await addProject(app, page, sb.repoA)
  const ec = page.locator('.pj').first()
  await expect(ec).toHaveText('EC')
  await expect(ec).toHaveAttribute('aria-current', 'true')

  // tabs: Tasks and Notes first, no Code tab, + Fork at the end
  await expect(page.locator('.tabs > *')).toHaveText(['Tasks 0', 'Notes 0', 'Instructions 0', '+ Fork'])

  // a plain folder asks to initialise git
  await stubFolder(app, sb.plainDir)
  await page.click('#addProj')
  await expect(page.locator('.modal')).toContainText('Not a git repository')
  await page.click('.modal .btn.danger')
  await expect(page.locator('.pj')).toHaveCount(2)
  expect(fs.existsSync(path.join(sb.plainDir, '.git'))).toBe(true)
  await expect(page.locator('.pj').nth(1)).toHaveText('PF')

  await addProject(app, page, sb.repoB)
  await expect(page.locator('.pj')).toHaveCount(3)
  await expect(page.locator('.pj').nth(2)).toHaveText('SA')
  // adding the same repo again does not duplicate it
  await addProject(app, page, path.join(sb.repoB, 'src'))
  await expect(page.locator('.pj')).toHaveCount(3)

  // each project has its own tasks
  await newItem(page, 'task')
  await page.fill('#tTitle', 'Shop task')
  await page.locator('.pj').first().click()
  await expect(page.locator('.ti')).toHaveCount(0)
  await page.locator('.pj').nth(2).click()
  await expect(page.locator('.ti b')).toHaveText(['Shop task'])

  // layout: list column is 360px wide
  expect((await page.locator('.nlist').boundingBox())!.width).toBeCloseTo(360, 0)

  // reopening the app returns to the same project
  await app.close()
  ;({ app, page } = await launch(sb))
  await expect(page.locator('.pj').nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.ti b')).toHaveText(['Shop task'])
  await app.close()
})

test('project icons: preset glyph, letters and color, uploaded image, reset, persist', async () => {
  const sb = makeSandbox()
  let { app, page } = await launch(sb)
  await addProject(app, page, sb.repoA)
  const pj = page.locator('.pj').first()
  const openPicker = async () => { await pj.click({ button: 'right' }); await page.click('#pmIcon') }

  await openPicker()
  await page.click('.pjopt[data-icon="rocket"]')
  await page.click('#piSave')
  await expect(pj.locator('svg')).toHaveCount(1)

  await openPicker()
  await page.click('.pjopt[data-icon="letters"]')
  await page.fill('#piShort', 'xy')
  await page.click('.pimodal .sw[aria-label="#8b5cf6"]')
  await page.click('#piSave')
  await expect(pj).toHaveText('XY')
  await expect(pj).toHaveCSS('background-color', 'rgb(139, 92, 246)')

  // a 1×1 PNG, square-cropped and stored as a data URL
  const png = path.join(sb.base, 'logo.png')
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  await openPicker()
  await page.setInputFiles('#piFile', png)
  await expect(page.locator('.pimodal .pj.big')).toHaveAttribute('style', /data:image\/png/)
  await page.click('#piSave')
  await expect(pj).toHaveAttribute('style', /data:image\/png/)
  await expect(pj).toHaveText('')

  await app.close()
  ;({ app, page } = await launch(sb))
  await expect(page.locator('.pj').first()).toHaveAttribute('style', /data:image\/png/)
  await page.locator('.pj').first().click({ button: 'right' }); await page.click('#pmIcon')
  await page.click('#piReset'); await page.click('#piSave')
  await expect(page.locator('.pj').first()).toHaveText('EC')
  await app.close()
})
