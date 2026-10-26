import { text, type Text } from '../i18n'
import { PRESETS, type Preset } from '../presets'

/** កាតឧបករណ៍ទាំង ៨ លើ Home (design/screens/Home.html), តាមលំដាប់ក្នុង design.
 *
 *  កាតនីមួយៗចង្អុលទៅ preset ពិតក្នុង `presets.ts` — ចុចវា = ជ្រើស preset នោះ
 *  (flag ពិតដែល job នឹងរត់). ឧបករណ៍ដែល preset មិនទាន់ `ready` ត្រូវស្រអាប់
 *  ហើយមានស្លាក Phase; "Auto Subtitles" បើក dialog របស់វា (វីដេអូទាំងមូល + captions) —
 *  subtitles ខ្មែរនៅជា Phase 2. អត្ថបទចម្លងពី HTML (HANDOFF: រក្សា string). */
export type Category = 'clips' | 'subtitles' | 'edit'

export type Tool = {
  id: string
  title: Text // `t(tool.title)` យកភាសា app (i18n.ts)
  description: Text
  badge: 'AI' | 'Agency' | null // null = គ្មានស្លាក (ឧ. លុបភាពស្ងាត់: ក្បួនលើ transcript មិនមែន AI)
  categories: Category[]
  preset: Preset | null // null = គ្មាន engine នៅឡើយ
  phase: string | null // "PHASE 2" ... ពេលវាមិនទាន់រត់បាន
  opens?: 'models' // ឧបករណ៍ដែលបើកទំព័រ មិនមែន preset (AI Models)
  isNew?: boolean // ស្លាក "ថ្មី" លើទំព័រ ឧបករណ៍ទាំងអស់
}

function preset(id: string): Preset {
  const found = PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`preset ${id} មិនមាន`)
  return found
}

/** ឧបករណ៍មួយ — phase មកពី preset ផ្ទាល់ ដូច្នេះ Home និងទំព័រ Projects មិនអាចខុសគ្នា. */
function tool(
  id: string,
  title: Text,
  description: Text,
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
  // Podcast, interview, webinar: AI វិភាគ shot នីមួយៗ (មុខ មនុស្ស slide) — មិនបាច់ជ្រើសប្រភេទ
  tool('shorts', text('Long to Short', 'Long to Short'),
    text('វីដេអូវែង → ៥ / ១០ / ១៥ clips · AI វិភាគ shot ហើយរក hook ល្អៗ', 'Long video → 5 / 10 / 15 clips · AI reads each shot and finds the hooks'),
    ['clips'], 'shorts'),
  // វីដេអូទាំងមូល + captions (`--full`); subtitles ខ្មែរ = Phase 2 (font + Whisper ខ្មែរ)
  tool('subtitles', text('Auto Subtitles', 'Auto Subtitles'),
    text('ដាក់ subtitles លើវីដេអូទាំងមូល ក្នុង ១ ចុច · ខ្មែរ Phase 2', 'Captions on a whole video in one click · Khmer in Phase 2'),
    ['subtitles'], 'subtitles'),
  // editor ដូច OpusClip: transcript ជាមួយ pause ពិត, preview, timeline; export ពិតតាម `--full`
  tool('editor', text('Edit Video', 'Edit Video'),
    text('កែតាម transcript · មើលពាក្យ និង pause · timeline', 'Edit by transcript · see words and pauses · timeline'), ['edit'], 'editor'),
  tool('reframe', text('Auto Reframe', 'Auto Reframe'),
    text('16:9 ទៅជា 9:16, 1:1, 4:5 តាមដានមុខ', '16:9 to 9:16, 1:1, 4:5, following faces'), ['edit'], 'reframe'),
  // pause វែង + "um / you know" ពី transcript — អ្នកពិនិត្យបញ្ជីមុន export; គ្មានស្លាក AI (អ្នកអភិវឌ្ឍ)
  tool('silence', text('លុបភាពស្ងាត់ & "អឺ"', 'Remove silence & "um"'),
    text('កាត់ pause វែង និង "um / you know" · ពិនិត្យមុន export', 'Cut long pauses and "um / you know" · review before export'),
    ['edit'], 'silence', null),
  tool('english', text('English → ខ្មែរ', 'English → Khmer'),
    text('Clips ពីវីដេអូ English ជាមួយ subtitles ពីរភាសា', 'Clips from English videos with bilingual subtitles'), ['subtitles'], 'english'),
  tool('agency', text('Agency Batch', 'Agency Batch'),
    text('វីដេអូច្រើន ជាមួយ logo និងពណ៌ brand', 'Many videos with your logo and brand colours'), ['clips'], 'agency', 'Agency'),
]

/** tab លើ Home: "ពេញនិយម" បង្ហាញទាំងអស់ (design បង្ហាញទាំង ៨ ក្រោម tab នោះ). */
export const FILTERS: { value: 'popular' | Category; label: Text }[] = [
  { value: 'popular', label: text('ពេញនិយម', 'Popular') },
  { value: 'clips', label: text('Clips', 'Clips') },
  { value: 'subtitles', label: text('Subtitles', 'Subtitles') },
  { value: 'edit', label: text('កែវីដេអូ', 'Edit video') },
]

/** ទំព័រ "ឧបករណ៍ទាំងអស់": ឧបករណ៍ ៨ របស់ Home + ៣ ដែល app មានពិត តែ Home មិនបង្ហាញ.
 *  Caption Studio = preset `caption` (style captions English), Gaming = Phase 3,
 *  AI Models = ទំព័រ Models (ជ្រើស Lite / Standard / Pro). */
export const ALL_TOOLS: Tool[] = [
  ...TOOLS.map((item) => (item.id === 'reframe' ? { ...item, isNew: true } : item)),
  tool('caption', text('Caption Studio', 'Caption Studio'),
    text('Captions English ពាក្យសកម្មពណ៌ · ប្តូរ style មើលភ្លាមៗ', 'English captions with the spoken word coloured · see style changes at once'),
    ['subtitles'], 'caption'),
  tool('gaming', text('Gaming Auto Clipper', 'Gaming Auto Clipper'),
    text('រកពេលសំឡេងខ្លាំងៗក្នុង stream ជា clips', 'Turns the loud moments of a stream into clips'), ['clips'], 'gaming'),
  {
    id: 'models',
    title: text('AI Models', 'AI Models'),
    description: text('ជ្រើស Lite / Standard / Pro តាម GPU របស់អ្នក', 'Pick Lite / Standard / Pro for your GPU'),
    badge: 'AI',
    categories: ['edit'],
    preset: null,
    phase: null,
    opens: 'models',
  },
]

/** tab លើទំព័រ ឧបករណ៍ទាំងអស់ (ដូច "Recently / Hot / Video..." ក្នុងរូបដែលអ្នកអភិវឌ្ឍផ្ញើ). */
export type CatalogTab = 'recent' | 'popular' | Category

export const CATALOG_TABS: { value: CatalogTab; label: Text }[] = [
  { value: 'recent', label: text('ថ្មីៗ', 'Recent') },
  { value: 'popular', label: text('ពេញនិយម', 'Popular') },
  { value: 'clips', label: text('Clips', 'Clips') },
  { value: 'subtitles', label: text('Subtitles', 'Subtitles') },
  { value: 'edit', label: text('កែវីដេអូ', 'Edit video') },
]
