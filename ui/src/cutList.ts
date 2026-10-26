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

export function add(cuts: Cut[], range: Cut): Cut[] {
  return normalize([...cuts, range])
}

/** ស្តារ `range` វិញ: ដកវាចេញពីការកាត់ (ការកាត់ធំអាចបែកជាពីរ). */
export function subtract(cuts: Cut[], [a, b]: Cut): Cut[] {
  const out: Cut[] = []
  for (const [start, end] of cuts) {
    if (end <= a || start >= b) out.push([start, end])
    else {
      if (start < a) out.push([start, a])
      if (end > b) out.push([b, end])
    }
  }
  return normalize(out)
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

/** ផ្នែក**រក្សា**ទីប៉ុន្មាន — zoom punch-in ឆ្លាស់តាមលេខនេះ (សេស = 110%), ដូច `cut_filter`.
 *  ការកាត់ដែលចាប់ផ្តើមពី ~0 មិនមានផ្នែកមុនវាទេ (pipeline: ផ្នែក < 0.1 s ត្រូវដក). */
export function partIndex(cuts: Cut[], time: number): number {
  const before = cuts.filter(([, b]) => b <= time).length
  return cuts.length && cuts[0][0] < 0.1 ? Math.max(0, before - 1) : before
}

// ---------- Split / Trim លើ timeline ----------
// split = ចំណុចចែក timeline ជា "ផ្នែក" ដើម្បីជ្រើសលុប — វាមិនកាត់អ្វីទេ; ការលុបពិតនៅតែជា cuts.

/** ផ្នែកដែលមាន `time`: ចន្លោះរវាង split ពីរ (ឬដើម / ចុងវីដេអូ).
 *  ឧ. splits [10, 20], duration 55, time 12 -> [10, 20]; time 30 -> [20, 55]. */
export function partAt(splits: number[], duration: number, time: number): Cut {
  let start = 0
  let end = duration
  for (const at of splits) {
    if (at <= time) start = Math.max(start, at)
    else end = Math.min(end, at)
  }
  return [round(start), round(end)]
}

/** បន្ថែម split (តម្រៀប, មិនជិតគ្នាពេក, មិននៅដើម/ចុង). */
export function addSplit(splits: number[], duration: number, at: number): number[] {
  if (at < MIN_CUT || at > duration - MIN_CUT || splits.some((old) => Math.abs(old - at) < MIN_CUT)) return splits
  return [...splits, round(at)].sort((a, b) => a - b)
}

/** ផ្នែកនេះត្រូវលុបទាំងស្រុងរួចហើយឬនៅ (ប៊ូតុងប្តូរពី "លុប" ទៅ "ស្តារ"). */
export function isPartCut(cuts: Cut[], [a, b]: Cut): boolean {
  return cuts.some(([start, end]) => start <= a + 0.001 && end >= b - 0.001)
}

/** រំកិលពេលចេញពីកណ្តាលពាក្យ: បើ `time` នៅក្នុងពាក្យ -> ព្រំពាក្យដែលជិតជាង, នៅក្នុង pause -> ដដែល.
 *  ដូច្នេះ split / trim មិនកាត់ពាក្យពាក់កណ្តាល ('farm' ក្លាយជា 'fa-'). ឧ. ពាក្យ 8.50-8.80, time 8.70 -> 8.80. */
export function snapToWords(time: number, words: { start: number; end: number }[]): number {
  const inside = words.find((word) => time > word.start && time < word.end)
  if (!inside) return time
  return time - inside.start < inside.end - time ? inside.start : inside.end
}

/** Trim handle: ការកាត់ពីដើម [0, t] (side 'start') ឬដល់ចុង [t, duration] (side 'end') ជំនួសការកាត់
 *  ដើម/ចុងចាស់ — អូស handle ត្រឡប់ក្រោយ = ស្តារផ្នែកនោះវិញ. t ≈ 0 / ≈ duration = គ្មាន trim. */
export function trimTo(cuts: Cut[], duration: number, side: 'start' | 'end', t: number): Cut[] {
  const [head, tail] = trimEdges(cuts, duration)
  const rest = side === 'start' ? subtract(cuts, [0, head]) : subtract(cuts, [tail, duration])
  const clamped = Math.max(0, Math.min(duration, t))
  return side === 'start' ? add(rest, [0, clamped]) : add(rest, [clamped, duration])
}

/** ទីតាំង trim handle ទាំងពីរ: ចុងនៃការកាត់ដែលចាប់ពី 0, និងដើមនៃការកាត់ដែលដល់ចុង. */
export function trimEdges(cuts: Cut[], duration: number): [number, number] {
  const first = cuts[0]
  const last = cuts[cuts.length - 1]
  const head = first && first[0] <= 0.001 ? first[1] : 0
  const tail = last && last[1] >= duration - 0.05 ? last[0] : duration
  return [head, tail]
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
