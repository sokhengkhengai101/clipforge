/** តម្រៀបបញ្ជី clip លើ Review: លំដាប់ AI / ពិន្ទុ / ពេលវេលា. */
export type Order = 'rank' | 'score' | 'time'

/** អ្វីដែលអ្នកជ្រើសលើ Review — App ទុកវា ព្រោះ Review unmount ពេលទៅ Subtitles ឬ Export
 *  រួចរាល់ ហើយធ្លាប់ត្រឡប់មកវិញជា "៥ ក្នុងចំណោម ៥" និង clip ទី ១ (វាស់ពិត: export បាន ៥ clips
 *  ក្រោយដក ៤). */
/** Filter លើ Review: ទាំងអស់ / តែ ♡ / លាក់ 👎. */
export type RatingFilter = 'all' | 'liked' | 'hide-disliked'

export type ReviewChoices = {
  order: Order
  filter: RatingFilter
  selected: number // clip ដែលកំពុងមើល (លេខ rank)
  unpicked: number[] // clip ដែលអ្នកដក checkbox
  destination: string // '' = កន្លែងលំនាំដើមពី sidecar
}

export const NO_CHOICES: ReviewChoices = { order: 'rank', filter: 'all', selected: 1, unpicked: [], destination: '' }
