import { PRESETS, type Preset } from '../presets'

/** កាតឧបករណ៍ទាំង ៨ លើ Home (design/screens/Home.html), តាមលំដាប់ក្នុង design.
 *
 *  កាតនីមួយៗចង្អុលទៅ preset ពិតក្នុង `presets.ts` — ចុចវា = ជ្រើស preset នោះ
 *  (flag ពិតដែល job នឹងរត់). ឧបករណ៍ដែល preset មិនទាន់ `ready` ត្រូវស្រអាប់
 *  ហើយមានស្លាក Phase; "Auto Subtitles" គ្មាន preset ទេ ព្រោះ subtitles ខ្មែរ
 *  ជារបស់ Phase 2 ទាំងស្រុង. អត្ថបទចម្លងពី HTML (HANDOFF: រក្សា string). */
export type Category = 'clips' | 'subtitles' | 'edit'

export type Tool = {
  id: string
  title: string
  description: string
  badge: 'AI' | 'Agency'
  categories: Category[]
  preset: Preset | null // null = គ្មាន engine នៅឡើយ
  phase: string | null // "PHASE 2" ... ពេលវាមិនទាន់រត់បាន
}

function preset(id: string): Preset {
  const found = PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`preset ${id} មិនមាន`)
  return found
}

/** ឧបករណ៍មួយ — phase មកពី preset ផ្ទាល់ ដូច្នេះ Home និងទំព័រ Projects មិនអាចខុសគ្នា. */
function tool(
  id: string,
  title: string,
  description: string,
  categories: Category[],
  presetId: string | null,
  badge: Tool['badge'] = 'AI',
): Tool {
  const linked = presetId ? preset(presetId) : null
  return {
    id,
    title,
    description,
    badge,
    categories,
    preset: linked,
    phase: linked ? (linked.ready ? null : linked.badge) : 'PHASE 2',
  }
}

export const TOOLS: Tool[] = [
  tool('podcast', 'Podcast Clips', 'Podcast ៣០–១២០ នាទី ក្លាយជា clips ខ្លីៗ', ['clips'], 'podcast'),
  tool('long', 'វីដេអូវែង → ១០ Clips', 'AI ជ្រើស hook និង highlight ល្អបំផុត', ['clips'], 'long'),
  tool('subtitles', 'Auto Subtitles', 'Subtitles ខ្មែរ highlight ពាក្យសំខាន់', ['subtitles'], null),
  tool('reframe', 'Auto Reframe', '16:9 ទៅជា 9:16, 1:1, 4:5 តាមដានមុខ', ['edit'], 'reframe'),
  tool('interview', 'Interview & Webinar', 'រកសំណួរ-ចម្លើយល្អៗ ជា clips', ['clips'], 'interview'),
  tool('silence', 'លុបភាពស្ងាត់ & "អឺ"', 'ធ្វើឱ្យវីដេអូរលូន ដោយស្វ័យប្រវត្តិ', ['edit'], 'silence'),
  tool('english', 'English → ខ្មែរ', 'Clips ពីវីដេអូ English ជាមួយ subtitles ពីរភាសា', ['subtitles'], 'english'),
  tool('agency', 'Agency Batch', 'វីដេអូច្រើន ជាមួយ logo និងពណ៌ brand', ['clips'], 'agency', 'Agency'),
]

/** tab លើ Home: "ពេញនិយម" បង្ហាញទាំងអស់ (design បង្ហាញទាំង ៨ ក្រោម tab នោះ). */
export const FILTERS: { value: 'popular' | Category; label: string }[] = [
  { value: 'popular', label: 'ពេញនិយម' },
  { value: 'clips', label: 'Clips' },
  { value: 'subtitles', label: 'Subtitles' },
  { value: 'edit', label: 'កែវីដេអូ' },
]
