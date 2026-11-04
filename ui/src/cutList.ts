/** Cut list ក្នុង UI (Edit Video ជំហាន ២) — ដូច `pipeline/cuts.py` ដែរ: បញ្ជីចន្លោះ [start, end]
 *  ដែលត្រូវលុប, តម្រៀប និងមិនជាន់គ្នា. Function ទាំងនេះ "pure" (មិនប្តូរ input) — undo/redo
 *  គ្រាន់តែរក្សាបញ្ជីចាស់ៗ.
 *
 *  ឧ. add([[2, 4]], [3, 6]) = [[2, 6]];  subtract([[2, 6]], [3, 4]) = [[2, 3], [4, 6]]. */
export type Cut = [number, number]

const MIN_CUT = 0.05 // ដូច pipeline: ចន្លោះខ្លីជាងនេះ មិនមែនការកាត់ទេ

/** តម្រៀប, បញ្ចូលចន្លោះជាន់គ្នា ឬជាប់គ្នា, ដកចន្លោះតូចពេក. */
export function normalize(cuts: Cut[]): Cut[] {
  const sorted = cuts
    .map(([a, b]): Cut => [Math.min(a, b), Math.max(a, b)])
    .filter(([a, b]) => b - a >= MIN_CUT)
    .sort((x, y) => x[0] - y[0])
  const out: Cut[] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 0.01) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out.map(([a, b]) => [round(a), round(b)])
}

/** ការកាត់ដែលគ្រប `time`, ឬ null. */
export function cutAt(cuts: Cut[], time: number): Cut | null {
  return cuts.find(([a, b]) => time >= a && time < b) ?? null
}

/** ធាតុមួយ (ពាក្យ ឬ pause) ត្រូវកាត់ឬទេ — ដូច pipeline: **កណ្តាល**របស់វានៅក្នុងការកាត់. */
export function isCut(cuts: Cut[], start: number, end: number): boolean {
  return cutAt(cuts, (start + end) / 2) !== null
}

/** វិនាទីដែលត្រូវលុបសរុប (ក្នុង 0..duration). */
export function removedSeconds(cuts: Cut[], duration: number): number {
  return cuts.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, duration) - Math.max(a, 0)), 0)
}


/** រំកិលពេលចេញពីកណ្តាលពាក្យ: បើ `time` នៅក្នុងពាក្យ -> ព្រំពាក្យដែលជិតជាង, នៅក្នុង pause -> ដដែល.
 *  ដូច្នេះ split / trim មិនកាត់ពាក្យពាក់កណ្តាល ('farm' ក្លាយជា 'fa-'). ឧ. ពាក្យ 8.50-8.80, time 8.70 -> 8.80. */
export function snapToWords(time: number, words: { start: number; end: number }[]): number {
  const inside = words.find((word) => time > word.start && time < word.end)
  if (!inside) return time
  return time - inside.start < inside.end - time ? inside.start : inside.end
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}


/** part មួយនៃវីដេអូដែល Export: `insert` = index ក្នុងបញ្ជី inserts, null = ផ្នែករក្សាធម្មតា. */
export type Part = { start: number; end: number; insert: number | null }


/** part ដែល**រក្សា** (មិនមែន insert) ដែលមាន `time`; ក្នុងការកាត់ = part រក្សាបន្ទាប់; ក្រោយចុង = -1. */
export function keepPartAt(parts: Part[], time: number): number {
  const inside = parts.findIndex((part) => time >= part.start && time < part.end)
  if (inside >= 0) return inside
  const next = parts.filter((part) => part.start > time).sort((x, y) => x.start - y.start)[0]
  return next ? parts.indexOf(next) : -1
}

/** ពេលក្នុងវីដេអូដើម -> ពេលក្នុងវីដេអូដែល Export. `playing` = part ដែលកំពុងចាក់ (ពេលមួយអាចនៅពីរកន្លែង
 *  បើផ្នែកមួយត្រូវចម្លង); -1 = part ដំបូងដែលមានពេលនោះ. ឧ. parts [30-55, 0-30], time 10 -> 35. */
export function outputTime(parts: Part[], time: number, playing = -1): number {
  const inPart = (part: Part | undefined) => part !== undefined && time >= part.start && time <= part.end
  let index = inPart(parts[playing]) ? playing : parts.findIndex(inPart)
  if (index < 0) {
    // ពេលក្នុងការកាត់ = ដើមផ្នែករក្សាបន្ទាប់ (តាមពេល ព្រោះ parts អាចមិនតាមលំដាប់ពេល); ក្រោយគេ = ចុង
    const next = parts.filter((part) => part.start > time).sort((x, y) => x.start - y.start)[0]
    if (!next) return outputSeconds(parts)
    index = parts.indexOf(next)
    return outputSeconds(parts.slice(0, index))
  }
  return outputSeconds(parts.slice(0, index)) + time - parts[index].start
}

