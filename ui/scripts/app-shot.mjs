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
// បាំង sidebar. Escape បិទវា ហើយគ្មានផលអ្វីបើគ្មាន dialog.
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

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

// --- screen 01: Models ---
await page.getByRole('button', { name: 'Models' }).click()
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

// --- screen 04 -> 05: Review, then the Export dialog ---
await page.getByRole('button', { name: 'Projects' }).click()
await page.waitForTimeout(800)
// `(?!Start )`: ការ៉េ project មិនមែនប៊ូតុង "Start <ឈ្មោះវីដេអូ>"
const project = page.getByRole('button', { name: /^(?!Start ).*Taylor_Tomlinson/ })
if (await project.count()) {
  await project.first().click()
  await page.waitForTimeout(500)
  await noJobStarted('clicking the project card')
  await page.getByRole('button', { name: /Review \d+ clips/ }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /Export clips/ }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${outDir}/app-export.png` })
  console.log(
    'export dialog:',
    await page.evaluate(() => {
      const box = document.querySelector('[role="dialog"]')
      if (!box) return null
      const lines = box.innerText.split(/\r?\n/).filter((l) => l.trim())
      return { title: lines[0], folder: box.querySelector('input')?.value ?? null }
    }),
  )

  // --export-to <dir>: ចម្លងពិត រួចចុច "Open folder" (Explorer ត្រូវបើកពិត)
  const target = process.argv[process.argv.indexOf('--export-to') + 1]
  if (process.argv.includes('--export-to') && target) {
    const rows = page.locator('[role="dialog"] button', { hasText: /^#\d/ })
    for (let i = 1; i < (await rows.count()); i++) await rows.nth(i).click()
    await page.locator('[role="dialog"] input').fill(target)
    await page.getByRole('button', { name: /^Export \d+ clip/ }).click()
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${outDir}/app-export-done.png` })
    await page.getByRole('button', { name: 'Open folder' }).click()
    await page.waitForTimeout(1500)
    console.log(
      'after export:',
      await page.evaluate(() => {
        const box = document.querySelector('[role="dialog"]')
        return box ? box.innerText.split(/\r?\n/).filter((l) => l.trim()) : null
      }),
    )
  }
}

await noJobStarted('this run')
console.log('sidecar calls:', calls)
console.log('problems:', problems.length ? problems : 'none')
await browser.close()
