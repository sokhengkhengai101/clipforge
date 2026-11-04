import { DEFAULT_STYLE, type CaptionStyle } from './captionStyle'
import type { Pack } from './packs'

/** "រក្សាទុកការកំណត់ខាងលើជាលំនាំដើម" (OpusClip: "Save settings above as default").
 *
 *  `localStorage` = កន្លែងផ្ទុកតូចក្នុង browser/WebView2 របស់កុំព្យូទ័រនេះ ដែលនៅជាប់ពេលបិទបើក app.
 *  ឧ. `localStorage.setItem('k', '5')` ហើយលើកក្រោយ `localStorage.getItem('k')` ផ្តល់ '5'.
 *  វាអាចបរាជ័យ (storage បិទ ឬពេញ) ដូច្នេះរាល់ការអាន/សរសេរនៅក្នុង try/catch ហើយ app នៅតែដើរ
 *  ជាមួយតម្លៃលំនាំដើម. ការកំណត់ក្នុងមួយ project មិននៅទីនេះទេ — តែលំនាំដើមរបស់ job ថ្មី. */

export type PackChoice = 'auto' | Pack['id'] // auto = BEST FIT តាម VRAM ពិត

export type Defaults = {
  maxClips: number
  pack: PackChoice
  captionStyle: CaptionStyle
  savedAt: number | null // ms epoch — null = មិនដែលរក្សាទុក
}

const KEY = 'clipforge.defaults.v1'

export const FACTORY: Defaults = { maxClips: 5, pack: 'auto', captionStyle: DEFAULT_STYLE, savedAt: null }

export function loadDefaults(): Defaults {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return FACTORY
    const data = JSON.parse(raw) as Partial<Defaults>
    // ទទួលតែតម្លៃដែលត្រឹមត្រូវ — file ចាស់ ឬខូច មិនត្រូវធ្វើឲ្យ app ខុស
    return {
      maxClips: [5, 10, 15].includes(Number(data.maxClips)) ? Number(data.maxClips) : FACTORY.maxClips,
      pack: (['auto', 'lite', 'standard', 'pro'] as const).includes(data.pack as PackChoice)
        ? (data.pack as PackChoice)
        : FACTORY.pack,
      captionStyle: { ...DEFAULT_STYLE, ...(data.captionStyle ?? {}) },
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : null,
    }
  } catch {
    return FACTORY
  }
}

/** ពេលរក្សាទុក (ms epoch), ឬ `null` បើ storage បរាជ័យ. */
export function saveDefaults(defaults: Omit<Defaults, 'savedAt'>): number | null {
  try {
    const savedAt = Date.now()
    localStorage.setItem(KEY, JSON.stringify({ ...defaults, savedAt }))
    return savedAt
  } catch {
    return null
  }
}
