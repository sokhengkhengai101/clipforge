/** Style របស់ caption ដែល screen Subtitles កែ — នីមួយៗជា flag ពិតរបស់ make_clips.py.
 *  ប្តូរវា = `--redo render` លើ clip **ទាំងអស់** (pipeline render style តែមួយក្នុងមួយ run). */
export type CaptionStyle = {
  off: boolean // --no-captions: .srt/.vtt នៅតែសរសេរ តែមិនដុតចូល video
  words: number // --caption-words 2-8
  color: string // --caption-color: ពណ៌ពាក្យសំខាន់/ពាក្យដែលកំពុងនិយាយ
  size: number // --caption-size % (70-120)
  outline: number // --caption-outline px (0-8)
  uppercase: boolean // --caption-case upper | original
  position: 'auto' | 'top' | 'middle' | 'bottom' // --caption-position
}

/** តម្លៃលំនាំដើមរបស់ config.py — អ្វីដែល clip ភាគច្រើនត្រូវបាន render ជាមួយ. */
export const DEFAULT_STYLE: CaptionStyle = {
  off: false,
  words: 5,
  color: '#FFD23F',
  size: 100,
  outline: 4,
  uppercase: true,
  position: 'auto',
}

/** config.CAPTION_COLOR_PRESETS. */
export const CAPTION_COLORS = [
  { name: 'លឿង', hex: '#FFD23F' },
  { name: 'បៃតង', hex: '#00E054' },
  { name: 'ខៀវខ្ចី', hex: '#00E5FF' },
  { name: 'ទឹកក្រូច', hex: '#FF7A00' },
  { name: 'ស', hex: '#FFFFFF' },
]

export type StylePreset = {
  id: string
  name: string
  style: Partial<CaptionStyle> | null // null = renderer មិនទាន់គូរបាន (Box, Neon)
}

/** Preset = បណ្តុំ flag ដូច Home presets. Box ខ្មៅ ត្រូវការ BorderStyle 3 របស់ ASS ហើយ
 *  Neon ត្រូវការ blur/glow — renderer មិនទាន់មាន ដូច្នេះពួកវានៅលើអេក្រង់ តែចុចមិនបាន. */
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'off', name: 'គ្មាន captions', style: { off: true } },
  {
    id: 'bold',
    name: 'Bold លឿង',
    style: { off: false, color: '#FFD23F', uppercase: true, outline: 4, size: 100 },
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    style: { off: false, color: '#00E054', uppercase: true, outline: 4, size: 100 },
  },
  { id: 'box', name: 'Box ខ្មៅ', style: null },
  {
    id: 'clean',
    name: 'ស្អាត ស',
    style: { off: false, color: '#FFFFFF', uppercase: false, outline: 2, size: 90 },
  },
  { id: 'neon', name: 'Neon', style: null },
]

/** preset ណាដែល style នេះត្រូវនឹង — `null` = style ផ្ទាល់ខ្លួន. */
export function presetOf(style: CaptionStyle): string | null {
  if (style.off) return 'off'
  const found = STYLE_PRESETS.find(
    (preset) =>
      preset.style &&
      !preset.style.off &&
      Object.entries(preset.style).every(
        ([key, value]) => String(style[key as keyof CaptionStyle]).toLowerCase() === String(value).toLowerCase(),
      ),
  )
  return found?.id ?? null
}

/** style -> options របស់ POST /jobs (ឈ្មោះដូច flag). */
export function styleOptions(style: CaptionStyle): Record<string, unknown> {
  return {
    caption_words: style.words,
    caption_color: style.color,
    caption_size: style.size,
    caption_outline: style.outline,
    caption_case: style.uppercase ? 'upper' : 'original',
    caption_position: style.position,
    ...(style.off ? { no_captions: true } : {}),
  }
}
