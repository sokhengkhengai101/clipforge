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

// ---------- Inserts ("+ Extend a clip" -> Add): ផ្នែកដែលចម្លងទៅដាក់កន្លែងផ្សេង ----------
// ដូច `pipeline/cuts.py` `sequence`: វីដេអូដែល Export = parts តាមលំដាប់ចេញ (អាចដដែល មិនតាមពេល).
// ឧ. គ្មានការកាត់, insert {start 40, end 44, at 0} ក្នុងវីដេអូ 55 s -> [40–44 (insert), 0–55].

/** ផ្នែកមួយ (ពេលក្នុងវីដេអូដើម) ដាក់នៅពេល `at` ក្នុងវីដេអូដើម (0 = ដើម ជា hook). */
export type Insert = { start: number; end: number; at: number }
/** part មួយនៃវីដេអូដែល Export: `insert` = index ក្នុងបញ្ជី inserts, null = ផ្នែករក្សាធម្មតា. */
export type Part = { start: number; end: number; insert: number | null }

const MIN_KEEP = 0.1 // ដូច cuts.MIN_KEEP_SEC

/** ផ្នែករក្សា = ផ្ទុយពីការកាត់ (ដូច `keep_ranges`, បំណែក < 0.1 s ដក). */
export function keepRanges(cuts: Cut[], duration: number): Cut[] {
  const out: Cut[] = []
  let at = 0
  for (const [a, b] of cuts) {
    if (a - at >= MIN_KEEP) out.push([round(at), round(a)])
    at = Math.max(at, b)
  }
  if (duration - at >= MIN_KEEP) out.push([round(at), round(duration)])
  return out
}

/** parts តាមលំដាប់ចេញ — ដូច `cuts.sequence`: keep ដែល `at` នៅកណ្តាលត្រូវបំបែក, `at` ក្នុងការកាត់ =
 *  មុន keep បន្ទាប់, ជិតគែមជាង 0.1 s = នៅគែមនោះ, `at` ដូចគ្នា = តាមលំដាប់ក្នុងបញ្ជី. */
export function sequence(cuts: Cut[], inserts: Insert[], duration: number, order: Cut[] = []): Part[] {
  const keeps = rearrange(keepRanges(cuts, duration), order)
  const clean = inserts
    .map((item, index) => ({ start: Math.max(0, item.start), end: Math.min(duration, item.end), at: Math.min(Math.max(0, item.at), duration), index }))
    .filter((item) => item.end - item.start >= MIN_KEEP)
  const pieces: Cut[] = []
  for (const [start, end] of keeps) {
    const inside = [...new Set(clean.map((item) => item.at).filter((at) => at >= start + MIN_KEEP && at <= end - MIN_KEEP))].sort((x, y) => x - y)
    const edges = [start, ...inside, end]
    for (let i = 0; i < edges.length - 1; i++) pieces.push([edges[i], edges[i + 1]])
  }
  // insert នៅជាប់ piece ដើមរបស់វា: រកតាមលំដាប់ពេល ទោះ piece នោះត្រូវបានអូសទៅកន្លែងផ្សេង
  const before = new Map<number, typeof clean>()
  let waiting = clean
  for (const [start] of [...pieces].sort((x, y) => x[0] - y[0])) {
    const ready = waiting.filter((item) => item.at < start + MIN_KEEP)
    before.set(start, ready)
    waiting = waiting.filter((item) => !ready.includes(item))
  }
  const out: Part[] = []
  for (const [start, end] of pieces) {
    for (const item of before.get(start) ?? []) out.push({ start: item.start, end: item.end, insert: item.index })
    out.push({ start, end, insert: null })
  }
  for (const item of waiting) out.push({ start: item.start, end: item.end, insert: item.index }) // ចុងវីដេអូ
  return out
}

/** ដាក់ផ្នែករក្សាតាមលំដាប់ប្លុកដែលអូសលើ timeline — ដូច `cuts.rearrange`: ផ្នែកដែលកាត់នៅតែបាត់,
 *  ផ្នែកដែល `order` មិននិយាយដល់ទៅនៅចុង, ផ្នែកជាប់គ្នាតាមពេលត្រូវភ្ជាប់វិញ.
 *  ឧ. keeps [[0, 30]], order [[10, 30], [0, 10]] -> [[10, 30], [0, 10]]. */
