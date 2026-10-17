import type { JobOptions } from './api'
import presetPodcast from './assets/figma/preset-podcast.svg'
import presetSilence from './assets/figma/preset-silence.svg'
import presetCaption from './assets/figma/preset-caption.svg'
import presetLong from './assets/figma/preset-long.svg'
import presetReframe from './assets/figma/preset-reframe.svg'
import presetEnglish from './assets/figma/preset-english.svg'
import presetInterview from './assets/figma/preset-interview.svg'
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
    id: 'podcast',
    title: 'Podcast Clips',
    description: 'Find complete 30–90s moments, add captions and reframe to 9:16.',
    icon: presetPodcast,
    ready: true,
    badge: 'READY',
    options: { max_clips: 5 },
  },
  {
    id: 'silence',
    title: 'Silence & Filler Remover',
    description: 'Cut long pauses and “um / uh” with a preview before applying.',
    icon: presetSilence,
    ready: false,
    badge: 'PHASE 2',
    options: {},
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
    id: 'long',
    title: 'Long Video → 10 Clips',
    description: 'Rank the best hooks and highlights from any long video.',
    icon: presetLong,
    ready: true,
    badge: 'READY',
    options: { max_clips: 10 },
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
    id: 'interview',
    title: 'Interview & Webinar',
    description: 'Face crop, split screen and whole-frame fit for slides.',
    icon: presetInterview,
    ready: true,
    badge: 'READY',
    options: { layout: 'fill,split,fit' },
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