/** ពេលក្នុងវីដេអូដែល Export -> ពេលក្នុងវីដេអូដើម. ឧ. parts [30-55, 0-30], 35 -> 10. */
/** ពេលក្នុងវីដេអូ Export -> ពេលក្នុងវីដេអូដើម និង clip ណា (ពេលដើមមួយអាចនៅពីរកន្លែង ដូច្នេះត្រូវចាំ clip).
 *  ហួសចុង = ចុង clip ចុងក្រោយ. */
export function partAtOutput(parts: Part[], seconds: number): { time: number; index: number } {
  let left = Math.max(0, seconds)
  for (let index = 0; index < parts.length; index++) {
    const length = parts[index].end - parts[index].start
    if (left < length) return { time: parts[index].start + left, index }
    left -= length
  }
  return parts.length ? { time: parts[parts.length - 1].end, index: parts.length - 1 } : { time: 0, index: -1 }
}

export function sourceAt(parts: Part[], seconds: number): number {
  let left = Math.max(0, seconds)
  for (const part of parts) {
    if (left < part.end - part.start) return part.start + left
    left -= part.end - part.start
  }
  return parts.length ? parts[parts.length - 1].end : 0
}

/** ប្រវែងវីដេអូដែល Export (វិនាទី). */
export function outputSeconds(parts: Part[]): number {
  return parts.reduce((sum, part) => sum + part.end - part.start, 0)
}

/** លំដាប់ពាក្យក្នុង transcript = លំដាប់ប្លុកលើ timeline: index ក្នុង `items` (តាមពេល) តាម parts នៃវីដេអូ Export.
 *  ផ្នែកដែលចម្លង (HOOK) = ពាក្យរបស់វាលេចពីរដង. ពាក្យក្នុងការកាត់ដូច pipeline: **កណ្តាល**វាក្រៅគ្រប់ part.
 *  `showCut` (Filter): ពាក្យដែលកាត់នៅមុនផ្នែករក្សាបន្ទាប់របស់វា; មិនបង្ហាញ = បាត់ ដូច timeline.
 *  ឧ. ពាក្យនៅ 1 s, 5 s, 9 s; parts [4-10, 0-4] -> [1, 2, 0]. */
/** ពាក្យក្នុងផ្នែកដែលចាក់ពីរដង លេចពីរកន្លែងក្នុង `display`: ទីតាំងនៃច្បាប់របស់ part `part`.
 *  ឧ. parts [40-44, 0-60], ពាក្យនៅ 41 s: part 0 = ច្បាប់ទីមួយ, part 1 = ច្បាប់ទីពីរ. -1 = ពាក្យមិនបង្ហាញ. */
export function displayPosition(items: { start: number; end: number }[], display: number[], parts: Part[], index: number, part: number): number {
  if (index < 0) return -1
  const middle = (items[index].start + items[index].end) / 2
  // ច្បាប់ទី N = ចំនួន part មុន `part` ដែលមានពាក្យនេះ
  let skip = parts.slice(0, Math.max(0, part)).filter((other) => middle >= other.start && middle < other.end).length
  let first = -1
  for (let at = 0; at < display.length; at++) {
    if (display[at] !== index) continue
    if (first < 0) first = at
    if (skip-- === 0) return at
  }
  return first
}

/** ផ្ទុយពី `displayPosition`: ធាតុនៅទីតាំងនេះជារបស់ part ណា. -1 = ពាក្យដែលកាត់ (មិនក្នុង part ណា). */
export function partOfPosition(items: { start: number; end: number }[], display: number[], parts: Part[], position: number): number {
  const index = display[position]
  if (index === undefined) return -1
  const middle = (items[index].start + items[index].end) / 2
  let copy = 0
  for (let at = 0; at < position; at++) if (display[at] === index) copy++
  for (let part = 0; part < parts.length; part++) {
    if (middle >= parts[part].start && middle < parts[part].end && copy-- === 0) return part
  }
  return -1
}

export function transcriptOrder(items: { start: number; end: number }[], parts: Part[], showCut: boolean): number[] {
  const middles = items.map((item) => (item.start + item.end) / 2)
  const inPart = (middle: number, part: Part) => middle >= part.start && middle < part.end
  const kept = parts
  const out: number[] = []
  // ពាក្យដែលកាត់: ផ្ញើទៅផ្នែករក្សាដំបូងដែលចាប់ផ្តើមក្រោយវា (តាមពេល); គ្មាន = ចុងគេ
  const orphans = new Map<Part | null, number[]>()
  if (showCut) {
    const sorted = [...kept].sort((x, y) => x.start - y.start)
    middles.forEach((middle, index) => {
      if (kept.some((part) => inPart(middle, part))) return
      const next = sorted.find((part) => part.start > middle) ?? null
      orphans.set(next, [...(orphans.get(next) ?? []), index])
    })
  }
  for (const part of parts) {
    out.push(...(orphans.get(part) ?? []))
    middles.forEach((middle, index) => {
      if (inPart(middle, part)) out.push(index)
    })
  }
  out.push(...(orphans.get(null) ?? []))
  return out
}
