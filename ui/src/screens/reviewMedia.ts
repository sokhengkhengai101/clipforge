import { api, clipFileUrl, clipThumbUrl, reframeFileUrl, reframeThumbUrl, sourceFrameUrl, sourceUrl, type Clip, type ExportResult, type ReframeResult, type Video } from '../api'
import type { Cue } from '../vtt'
import type { Aspect } from './aspects'

/** បើក editor ពី Review: ទំហំដែលជ្រើសពីម៉ឺនុយ ឬផ្ទាំង Motion (Auto zoom). */
export type EditorStart = { aspect?: Aspect; panel?: 'motion' }

/** Review រក file និង export យ៉ាងដូចម្តេច — clips (Long to Short) ឬ **វីដេអូទាំងមូល** (Auto Subtitles,
 *  Auto Reframe). ទំព័រតែមួយ ដូច្នេះលទ្ធផលពីឧបករណ៍ទាំងបីបើកដូចគ្នា (អ្នកអភិវឌ្ឍស្នើ 2026-10-25).
 *  វីដេអូទាំងមូលគ្មានពិន្ទុ គ្មាន ♡/👎 គ្មាន "ហេតុអ្វី AI ជ្រើស" ហើយ "កែ Subtitles" ក្លាយជា "មើល shots". */
export type ReviewMedia = {
  whole: boolean
  fileUrl: (index: number, kind: string, aspect?: string) => string // aspect: ទំហំក្រៅពី 9:16
  thumbUrl: (index: number, aspect?: string) => string
  exportItems: (indexes: number[], destination: string | undefined, aspect?: string) => Promise<ExportResult>
  onShots?: (index: number) => void // whole: timeline shot និង layout (ទំព័រលទ្ធផល Reframe ចាស់)
  cues?: () => Promise<Cue[]> // វីដេអូដើម: transcript មកពី /words ព្រោះគ្មាន `.vtt`
  onEditClip?: (start?: EditorStart) => void // មាន render ហើយ: ប៊ូតុង Edit clip ក្រោយ Export (បើក editor)
  onEdit?: (start?: EditorStart) => void // វីដេអូដើម: មិនទាន់ render អ្វី -> ប៊ូតុង Edit clip ជំនួស Export
}

/** Project ដែលបើកក្នុង Edit Video តែមិនទាន់ Export: Review បង្ហាញ**វីដេអូដើម** + transcript. */
export function sourceMedia(project: string, video: Video, onEdit: (start?: EditorStart) => void): ReviewMedia {
  return {
    whole: true,
    fileUrl: () => sourceUrl(video.path),
    thumbUrl: () => sourceFrameUrl(video.path, 10),
    exportItems: () => Promise.reject(new Error('មិនទាន់មានវីដេអូ render')),
    cues: () =>
      api.words(project).then((answer) =>
        answer.items.flatMap((item) => ('word' in item ? [{ start: item.start, end: item.end, text: item.word.trim() }] : [])),
      ),
    onEdit,
  }
}

export function sourceClip(seconds: number, title: string): Clip {
  return {
    index: 1,
    start: 0,
    end: seconds,
    duration: seconds,
    title,
    hook: '',
    type: 'source',
    total: 0,
    letter: '',
    grades: null,
    reason: '',
    files: { mp4: 'source' },
    rating: null,
  }
}

/** clips ធម្មតារបស់ project មួយ (clips.json). */
export function clipMedia(project: string): ReviewMedia {
  return {
    whole: false,
    fileUrl: (index, kind, aspect) => clipFileUrl(project, index, kind, aspect),
    thumbUrl: (index, aspect) => clipThumbUrl(project, index, aspect),
    exportItems: (indexes, destination, aspect) =>
      api.exportClips(project, { destination, clips: indexes, kinds: ['mp4', 'srt'], aspect }),
  }
}

/** លទ្ធផលវីដេអូទាំងមូល (`full`, `full_16x9` ...) ជា "clip" សម្រាប់ទំព័រ Review — ១ លទ្ធផល = ១ កាត.
 *  `type` 'whole-wide' = 16:9 / 1:1 (player ទូលាយ, រូបតូចមិនកាត់). */
export function wholeClips(results: ReframeResult[]): Clip[] {
  return results.map((result, at) => {
    const seconds = result.seconds ?? 0
    const [w, h] = result.aspect.split(':').map(Number)
    return {
      index: at + 1,
      start: 0,
      end: seconds,
      duration: seconds,
      title: `វីដេអូទាំងមូល ${result.aspect}${result.captions ? ' · subtitles' : ''}${result.edited ? ' · កែ' : ''}`,
      hook: '',
      type: w && h && w / h >= 1 ? 'whole-wide' : 'whole',
      total: 0,
      letter: '',
      grades: null,
      reason: '',
      files: result.files,
      rating: null,
    }
  })
}

/** file / រូប / export របស់លទ្ធផលវីដេអូទាំងមូល. Export ច្រើន = ម្តងមួយ folder រួចរួមលទ្ធផល. */
export function wholeMedia(project: string, results: ReframeResult[], onShots: (result: ReframeResult) => void): ReviewMedia {
  const folder = (index: number) => results[index - 1]?.folder ?? 'full'
  return {
    whole: true,
    fileUrl: (index, kind) => reframeFileUrl(project, folder(index), kind as 'mp4' | 'srt' | 'vtt'),
    thumbUrl: (index) => reframeThumbUrl(project, folder(index)),
    exportItems: async (indexes, destination) => {
      const merged: ExportResult = { destination: destination ?? '', files: [], skipped: [], bytes: 0, mb: 0 }
      for (const index of indexes) {
        const one = await api.exportReframe(project, folder(index), { destination, kinds: ['mp4', 'srt'] })
        merged.destination = one.destination
        // server ដាក់ index 1 ជានិច្ច (លទ្ធផលមួយក្នុងមួយការហៅ) — ដាក់លេខកាតពិតវិញ
        merged.files.push(...one.files.map((file) => ({ ...file, index })))
        merged.skipped.push(...one.skipped.map((file) => ({ ...file, index })))
        merged.bytes += one.bytes
        merged.mb += one.mb
      }
      return merged
    },
    onShots: (index) => {
      const result = results[index - 1]
      if (result) onShots(result)
    },
  }
}
