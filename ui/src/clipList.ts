/** បញ្ជី clip របស់ Edit Video: ផ្នែកនៃវីដេអូដើម `[in, out]` តាមលំដាប់ចេញ — ដូច `pipeline/cuts.py` `clip_parts`.
 *  អ្វីដែលមិននៅក្នុងបញ្ជី = កាត់ចេញ, អ្វីដែលនៅពីរដង = ចាក់ពីរដង, Split = clip មួយក្លាយជាពីរ.
 *  Function ទាំងនេះ "pure" (មិនប្តូរ input) — undo / redo គ្រាន់តែរក្សាបញ្ជីចាស់ៗ.
 *
 *  ឧ. វីដេអូ 60 s, បញ្ជី [[10, 20], [0, 5]]: ចាក់ 10-20 រួច 0-5; 5-10 និង 20-60 ត្រូវកាត់. */
import type { Cut, Part } from './cutList'

export type Clip = Cut

const MIN_CLIP = 0.1 // ដូច cuts.MIN_KEEP_SEC: ខ្លីជាងនេះ pipeline មិនយក
const SAME = 0.002 // គែមពីរជិតគ្នាជាងនេះ = គែមតែមួយ

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** [] ក្នុង `project.json` = វីដេអូទាំងមូល (មិនទាន់កែ). */
export function clipsOrWhole(saved: Clip[], duration: number): Clip[] {
  if (saved.length) return saved
  return duration > 0 ? [[0, duration]] : []
}

/** អ្វីដែលត្រូវរក្សាទុក: clip តែមួយដែលគ្រប់វីដេអូ = [] (គ្មានការកែ). */
export function clipsToSave(clips: Clip[], duration: number): Clip[] {
  return clips.length === 1 && clips[0][0] <= 0.05 && clips[0][1] >= duration - 0.05 ? [] : clips
}

/** clip នេះបន្តពី clip មុនវាតាមពេល: គ្មានកន្លែងភ្ជាប់ក្នុងវីដេអូ (Split តែប៉ុណ្ណោះ). */
export function continues(clips: Clip[], index: number): boolean {
  return index > 0 && Math.abs(clips[index - 1][1] - clips[index][0]) < SAME
}

/** វីដេអូដែល Export ខុសពីវីដេអូដើមឬទេ — Split ដោយគ្មានអ្វីផ្សេង មិនមែនការកែទេ (pipeline ភ្ជាប់វាវិញ). */
export function isEdited(clips: Clip[], duration: number): boolean {
  if (!clips.length) return false
  const joined = clips.every((_, index) => index === 0 || continues(clips, index))
  return !(joined && clips[0][0] <= 0.05 && clips[clips.length - 1][1] >= duration - 0.05)
}

/** លេខកន្លែងភ្ជាប់គិតដល់ clip នេះ: zoom punch-in ឆ្លាស់តាមលេខនេះ (ដូច `cut_filter` លើ parts ដែលភ្ជាប់រួច). */
export function joinNumber(clips: Clip[], index: number): number {
  let number = 0
  for (let at = 1; at <= index; at++) if (!continues(clips, at)) number++
  return number
}

/** clip ដែលនៅក្នុង clip ផ្សេងទាំងមូល = "ច្បាប់ចម្លង" គឺមួយដែលខ្លីជាង ឬមកមុនពេលស្មើគ្នា — ស្លាក HOOK.
 *  ត្រួតគ្នាតែមួយផ្នែក (អូស || ចេញលើប្លុកជាប់គ្នា) មិនមែន HOOK ទេ. */
export function asParts(clips: Clip[]): Part[] {
  return clips.map(([start, end], index) => {
    const isCopy = clips.some(([a, b], other) => {
      if (other === index || a > start + SAME || b < end - SAME) return false
      const mine = end - start
      const theirs = b - a
      return theirs > mine + SAME || (Math.abs(theirs - mine) <= SAME && other > index)
    })
    return { start, end, insert: isCopy ? index : null }
  })
}

