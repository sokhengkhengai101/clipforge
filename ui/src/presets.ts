import type { JobOptions } from './api'
import presetPodcast from './assets/figma/preset-podcast.svg'
import presetSilence from './assets/figma/preset-silence.svg'
import presetCaption from './assets/figma/preset-caption.svg'
import presetReframe from './assets/figma/preset-reframe.svg'
import presetEnglish from './assets/figma/preset-english.svg'
import presetGaming from './assets/figma/preset-gaming.svg'
import presetAgency from './assets/figma/preset-agency.svg'

/** Preset មួយ = បណ្តុំ flag លើ engine តែមួយ (ដូច CLAUDE.md និយាយ).
 *  `options` ជាអ្វីដែលបន្ថែមលើ `--max-clips` ធម្មតា.
 *  `ready: false` = មុខងារនៅ Phase ក្រោយ, card បង្ហាញតែមិនចុចបាន. */
export type Preset = {
  id: string
  title: string
  description: string
  icon: string
  ready: boolean
  badge: string
  options: Omit<JobOptions, 'video'>
}

export const PRESETS: Preset[] = [
  {
    // Podcast Clips + Interview & Webinar + Long Video → 10 Clips រួមគ្នា (អ្នកអភិវឌ្ឍ 2026-10-23):
    // ពួកវាខុសគ្នាតែ `--layout` និង `--max-clips` — `auto` ឲ្យ planner វិភាគ shot នីមួយៗ ហើយ
    // ចំនួន clips (៥ / ១០ / ១៥) ជ្រើសក្នុង dialog
    id: 'shorts',
    title: 'Long to Short',
    description: 'AI reads each shot (faces, people, slides) and picks the layout; the LLM picks the best 5, 10 or 15 moments.',
    icon: presetPodcast,
    ready: true,
    badge: 'READY',
    options: { max_clips: 5, layout: 'auto' },
  },
  {
    // លុបភាពស្ងាត់ & អឺ: Speech cleanup របស់ Edit Video ក្នុង dialog — export = `--full --cuts`
    id: 'silence',
    title: 'Silence & Filler Remover',
    description: 'Cut long pauses and “um / you know”; you review the list before exporting.',
    icon: presetSilence,
    ready: true,
    badge: 'READY',
    options: { full: true },
  },
  {
    id: 'caption',
    title: 'Caption Studio',
    description: 'Re-render captions only — word count and keyword colour.',
    icon: presetCaption,
    ready: true,
    badge: 'READY',
    options: { redo: 'render', caption_words: 4 },
  },
  {
    // Auto Subtitles: វីដេអូទាំងមូល + captions (`--full`); dialog ជ្រើស aspect ភាសា និង style
    id: 'subtitles',
    title: 'Auto Subtitles',
    description: 'Captions on the whole video, in its own size or reframed.',
    icon: presetCaption,
    ready: true,
    badge: 'READY',
    options: { full: true },
  },
  {
    // Edit Video: editor ដែលផ្អែកលើ transcript (ពាក្យ, pause, preview, timeline) — export = `--full`
    id: 'editor',
    title: 'Edit Video',
    description: 'Transcript-based editor: words, pauses, preview and timeline.',
    icon: presetReframe,
    ready: true,
    badge: 'READY',
    options: { full: true },
  },
  {
    id: 'reframe',
    title: 'Auto Reframe',
    description: '16:9 to 9:16 with face, body and motion tracking.',
    icon: presetReframe,
    ready: true,
    badge: 'READY',
    options: { aspect: '9:16', layout: 'auto' },
  },
  {
    id: 'english',
    title: 'English Clip Studio',
    description: 'Bilingual EN + ខ្មែរ subtitles with vocabulary highlight.',
    icon: presetEnglish,
    ready: false,
    badge: 'PHASE 2',
    options: {},
  },
  {
    id: 'gaming',
    title: 'Gaming Auto Clipper',
    description: 'Spot wins, funny reactions and hype moments from audio.',
    icon: presetGaming,
    ready: false,
    badge: 'PHASE 3',
    options: {},
  },
  {
    id: 'agency',
    title: 'Agency Batch Factory',
    description: 'Many videos, brand kits per client, auto folder export.',
    icon: presetAgency,
    ready: false,
    badge: 'PHASE 3',
    options: {},
  },
]

/** flag ដែល preset បន្ថែម ជាអក្សរ: `{ max_clips: 5 }` -> "--max-clips 5".
 *  ដូចគ្នានឹងអ្វីដែល server/jobs.py ធ្វើ ដូច្នេះអ្វីដែល UI បង្ហាញ = អ្វីដែល job រត់. */
export function flagsOf(preset: Preset): string {
  return Object.entries(preset.options)
    .map(([key, value]) => `--${key.replace(/_/g, '-')} ${value}`)
    .join(' ')
}
