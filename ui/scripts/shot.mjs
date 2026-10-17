import { chromium } from 'playwright'
const [, , outDir] = process.argv
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()) })
page.on('requestfailed', (r) => problems.push('request failed: ' + r.url()))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${outDir}/home.png` })

// ចុច Start រួចថតពេល job កំពុងរត់
await page.getByRole('button', { name: /Start/ }).click()
await page.waitForTimeout(9000)
await page.screenshot({ path: `${outDir}/processing.png` })

// ទំហំធាតុសំខាន់ៗ ដើម្បីប្រៀបនឹង design
const sizes = await page.evaluate(() => {
  const box = (selector) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  return {
    titleBar: box('body > div > div:first-child'),
    sidebar: box('aside'),
    icons: [...document.querySelectorAll('img')].map((i) => ({
      src: i.getAttribute('src').split('/').pop(),
      w: Math.round(i.getBoundingClientRect().width),
      h: Math.round(i.getBoundingClientRect().height),
      ok: i.naturalWidth > 0,
    })),
  }
})
console.log(JSON.stringify(sizes, null, 1))
console.log('problems:', problems.length ? problems : 'none')
await browser.close()
