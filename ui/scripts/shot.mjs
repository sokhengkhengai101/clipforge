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
  if (r.status() === 503 && r.url().endsWith('/api/jobs')) return // ការបដិសេធរបស់ script ខ្លួនឯង
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
// គ្មាន --job = គ្មាន job ពិតទេ: Subtitles ចាប់ផ្តើម preview --clean-only ដោយខ្លួនឯង (ដោយចេតនា)
// ហើយ selector ខុសអាចចុច Start (ឧប្បត្តិហេតុ 1F) — ឆ្លើយ POST /jobs ដោយ 503 ជំនួស
let jobsRefused = 0
if (!withJob) {
  await page.route('**/api/jobs', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    jobsRefused += 1
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"shot.mjs: no jobs"}' })
  })
}

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
await page.getByRole('group', { name: 'ប្រភេទឧបករណ៍' }).getByRole('button', { name: 'កែវីដេអូ' }).click()
console.log('edit tab shows:', await page.locator('main .grid > button').count(), 'tools')
await page.getByRole('group', { name: 'ប្រភេទឧបករណ៍' }).getByRole('button', { name: 'ពេញនិយម' }).click()
// ចុចឧបករណ៍ = preset ពិត + dialog "វីដេអូវែង → Clips ខ្លី" (ជំនួសទំព័រ Import) — មិនចាប់ផ្តើម job ទេ.
// Auto Reframe បើក dialog Reframe (ជំហាន ៧) ដូច្នេះប្រើ Long to Short
await page.getByRole('button', { name: /^Long to Short/ }).click()
await page.waitForTimeout(800)
await noJobStarted('clicking a tool card')
const settingsState = () =>
  page.evaluate(() => {
    const dialog = document.querySelector('[data-settings-page]')
    if (!dialog) return { dialog: false }
    const select = (label) =>
      [...dialog.querySelectorAll('label')].find((l) => l.innerText.startsWith(label))?.querySelector('select')
    const start = [...dialog.querySelectorAll('button')].find((b) => b.innerText.includes('ចាប់ផ្ដើមបង្កើត Clips'))
    return {
      dialog: true,
      tool: dialog.querySelector('h1')?.innerText.replace(/\s+/g, ' ') ?? null,
      step: dialog.querySelector('#video-path') ? 1 : 2, // ជំហាន ១ = ប្រអប់ path
      clips: select('ចំនួន clips')?.value ?? null,
      model: select('AI model')?.selectedOptions[0]?.text ?? null,
      disabledOptions: dialog.querySelectorAll('option:disabled, button:disabled').length,
      startEnabled: start ? !start.disabled : null,
    }
  })
await page.screenshot({ path: `${outDir}/settings-step1.png` })
console.log('settings (nothing chosen):', JSON.stringify(await settingsState()))
// វីដេអូគំរូ -> ជំហាន ២, Start អាចចុចបាន (យើងមិនចុចវាទេ)
// វីដេអូគំរូនៅពីក្រោយតំណ "វីដេអូគំរូ" (ជំហាន ១ ដូច OpusClip)
await page.locator('[data-settings-page]').getByRole('button', { name: /^វីដេអូគំរូ/ }).click()
await page.locator('[data-settings-page]').getByRole('button', { name: 'Taylor_Tomlinson.mp4' }).click()
await page.waitForTimeout(1200)
await noJobStarted('choosing a sample')
console.log('settings (sample chosen):', JSON.stringify(await settingsState()))
await page.screenshot({ path: `${outDir}/settings-step2.png` })
await page.keyboard.press('Escape')

// Review: កាត project ក្នុង Projects របស់ខ្ញុំ (វាមាន clip រួច). គ្មាន project ដែលបាន render =
// រំលង Review/Subtitles/Export (output/ ទទេក្រោយអ្នកអភិវឌ្ឍលុប projects 2026-10-22)
await page.locator('nav[aria-label="Main"]').getByRole('button', { name: 'Projects របស់ខ្ញុំ', exact: true }).click()
await page.waitForTimeout(800)
// project ដែលមាន clip ច្រើនជាងគេ (មិនមែនឈ្មោះថេរទេ: Taylor_Tomlinson ធ្លាប់មាន 15 clips ហើយបាត់វិញ)
const projects = await (await fetch(`${SIDECAR}/projects`)).json()
const best = projects.filter((item) => item.clips > 0).sort((a, b) => b.clips - a.clips)[0]
const name = best ? best.title || best.name : null
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const project = name
  ? page.locator('main .grid button', { hasText: new RegExp(`^(?!Start )${escape(name)}`) })
  : page.locator('nothing-to-review')
