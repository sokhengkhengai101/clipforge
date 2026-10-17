// ថតរូប UI ដោយ browser ពិត (Playwright) ហើយរាយបញ្ហាដែលឃើញ.
//   node scripts/shot.mjs <folder> [--job]
// --job ចុច Start (រត់ pipeline ពិត). បើគ្មាន វាថតតែ home និង review.
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
const project = await page.getByRole('button', { name: /Taylor_Tomlinson/ })
if (await project.count()) {
  await project.first().click()
  await page.getByRole('button', { name: /Review \d+ clips/ }).click()
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
}

if (withJob) {
  await page.getByRole('button', { name: /Start/ }).click()
  await page.waitForTimeout(9000)
  await page.screenshot({ path: `${outDir}/processing.png` })
}

const icons = await page.evaluate(() =>
  [...document.querySelectorAll('img')].map((i) => ({
    w: Math.round(i.getBoundingClientRect().width),
    ok: i.naturalWidth > 0,
  })),
)
console.log('icons:', icons.length, 'broken:', icons.filter((i) => !i.ok).length)
console.log('problems:', problems.length ? problems : 'none')
await browser.close()
