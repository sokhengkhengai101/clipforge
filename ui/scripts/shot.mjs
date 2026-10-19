// ថតរូប UI ដោយ browser ពិត (Playwright) ហើយរាយបញ្ហាដែលឃើញ.
//   node scripts/shot.mjs <folder> [--job]
// --job ចុច Start (រត់ pipeline ពិត). បើគ្មាន វាថតតែ home, review និង export.
import { chromium } from 'playwright'

const outDir = process.argv[2]
// គ្មាន folder = screenshot ទៅ folder ឈ្មោះ "undefined" (ធ្លាប់កើតពិត: ui/undefined/)
if (!outDir || outDir.startsWith('--')) throw new Error('usage: node scripts/shot.mjs <screenshot folder> [--export-to <dir>]')
const withJob = process.argv.includes('--job')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text())
})
page.on('requestfailed', (r) => {
  // browser បោះបង់ការទាញ video ពេលប្តូរ clip ឬបិទទំព័រ — នោះមិនមែនបញ្ហា
  const why = r.failure()?.errorText ?? ''
  if (why.includes('ABORTED')) return
  problems.push(`request failed (${why}): ${r.url()}`)
})
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`)
})

// ការ៉េ project និងប៊ូតុង "Start <ឈ្មោះវីដេអូ>" អាចមានឈ្មោះដូចគ្នា — ក្នុង app
// ពិត selector ចាស់ចុច Start ហើយ pipeline រត់. ពិនិត្យថាគ្មាន job ចាប់ផ្តើមដោយចៃដន្យ.
const SIDECAR = 'http://127.0.0.1:8765'
const busy = async () => (await (await fetch(`${SIDECAR}/health`)).json()).busy
async function noJobStarted(after) {
  if (withJob) return
  const id = await busy()
  if (!id) return
  await fetch(`${SIDECAR}/jobs/${id}`, { method: 'DELETE' })
  throw new Error(`${after} started job ${id} — cancelled it. Fix the selector.`)
}
if (await busy()) throw new Error('a job is already running; wait for it before shooting')

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.screenshot({ path: `${outDir}/home.png` })

// 1F Home (design/screens/Home.html): ឧបករណ៍ ៨ — ៤ រត់បាន, ៤ មានស្លាក Phase
const home = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('main .grid > button')]
  return {
    tools: cards.length,
    ready: cards.filter((card) => !card.disabled).map((card) => card.innerText.split(/\r?\n/)[0]),
    font: getComputedStyle(document.querySelector('main')).fontFamily.split(',')[0],
  }
})
console.log('home:', JSON.stringify(home))
// Upgrade = stub: dialog ប្រាប់ថាគ្មានគណនី (គ្មាន network)
await page.getByRole('button', { name: 'Upgrade' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/home-preview.png` })
console.log('upgrade opens:', await page.locator('[role="dialog"] h2').innerText())
await page.keyboard.press('Escape')
// tab "កែវីដេអូ" ច្រោះមកសល់ Auto Reframe + លុបភាពស្ងាត់
await page.getByRole('button', { name: 'កែវីដេអូ' }).click()
console.log('edit tab shows:', await page.locator('main .grid > button').count(), 'tools')
await page.getByRole('button', { name: 'ពេញនិយម' }).click()
// ចុចឧបករណ៍ = preset ពិត, ទៅទំព័រ Projects — មិនចាប់ផ្តើម job ទេ
await page.getByRole('button', { name: /^Auto Reframe/ }).click()
await page.waitForTimeout(800)
await noJobStarted('clicking a tool card')
// ទំព័រ Import (Main.html): ឧបករណ៍ពី Home, ចំនួន clips, ជម្រើស Phase 2 បិទ, Start បិទរហូតជ្រើសវីដេអូ
const importState = () =>
  page.evaluate(() => {
    const picked = (label) =>
      [...document.querySelectorAll(`[role="group"][aria-label="${label}"] [aria-pressed="true"]`)].map((b) => b.innerText)
    const start = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('ចាប់ផ្ដើមបង្កើត Clips'))
    return {
      tool: document.body.innerText.match(/ឧបករណ៍ (.+)/)?.[1]?.split(' · ')[0] ?? null,
      clips: picked('ចំនួន Clips'),
      language: picked('ភាសាក្នុងវីដេអូ'),
      disabledOptions: document.querySelectorAll('[role="group"] button:disabled').length,
      startEnabled: start ? !start.disabled : null,
    }
  })
await page.screenshot({ path: `${outDir}/import.png` })
console.log('import (nothing chosen):', JSON.stringify(await importState()))
// វីដេអូគំរូ -> Start អាចចុចបាន (យើងមិនចុចវាទេ)
await page.getByRole('button', { name: 'Taylor_Tomlinson.mp4' }).click()
await page.waitForTimeout(400)
await noJobStarted('choosing a sample')
console.log('import (sample chosen):', JSON.stringify(await importState()))
await page.screenshot({ path: `${outDir}/import-chosen.png` })