if (!(await project.count())) console.log('review: skipped -- no project has rendered clips')
else console.log('review project:', name, `(${best.clips} clips)`)
if (await project.count()) {
  await project.first().click()
  await page.waitForTimeout(500)
  await noJobStarted('clicking the project card')
  await page.waitForTimeout(2500)
  await page.getByRole('heading', { name: /^Clips ដើម/ }).waitFor()
  await page.waitForTimeout(1500) // រូបតូច
  await page.screenshot({ path: `${outDir}/review.png` })
  // Review ថ្មី (OpusClip, 2026-10-23): ក្រឡា clip — កាតមួយ = ប៊ូតុង "មើល clip" លើរូប + ប៊ូតុងតូចបី
  const review = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body
    // "មើល clip" មានពីរក្នុងមួយកាត (រូប + ប៊ូតុងតូច) — រាប់តែមួយដែលមានរូប
    const cards = [...main.querySelectorAll('button[title="មើល clip"]')].filter((card) => card.querySelector('img'))
    return {
      heading: [...main.querySelectorAll('h1')].map((h) => h.innerText.replace(/\s+/g, ' ')).find((t) => t.startsWith('Clips')) ?? null,
      layout: document.querySelector('[aria-label="របៀបបង្ហាញ"] [aria-pressed="true"]')?.getAttribute('aria-label') ?? null,
      cards: cards.length,
      thumbs: cards.filter((card) => card.querySelector('img')?.naturalWidth > 0).length,
    }
  })
  console.log('review:', JSON.stringify(review))

  // កាតទី ១ -> dialog: video ពិត, "Clip ១ / N", transcript ជាកថាខណ្ឌ
  await page.locator('main button[title="មើល clip"]').first().click()
  const clipDialog = page.getByRole('dialog')
  await clipDialog.waitFor()
  await clipDialog.locator('video').evaluate(
    (v) => new Promise((done) => (v.readyState >= 1 ? done() : v.addEventListener('loadedmetadata', done, { once: true }))),
  )
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${outDir}/review-dialog.png` })
  console.log(
    'clip dialog:',
    JSON.stringify(
      await clipDialog.evaluate((dialog) => {
        const v = dialog.querySelector('video')
        return {
          title: dialog.getAttribute('aria-label'),
          counter: [...dialog.querySelectorAll('span')].map((e) => e.innerText).find((t) => /^Clip /.test(t)) ?? null,
          video: v ? { w: v.videoWidth, h: v.videoHeight } : null,
          paragraphs: [...dialog.querySelectorAll('button')].filter((b) => /^\[\d+:\d\d/.test(b.innerText)).length,
        }
      }),
    ),
  )
  await page.keyboard.press('Escape')
  await clipDialog.waitFor({ state: 'detached' })

  // Subtitles.html (1F ជំហាន ៥): cue ពី .vtt, timeline, safe zone — មិនចុច រក្សាទុក (វា render)
  await page.locator('main').getByRole('button', { name: 'កែ Subtitles', exact: true }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('[data-cue]').length > 0)
  await page.waitForTimeout(800)
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
        // preview ផ្ទាល់: clean = video គ្មាន caption + overlay ពី /cues; mp4 = caption ដុតរួច
        preview: document.querySelector('section[aria-label="Preview"] video')?.getAttribute('src')?.match(/kind=(\w+)/)?.[1] ?? null,
        overlayLines: document.querySelectorAll('section[aria-label="Preview"] p.absolute').length,
      })),
    ),
  )
  await page.getByRole('button', { name: 'ត្រឡប់ទៅ Clips' }).click()
  await page.getByRole('heading', { name: /^Clips ដើម/ }).waitFor()

  // --export-to <dir>: ចម្លងពិតតែ clip ទី១ ចូល folder ដែលប្រាប់ (មិនមែន Videos/).
  // Export ច្រើន = "ជ្រើស" -> checkbox លើកាត -> footer
  const target = process.argv[process.argv.indexOf('--export-to') + 1]
  if (process.argv.includes('--export-to') && target) {
    await page.getByRole('button', { name: 'ជ្រើស', exact: true }).click()
    const boxes = page.locator('main input[type=checkbox][aria-label^="ជ្រើស clip"]')
    for (let i = 0; i < (await boxes.count()); i++) {
      if (i === 0) await boxes.nth(i).check()
      else await boxes.nth(i).uncheck()
    }
    await page.locator('#export-folder').fill(target)
    await page.locator('footer').getByRole('button', { name: /^Export / }).click()
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
// logo មានតែលើ screen ពេញ (Review...); ទំព័រក្នុង shell មាន Settings ក្នុង sidebar ស្រាប់
const logo = page.getByRole('button', { name: 'Khmer Clip Studio' })
if (await logo.count()) await logo.click()
await page.getByRole('button', { name: 'Settings', exact: true }).click()
// Settings.html ឥឡូវជាទំព័រផ្ទាល់ — Models ចាស់នៅពីក្រោយ "Models ដែលមានលើកុំព្យូទ័រនេះ › មើល"
// Settings ជា dialog (ប៊ូតុងស្តាំខាងលើ): tab Processing -> Models ដែលមានលើកុំព្យូទ័រនេះ -> មើល
await page.getByRole('dialog').getByRole('tab', { name: 'Processing' }).click()
await page.getByRole('button', { name: /^(មើល|View) ›$/ }).click()
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
if (!withJob) console.log('jobs refused (no --job):', jobsRefused)
console.log('problems:', problems.length ? problems : 'none')
await browser.close()