export function rearrange(keeps: Cut[], order: Cut[]): Cut[] {
  const out: Cut[] = []
  let left = keeps
  for (const [blockStart, blockEnd] of order) {
    const rest: Cut[] = []
    for (const [start, end] of left) {
      const a = Math.max(start, blockStart)
      const b = Math.min(end, blockEnd)
      if (b - a < MIN_KEEP) {
        rest.push([start, end])
        continue
      }
      out.push([round(a), round(b)])
      if (a - start >= MIN_KEEP) rest.push([start, round(a)])
      if (end - b >= MIN_KEEP) rest.push([round(b), end])
    }
    left = rest
  }
  const joined: Cut[] = []
  for (const [start, end] of [...out, ...left]) {
    const last = joined[joined.length - 1]
    if (last && Math.abs(last[1] - start) < 0.001) last[1] = end
    else joined.push([start, end])
  }
  return joined
}

/** ប្លុកលើ timeline: parts បំបែកនៅ split (ផ្នែកបន្ថែមមិនបំបែកទេ — វាផ្លាស់ទីទាំងមូល). */
export function blocksOf(parts: Part[], splits: number[]): Part[] {
  const out: Part[] = []
  for (const part of parts) {
    if (part.insert !== null) {
      out.push(part)
      continue
    }
    const inside = splits.filter((at) => at >= part.start + MIN_KEEP && at <= part.end - MIN_KEEP)
    const edges = [part.start, ...inside, part.end]
    for (let i = 0; i < edges.length - 1; i++) out.push({ start: edges[i], end: edges[i + 1], insert: null })
  }
  return out
}

/** អូសប្លុក `from` ទៅចន្លោះ `gap` (0 = មុនប្លុកទី 0) -> `order` ថ្មី: ប្លុករក្សាតាមលំដាប់ចេញ.
 *  បើវាត្រឡប់មកលំដាប់ពេលវិញ = [] (ដូច `manage.clean_order`: គ្មានអ្វីប្តូរ). */
export function moveBlock(blocks: Part[], from: number, gap: number): Cut[] {
  const moved = [...blocks]
  const [block] = moved.splice(from, 1)
  moved.splice(gap > from ? gap - 1 : gap, 0, block)
  const order = moved.filter((item) => item.insert === null).map((item): Cut => [item.start, item.end])
  return order.every((item, at) => at === 0 || order[at - 1][0] <= item[0]) ? [] : order
}

/** part ដែល**រក្សា** (មិនមែន insert) ដែលមាន `time`; ក្នុងការកាត់ = part រក្សាបន្ទាប់; ក្រោយចុង = -1. */
export function keepPartAt(parts: Part[], time: number): number {
  const inside = parts.findIndex((part) => part.insert === null && time >= part.start && time < part.end)
  if (inside >= 0) return inside
  return parts.findIndex((part) => part.insert === null && part.start > time)
}

/** គែមប្លុកអាចអូសចេញទៅដល់ណា: តែក្នុងការកាត់ដែលជាប់គែមនោះ និងក្នុងប្លុក `order` ដែលមានវា (ផ្នែកដែលស្តារ
 *  ត្រូវនៅក្នុងប្លុកនេះ មិនមែនលេចនៅប្លុកផ្សេង). ឧ. cuts [[0, 0.8]], ប្លុក [0.8, 23], side start -> 0. */
export function blockEdgeLimit(cuts: Cut[], order: Cut[], [a, b]: Cut, side: 'start' | 'end'): number {
  const home = order.find(([start, end]) => start <= a + 0.001 && end >= b - 0.001)
  if (side === 'start') {
    const cut = cuts.find(([, end]) => Math.abs(end - a) < 0.002)
    return Math.max(cut ? cut[0] : a, home ? home[0] : 0)
  }
  const cut = cuts.find(([start]) => Math.abs(start - b) < 0.002)
  return Math.min(cut ? cut[1] : b, home ? home[1] : Infinity)
}

