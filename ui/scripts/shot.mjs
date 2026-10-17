// ថតរូប UI ដោយ browser ពិត (Playwright) ហើយរាយបញ្ហាដែលឃើញ.
//   node scripts/shot.mjs <folder> [--job]
// --job ចុច Start (រត់ pipeline ពិត). បើគ្មាន វាថតតែ home, review និង export.
import { chromium } from 'playwright'

const outDir = process.argv[2]
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
// ផ្នែកដែលត្រូវរំកិលមើល (recent projects) — container ខាងក្នុងទេ មិនមែនទំព័រ
await page.evaluate(() => {
  const main = document.querySelector('.overflow-y-auto')
  if (main) main.scrollTop = main.scrollHeight
})
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/home-bottom.png` })

// Review: ជ្រើស project ដែលមាន clip រួច រួចចូលមើល
// `(?!Start )`: ការ៉េ project មិនមែនប៊ូតុង "Start <ឈ្មោះវីដេអូ>"
const project = page.getByRole('button', { name: /^(?!Start ).*Taylor_Tomlinson/ })
if (await project.count()) {
  await project.first().click()
  await page.waitForTimeout(500)
  await noJobStarted('clicking the project card')
  await page.getByRole('button', { name: /Review \d+ clips?/ }).click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${outDir}/review.png` })
  const review = await page.evaluate(() => ({
    clipButtons: document.querySelectorAll('section:first-of-type button').length,
    cues: document.body.innerText.match(/(\d+) CUES/)?.[1] ?? '0',
    video: (() => {
      const v = document.querySelector('video')
      return v ? { src: v.getAttribute('src'), w: v.videoWidth, h: v.videoHeight } : null
    })(),
    thumbs: [...document.querySelectorAll('img[src*="thumb"]')].map((i) => i.naturalWidth > 0),
  }))
  console.log('review:', JSON.stringify(review))

  // Screen 05: បើក dialog Export រួចអានអ្វីដែលវាបង្ហាញពិត
  await page.getByRole('button', { name: /Export clips/ }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${outDir}/export.png` })
  const dialog = await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"]')
    if (!box) return null
    const lines = box.innerText.split(/\r?\n/)
    // label និងតម្លៃអាចមានបន្ទាត់ទទេរវាងគ្នា -> យកបន្ទាត់មិនទទេបន្ទាប់
    const after = (label) => {
      const at = lines.indexOf(label)
      return at < 0 ? null : (lines.slice(at + 1).find((line) => line.trim()) ?? null)
    }
    return {
      title: lines[0],
      clipRows: box.querySelectorAll('button').length,
      ticked: [...box.querySelectorAll('img')].filter((i) => i.width === 12).length,
      fit: lines.find((line) => line.startsWith('PLATFORM FIT')) ?? null,
      resolution: after('Resolution'),
      quality: after('Quality'),
      folder: box.querySelector('input')?.value ?? null,
      footer: lines.find((line) => /MB$/.test(line)) ?? null,
    }
  })
  console.log('export dialog:', JSON.stringify(dialog))

  // --export-to <dir>: ចម្លងពិតតែ clip ទី១ ចូល folder ដែលប្រាប់ (មិនមែន Videos/).
  const target = process.argv[process.argv.indexOf('--export-to') + 1]
  if (process.argv.includes('--export-to') && target) {
    const rows = page.locator('[role="dialog"] button', { hasText: /^#\d/ })
    for (let i = 1; i < (await rows.count()); i++) await rows.nth(i).click()
    await page.locator('[role="dialog"] input').fill(target)
    await page.getByRole('button', { name: /^Export \d+ clip/ }).click()
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${outDir}/export-done.png` })
    const done = await page.evaluate(() => {
      const box = document.querySelector('[role="dialog"]')
      return box ? box.innerText.split(/\r?\n/).filter((line) => line.trim()) : null
    })
    console.log('export done:', JSON.stringify(done))
  }
}

// Screen 01: ទំព័រ Models ក្នុង sidebar — hardware និង pack ពិត.
// Escape បិទ dialog Export ជាមុន, បើមិនដូច្នោះ scrim បាំង sidebar.
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Models' }).click()
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