// Review: project ក្នុង "Projects ថ្មីៗ" បើក Review ផ្ទាល់ (វាមាន clip រួច).
// ឈ្មោះ + "clips": chip វីដេអូគំរូ "Taylor_Tomlinson.mp4" ក៏មានឈ្មោះដូចគ្នាដែរ
const project = page.getByRole('button', { name: /^Taylor_Tomlinson .*clips$/ })
if (await project.count()) {
  await project.first().click()
  await page.waitForTimeout(500)
  await noJobStarted('clicking the project card')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${outDir}/review.png` })
  // Review.html (1F ជំហាន ៤): បញ្ជី clip, video ពិត, ពិន្ទុ, footer export
  const review = await page.evaluate(() => {
    const rows = document.querySelectorAll('section[aria-labelledby="clips-title"] > div:has(input)')
    const v = document.querySelector('video')
    return {
      heading: document.querySelector('#clips-title')?.innerText ?? null,
      clipRows: rows.length,
      thumbs: [...document.querySelectorAll('section img')].map((i) => i.naturalWidth > 0),
      video: v ? { src: v.getAttribute('src'), w: v.videoWidth, h: v.videoHeight } : null,
      title: document.querySelector('#clip-title')?.value ?? null,
      footer: document.querySelector('footer span')?.innerText ?? null,
      folder: document.querySelector('#export-folder')?.value ?? null,
    }
  })
  console.log('review:', JSON.stringify(review))

  // Subtitles.html (1F ជំហាន ៥): cue ពី .vtt, timeline, safe zone — មិនចុច រក្សាទុក (វា render)
  await page.getByRole('button', { name: 'កែ Subtitles របស់ clip នេះ' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-cue]').length > 0)
  await page.screenshot({ path: `${outDir}/subtitles.png` })
  console.log(
    'subtitles:',
    JSON.stringify(
      await page.evaluate(() => ({
        heading: document.querySelector('#lines-title')?.innerText ?? null,
        cues: document.querySelectorAll('[data-cue]').length,
        blocks: document.querySelectorAll('[role="slider"] > div.absolute.inset-y-2').length,
        safeBands: document.querySelectorAll('.safe-band').length,
        presetsDisabled: document.querySelectorAll('aside button[disabled]').length,
      })),
    ),
  )
  await page.getByRole('button', { name: 'ត្រឡប់ទៅ Clips' }).click()
  await page.locator('#clips-title').waitFor()

  // --export-to <dir>: ចម្លងពិតតែ clip ទី១ ចូល folder ដែលប្រាប់ (មិនមែន Videos/).
  const target = process.argv[process.argv.indexOf('--export-to') + 1]
  if (process.argv.includes('--export-to') && target) {
    const boxes = page.locator('section[aria-labelledby="clips-title"] input[type=checkbox]')
    for (let i = 1; i < (await boxes.count()); i++) await boxes.nth(i).uncheck()
    await page.locator('#export-folder').fill(target)
    await page.getByRole('button', { name: /^Export / }).click()
    // ExportDone.html (1F ជំហាន ៦): screen ពេញ មិនមែន dialog
    await page.locator('#saved-title').waitFor()
    await page.waitForTimeout(800) // ffprobe + transcript សម្រាប់ subtitle និងរបារ
    await page.screenshot({ path: `${outDir}/export-done.png` })
    const done = await page.evaluate(() => ({
      heading: document.querySelector('h1')?.innerText ?? null,
      subtitle: document.querySelector('h1 + p')?.innerText ?? null,
      picked: document.querySelector('#saved-title')?.innerText ?? null,
      cards: document.querySelectorAll('main img').length,
      files: document.querySelectorAll('section[aria-labelledby="files-title"] li').length,
    }))
    console.log('export done:', JSON.stringify(done))
  }
}

// Screen 01: ទំព័រ Models ក្នុង sidebar — hardware និង pack ពិត.
// Escape បិទ dialog ជាមុន (scrim បាំងប៊ូតុង); Review គ្មាន sidebar -> logo -> Home -> Settings.
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Khmer Clip Studio' }).click()
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${outDir}/models.png` })
const models = await page.evaluate(() => {
  const lines = document.body.innerText.split(/\r?\n/).filter((line) => line.trim())
  return {
    chips: lines.filter((line) => /GB|FFmpeg/.test(line)).slice(0, 4),
    packs: [...document.querySelectorAll('button')]
      .map((b) => b.innerText.split(/\r?\n/)[0])
      .filter((name) => ['Lite', 'Standard', 'Pro'].includes(name)),
    badges: lines.filter((line) => /BEST FIT|TOO BIG/.test(line)),
    flags: lines.find((line) => line.includes('--whisper-model')) ?? null,
  }
})
console.log('models page:', JSON.stringify(models))
// ចុច Lite — បន្ទាត់ flag ខាងក្រោមត្រូវប្តូរពិត (pack = flag មិនមែនតែរូប)
await page.getByRole('button', { name: /^Lite/ }).click()
await page.waitForTimeout(400)
console.log(
  'after picking Lite:',
  await page.evaluate(
    () =>
      document.body.innerText
        .split(/\r?\n/)
        .find((line) => line.includes('--whisper-model')) ?? null,
  ),
)
await page.getByRole('button', { name: 'Projects' }).click()
await page.waitForTimeout(500)

if (withJob) {
  await page.getByRole('button', { name: /Start/ }).click()
  await page.waitForTimeout(9000)
  await page.screenshot({ path: `${outDir}/processing.png` })
}

await noJobStarted('this run')

const icons = await page.evaluate(() =>
  [...document.querySelectorAll('img')].map((i) => ({
    w: Math.round(i.getBoundingClientRect().width),
    ok: i.naturalWidth > 0,
  })),
)
console.log('icons:', icons.length, 'broken:', icons.filter((i) => !i.ok).length)
console.log('problems:', problems.length ? problems : 'none')
await browser.close()