/** អូសគែមប្លុក [a, b] ទៅពេល `t`: ចូល = កាត់ផ្នែកនោះ, ចេញ = ស្តារផ្នែកដែលបានកាត់. */
export function trimBlock(cuts: Cut[], [a, b]: Cut, side: 'start' | 'end', t: number): Cut[] {
  if (side === 'start') return t > a ? add(cuts, [a, t]) : subtract(cuts, [t, a])
  return t < b ? add(cuts, [t, b]) : subtract(cuts, [b, t])
}

/** ពេលក្នុងវីដេអូដើម -> ពេលក្នុងវីដេអូដែល Export. `playing` = part ដែលកំពុងចាក់ (ពេលមួយអាចនៅពីរកន្លែង
 *  បើផ្នែកមួយត្រូវចម្លង); -1 = part ដំបូងដែលមានពេលនោះ. ឧ. parts [30-55, 0-30], time 10 -> 35. */
export function outputTime(parts: Part[], time: number, playing = -1): number {
  const inPart = (part: Part | undefined) => part !== undefined && time >= part.start && time <= part.end
  let index = inPart(parts[playing]) ? playing : parts.findIndex(inPart)
  if (index < 0) {
    // ពេលក្នុងការកាត់ = ដើមផ្នែករក្សាបន្ទាប់ (តាមពេល ព្រោះ parts អាចមិនតាមលំដាប់ពេល); ក្រោយគេ = ចុង
    const next = parts.filter((part) => part.insert === null && part.start > time).sort((x, y) => x.start - y.start)[0]
    if (!next) return outputSeconds(parts)
    index = parts.indexOf(next)
    return outputSeconds(parts.slice(0, index))
  }
  return outputSeconds(parts.slice(0, index)) + time - parts[index].start
}

/** ពេលក្នុងវីដេអូដែល Export -> ពេលក្នុងវីដេអូដើម. ឧ. parts [30-55, 0-30], 35 -> 10. */
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

/** ផ្នែកទាំងអស់ដែលចន្លោះ [a, b] ប៉ះ (ចតុកោណជ្រើសលើ timeline) រួមជាចន្លោះតែមួយ.
 *  ឧ. splits [10, 20, 30], duration 40, a 12, b 25 -> [10, 30] (ផ្នែក 10–20 និង 20–30). */
export function partsSpan(splits: number[], duration: number, a: number, b: number): Cut {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const first = partAt(splits, duration, lo)
  // ចុងចន្លោះនៅលើ split ផ្ទាល់ = មិនរាប់ផ្នែកបន្ទាប់ (មិនទាន់ប៉ះវា)
  const last = partAt(splits, duration, hi > lo ? hi - 1e-6 : hi)
  return [first[0], last[1]]
}

/** split ដែលនៅខាងក្នុងចន្លោះ (មិនមែននៅគែម) — Link ដកវាចេញ ដើម្បីភ្ជាប់ផ្នែកជាមួយគ្នា. */
export function splitsInside(splits: number[], [a, b]: Cut): number[] {
  return splits.filter((at) => at > a + 1e-6 && at < b - 1e-6)
}

/** លំដាប់ពាក្យក្នុង transcript = លំដាប់ប្លុកលើ timeline: index ក្នុង `items` (តាមពេល) តាម parts នៃវីដេអូ Export.
 *  ផ្នែកដែលចម្លង (HOOK) = ពាក្យរបស់វាលេចពីរដង. ពាក្យក្នុងការកាត់ដូច pipeline: **កណ្តាល**វាក្រៅគ្រប់ part.
 *  `showCut` (Filter): ពាក្យដែលកាត់នៅមុនផ្នែករក្សាបន្ទាប់របស់វា; មិនបង្ហាញ = បាត់ ដូច timeline.
 *  ឧ. ពាក្យនៅ 1 s, 5 s, 9 s; parts [4-10, 0-4] -> [1, 2, 0]. */
export function transcriptOrder(items: { start: number; end: number }[], parts: Part[], showCut: boolean): number[] {
  const middles = items.map((item) => (item.start + item.end) / 2)
  const inPart = (middle: number, part: Part) => middle >= part.start && middle < part.end
  const kept = parts.filter((part) => part.insert === null)
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