/** ចន្លោះដែលត្រូវកាត់ = ផ្ទុយពី clip ទាំងអស់ (តម្រៀបតាមពេល, មិនជាន់គ្នា). */
export function holes(clips: Clip[], duration: number): Cut[] {
  const out: Cut[] = []
  let at = 0
  for (const [start, end] of [...clips].sort((x, y) => x[0] - y[0])) {
    if (start - at >= 0.05) out.push([round(at), round(start)])
    at = Math.max(at, end)
  }
  if (duration - at >= 0.05) out.push([round(at), round(duration)])
  return out
}

/** កាត់ចន្លោះចេញពីគ្រប់ clip (clip អាចបែកជាពីរ). លុបអស់ = មិនប្តូរ: វីដេអូត្រូវមានអ្វីមួយនៅសល់. */
export function cutRanges(clips: Clip[], ranges: Cut[]): Clip[] {
  let out = clips
  for (const [a, b] of ranges) {
    const next: Clip[] = []
    for (const [start, end] of out) {
      if (end <= a || start >= b) {
        next.push([start, end])
        continue
      }
      if (a - start >= MIN_CLIP) next.push([start, round(a)])
      if (end - b >= MIN_CLIP) next.push([round(b), end])
    }
    out = next
  }
  return out.length ? out : clips
}

/** យកចន្លោះដែលកាត់មកវិញ: ពង្រីក clip ដែលនៅជាប់ បើគ្មាន = clip ថ្មីនៅមុន clip បន្ទាប់តាមពេល.
 *  ឧ. [[0, 5], [6, 60]], [5, 6] -> [[0, 60]]. */
export function restoreRange(clips: Clip[], [a, b]: Cut, duration: number): Clip[] {
  let out = clips.map((clip): Clip => [clip[0], clip[1]])
  for (const [hole0, hole1] of holes(clips, duration)) {
    const from = Math.max(hole0, a)
    const to = Math.min(hole1, b)
    if (to - from < 0.05) continue
    const before = out.findIndex((clip) => Math.abs(clip[1] - from) < SAME)
    const after = out.findIndex((clip) => Math.abs(clip[0] - to) < SAME)
    if (before >= 0) {
      out[before][1] = round(to)
      // ចន្លោះត្រូវបំពេញ ហើយ clip បន្ទាប់ក្នុងបញ្ជីបន្តពីនេះ = ភ្ជាប់ជាមួយ
      if (after === before + 1) {
        out[before][1] = out[after][1]
        out = out.filter((_, index) => index !== after)
      }
    } else if (after >= 0) {
      out[after][0] = round(from)
    } else {
      const later = out.filter((clip) => clip[0] >= to).sort((x, y) => x[0] - y[0])[0]
      out.splice(later ? out.indexOf(later) : out.length, 0, [round(from), round(to)])
    }
  }
  return out
}

/** Split: clip ដែលមាន `time` ក្លាយជាពីរ. `playing` = clip ដែលកំពុងចាក់ (ពេលមួយអាចនៅពីរកន្លែង).
 *  null = នៅជិតគែមពេក ឬក្រៅគ្រប់ clip. */
export function splitClip(clips: Clip[], time: number, playing = -1): { clips: Clip[]; index: number } | null {
  const inside = (clip: Clip | undefined) => clip !== undefined && time >= clip[0] + 0.05 && time <= clip[1] - 0.05
  const index = inside(clips[playing]) ? playing : clips.findIndex(inside)
  if (index < 0) return null
  const [start, end] = clips[index]
  const at = round(time)
  return { clips: [...clips.slice(0, index), [start, at], [at, end], ...clips.slice(index + 1)], index }
}

/** Link បានឬទេ: មាន clip បន្តពីគ្នាក្នុងការជ្រើស. */
export function canLink(clips: Clip[], [from, to]: [number, number]): boolean {
  for (let at = from + 1; at <= to; at++) if (continues(clips, at)) return true
  return false
}

