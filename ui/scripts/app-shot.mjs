// បើកបរ **app desktop ពិត** (មិនមែន browser) រួចរាយអ្វីដែលឃើញ.
//   1) បើក app ជាមួយ:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   2) node scripts/app-shot.mjs <folder>
//
// ហេតុអ្វីត្រូវមានវា បន្ថែមលើ shot.mjs: ក្នុង browser ទំព័រមកពី Vite (port 5173)
// ហើយ `/api/*` ឆ្លងកាត់ proxy. ក្នុង app វាមកពី `tauri.localhost` ហើយហៅ
// 127.0.0.1:8765 ត្រង់ — ផ្លូវផ្សេង, CORS ផ្សេង. WebView2 គាំទ្រ CDP ដូច្នេះ
// Playwright ភ្ជាប់ទៅ window ពិតបាន.
import { chromium } from 'playwright'

const outDir = process.argv[2]
// គ្មាន folder = screenshot ទៅ folder ឈ្មោះ "undefined" (ធ្លាប់កើតពិត: ui/undefined/)
if (!outDir || outDir.startsWith('--')) throw new Error('usage: node scripts/app-shot.mjs <screenshot folder> [--export-to <dir>]')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages()[0]

const problems = []
const calls = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text())
})
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText ?? ''
  if (why.includes('ABORTED')) return
  problems.push(`request failed (${why}): ${r.url()}`)
})
page.on('response', (r) => {
  const url = r.url()
  if (url.includes('8765')) calls.push(`${r.status()} ${url.replace('http://127.0.0.1:8765', '')}`)
  if (r.status() >= 400) problems.push(`http ${r.status()} ${url}`)
})

// window ពិតរក្សា state ពីការរត់មុន (មិនដូច browser ថ្មី) — dialog ដែលនៅបើក
// បាំង sidebar, ហើយ app អាចនៅលើ screen ណាក៏បាន. reload ធ្វើឲ្យវាចាប់ផ្តើមពី
// Home ថ្មី (1F) រាល់ដង; Escape ការពារបើ reload មិនទាន់បិទ dialog.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/app-home.png` })

// Script ថតរូបមិនត្រូវចាប់ផ្តើម pipeline ឡើយ. វាធ្លាប់ធ្វើ: ប៊ូតុង Start សរសេរ
// "Start Taylor_Tomlinson.m" ហើយ selector /Taylor_Tomlinson/ ចាប់វាមុនការ៉េ
// project — job ពិតរត់ ហើយសរសេរ clip ឡើងវិញ. ឥឡូវយើងពិនិត្យក្រោយការចុចនីមួយៗ.
const SIDECAR = 'http://127.0.0.1:8765'
const busy = async () => (await (await fetch(`${SIDECAR}/health`)).json()).busy
async function noJobStarted(after) {
  const id = await busy()
  if (!id) return
  // ទើបចាប់ផ្តើម = នៅជំហាន cached, មិនទាន់សរសេរ clip — cancel ឥឡូវមានសុវត្ថិភាព
  await fetch(`${SIDECAR}/jobs/${id}`, { method: 'DELETE' })
  throw new Error(`${after} started job ${id} — cancelled it. Fix the selector.`)
}
if (await busy()) throw new Error('a job is already running; wait for it before shooting')

console.log('origin:', await page.evaluate(() => location.origin))
console.log('in tauri:', await page.evaluate(() => '__TAURI_INTERNALS__' in window))

