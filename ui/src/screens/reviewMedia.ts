import { api, clipFileUrl, clipThumbUrl, reframeFileUrl, reframeThumbUrl, type Clip, type ExportResult, type ReframeResult } from '../api'

/** Review រក file និង export យ៉ាងដូចម្តេច — clips (Long to Short) ឬ **វីដេអូទាំងមូល** (Auto Subtitles,
 *  Auto Reframe). ទំព័រតែមួយ ដូច្នេះលទ្ធផលពីឧបករណ៍ទាំងបីបើកដូចគ្នា (អ្នកអភិវឌ្ឍស្នើ 2026-10-25).
 *  វីដេអូទាំងមូលគ្មានពិន្ទុ គ្មាន ♡/👎 គ្មាន "ហេតុអ្វី AI ជ្រើស" ហើយ "កែ Subtitles" ក្លាយជា "មើល shots". */
export type ReviewMedia = {
  whole: boolean
  fileUrl: (index: number, kind: string) => string
  thumbUrl: (index: number) => string
  exportItems: (indexes: number[], destination: string | undefined) => Promise<ExportResult>
  onShots?: (index: number) => void // whole: timeline shot និង layout (ទំព័រលទ្ធផល Reframe ចាស់)
}

/** clips ធម្មតារបស់ project មួយ (clips.json). */
export function clipMedia(project: string): ReviewMedia {
  return {
    whole: false,
    fileUrl: (index, kind) => clipFileUrl(project, index, kind),
    thumbUrl: (index) => clipThumbUrl(project, index),
    exportItems: (indexes, destination) =>
      api.exportClips(project, { destination, clips: indexes, kinds: ['mp4', 'srt'] }),
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