/** Link: ភ្ជាប់ clip ដែលបន្តពីគ្នាក្នុងការជ្រើស (ដក Split). */
export function linkClips(clips: Clip[], [from, to]: [number, number]): Clip[] {
  const out: Clip[] = []
  clips.forEach((clip, index) => {
    if (index > from && index <= to && continues(clips, index)) out[out.length - 1] = [out[out.length - 1][0], clip[1]]
    else out.push(clip)
  })
  return out
}

/** អូស clip `from` ទៅចន្លោះ `gap` (0 = មុន clip ទី 0). លទ្ធផល: បញ្ជីថ្មី និងទីតាំងថ្មីរបស់វា. */
export function moveClip(clips: Clip[], from: number, gap: number): { clips: Clip[]; index: number } {
  const index = gap > from ? gap - 1 : gap
  const out = [...clips]
  const [clip] = out.splice(from, 1)
  out.splice(index, 0, clip)
  return { clips: out, index }
}

/** || អូសចេញបានដល់ណា: ត្រឹមផ្នែកដែលកាត់ រហូតដល់ clip ជិតបំផុតតាមពេល, បើគ្មាន = ដើម / ចុងវីដេអូ.
 *  ឧ. [[0, 20], [35, 55]]: ចុងប្លុកទីមួយដល់ 35; ដើមប្លុកទីពីរដល់ 20. គ្មានផ្នែកកាត់នៅជាប់ = អូសចេញមិនបាន (limit = គែមបច្ចុប្បន្ន). */
export function edgeLimit(clips: Clip[], index: number, side: 'start' | 'end', duration: number): number {
  const [start, end] = clips[index]
  const edge = side === 'start' ? start : end
  const others = clips.filter((_, at) => at !== index)
  // គែមនៅក្នុង clip ផ្សេងរួចហើយ (HOOK, ការត្រួតចាស់): គ្មានផ្នែកកាត់ឲ្យពង្រីកទេ
  if (others.some(([a, b]) => a < edge - SAME && b > edge + SAME)) return edge
  const limit = side === 'start'
    ? others.reduce((best, clip) => (clip[1] <= start + SAME ? Math.max(best, clip[1]) : best), 0)
    : others.reduce((best, clip) => (clip[0] >= end - SAME ? Math.min(best, clip[0]) : best), duration)
  return Math.abs(limit - edge) < 0.05 ? edge : limit // នៅសល់តិចពេក (ឧ. 55.7 នៃ 55.746) = ដល់ដែនហើយ
}

/** អូសគែម clip ទៅពេល `t`: ចូល = កាត់, ចេញ = ពង្រីកក្នុងដែន `edgeLimit`. */
export function trimClip(clips: Clip[], index: number, side: 'start' | 'end', t: number): Clip[] {
  return clips.map((clip, at): Clip => (at !== index ? clip : side === 'start' ? [round(t), clip[1]] : [clip[0], round(t)]))
}

/** "+ Extend a clip": ចម្លង `range` ទៅដាក់នៅពេល `at` ក្នុងវីដេអូដើម (0 = ដើម, ចុង = ក្រោយគេ, ផ្សេងពីនេះ = បំបែក clip នៅទីនោះ). */
export function insertCopy(clips: Clip[], range: Cut, at: number, duration: number): Clip[] {
  const copy: Clip = [round(range[0]), round(range[1])]
  if (at < 0.05) return [copy, ...clips]
  if (at >= duration - 0.05) return [...clips, copy]
  const split = splitClip(clips, at)
  if (split) return [...split.clips.slice(0, split.index + 1), copy, ...split.clips.slice(split.index + 1)]
  // `at` ក្នុងចន្លោះកាត់ ឬជាប់គែម clip: មុន clip បន្ទាប់តាមពេល
  const later = clips.filter((clip) => clip[0] >= at - SAME).sort((x, y) => x[0] - y[0])[0]
  const index = later ? clips.indexOf(later) : clips.length
  return [...clips.slice(0, index), copy, ...clips.slice(index)]
}
