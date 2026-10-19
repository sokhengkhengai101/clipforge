/** អក្សរខ្មែរដែល screen ច្រើនត្រូវការ (UI ជាភាសាខ្មែរ — HANDOFF). */

const DIGITS = '០១២៣៤៥៦៧៨៩'

/** 15 -> "១៥". design សរសេរលេខជាខ្មែរ ("៥ clips", "៣ ថ្ងៃមុន"). */
export function khmerNumber(value: number | string): string {
  return String(value).replace(/[0-9]/g, (digit) => DIGITS[Number(digit)])
}

/** ពេល (វិនាទី epoch) -> "ថ្ងៃនេះ" / "ម្សិលមិញ" / "៣ ថ្ងៃមុន" (Main.html Projects ថ្មីៗ).
 *  រាប់តាមថ្ងៃប្រតិទិន មិនមែន ២៤ ម៉ោង: ម៉ោង 23:00 ម្សិលមិញ = "ម្សិលមិញ". */
export function relativeDay(epochSeconds: number, now: number = Date.now()): string {
  const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)
  const days = Math.round((midnight(now) - midnight(epochSeconds * 1000)) / 86_400_000)
  if (days <= 0) return 'ថ្ងៃនេះ'
  if (days === 1) return 'ម្សិលមិញ'
  return `${khmerNumber(days)} ថ្ងៃមុន`
}

/** 3872 -> "1:04:32", 75 -> "1:15". ម៉ោងនៅជាលេខឡាតាំង ដូច design ("12:04", "1:04:32"). */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 736.04 -> "12:16.0" — ចំណុចកាត់ក្នុងវីដេអូដើម ត្រូវការភាគដប់នៃវិនាទី (Review.html). */
export function clockTenths(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  return `${clock(Math.floor(tenths / 10))}.${tenths % 10}`
}