// --- screen 01: Models (sidebar ថ្មី: Settings) ---
await page.getByRole('button', { name: 'Settings', exact: true }).click()
// Settings.html ឥឡូវជាទំព័រផ្ទាល់ — Models ចាស់នៅពីក្រោយ "Models ដែលមានលើកុំព្យូទ័រនេះ › មើល"
// Settings ជា dialog (ប៊ូតុងស្តាំខាងលើ): tab Processing -> Models ដែលមានលើកុំព្យូទ័រនេះ -> មើល
await page.getByRole('dialog').getByRole('tab', { name: 'Processing' }).click()
await page.getByRole('button', { name: /^(មើល|View) ›$/ }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${outDir}/app-models.png` })
console.log(
  'models:',
  await page.evaluate(() => {
    const lines = document.body.innerText.split(/\r?\n/).filter((l) => l.trim())
    return {
      gpu: lines.find((l) => /VRAM|No NVIDIA/.test(l)) ?? null,
      flags: lines.find((l) => l.includes('--whisper-model')) ?? null,
      badges: lines.filter((l) => /BEST FIT|TOO BIG/.test(l)),
    }
  }),
)

// --- Review (1F ជំហាន ៤): video ពិត, ពិន្ទុ, footer export ---
await page.getByRole('button', { name: 'Projects' }).click()
await page.waitForTimeout(800)
// project ក្នុង "Projects ថ្មីៗ" (Import) បើក Review ផ្ទាល់; "clips" បែងចែកវាពី chip វីដេអូគំរូ
const project = page.getByRole('button', { name: /^Taylor_Tomlinson .*clips$/ })
if (await project.count()) {
  await project.first().click()
  await page.waitForTimeout(500)
  await noJobStarted('clicking the project card')
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.screenshot({ path: `${outDir}/app-review.png` })
  console.log(
    'review:',
    await page.evaluate(() => {
      const v = document.querySelector('video')
      return {
        rows: document.querySelectorAll('section[aria-labelledby="clips-title"] > div:has(input)').length,
        video: `${v.videoWidth}x${v.videoHeight} at ${v.currentTime.toFixed(1)}s`,
        footer: document.querySelector('footer span')?.innerText ?? null,
        folder: document.querySelector('#export-folder')?.value ?? null,
      }
    }),
  )

  // Subtitles.html (1F ជំហាន ៥): cue ពី .vtt, timeline, safe zone — មិនចុច រក្សាទុក (វា render)
  await page.getByRole('button', { name: 'កែ Subtitles របស់ clip នេះ' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-cue]').length > 0)
  await page.screenshot({ path: `${outDir}/app-subtitles.png` })
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
  await page.locator('#clips-title').waitFor()

  // --export-to <dir>: ចម្លង clip ទី១ ពិត រួចចុច "បើក folder" (Explorer ត្រូវបើកពិត)
  const target = process.argv[process.argv.indexOf('--export-to') + 1]
  if (process.argv.includes('--export-to') && target) {
    const boxes = page.locator('section[aria-labelledby="clips-title"] input[type=checkbox]')
    for (let i = 1; i < (await boxes.count()); i++) await boxes.nth(i).uncheck()
    await page.locator('#export-folder').fill(target)
    await page.locator('footer').getByRole('button', { name: /^Export / }).click()
    // ExportDone.html (1F ជំហាន ៦): screen ពេញ; "ចម្លង caption" ត្រូវដាក់អត្ថបទក្នុង clipboard ពិត
    await page.locator('#saved-title').waitFor()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${outDir}/app-export-done.png` })
    await page.getByRole('button', { name: 'ចម្លង caption' }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'បើក Folder' }).click()
    await page.waitForTimeout(1500)
    console.log(
      'after export:',
      JSON.stringify(
        await page.evaluate(() => ({
          heading: document.querySelector('h1')?.innerText ?? null,
          subtitle: document.querySelector('h1 + p')?.innerText ?? null,
          picked: document.querySelector('#saved-title')?.innerText ?? null,
          copyButton: [...document.querySelectorAll('main button')].find((b) => b.innerText.includes('ចម្លង'))?.innerText ?? null,
        })),
      ),
    )
  }
}

await noJobStarted('this run')
console.log('sidecar calls:', calls)
console.log('problems:', problems.length ? problems : 'none')
await browser.close()
