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
  // ផ្ទាំង Captions › Font / Effects (config.apply_caption_look)
  font: string // --caption-font: ឈ្មោះ face ពី GET /fonts (ឧ. 'Montserrat Black')
  textColor: string // --caption-text-color
  outlineColor: string // --caption-outline-color
  italic: boolean // --caption-italic
  underline: boolean // --caption-underline
  shadow: CaptionShadow // --caption-shadow x,y,blur,#RRGGBB
  keywords: boolean // --caption-keywords (AI keywords highlighter)
  keywordColors: [string, string] // --caption-keyword-colors
  lines: 1 | 3 // --caption-lines
  animation: CaptionAnimation // --caption-animation (ផ្លាស់មកពីផ្ទាំង Motion)
}

/** Animation ទាំង 21 ដូច `config.CAPTION_ANIMATIONS` (test Python ពិនិត្យថាដូចគ្នា) ជា ៣ ក្រុម
 *  ដូច `pipeline/caption_fx.py`: ពេល cue លេច / ពាក្យកំពុងនិយាយ / ពេញមួយ cue. */
export const ANIMATION_GROUPS = [
  {
    label: 'ពាក្យកំពុងនិយាយ',
    items: [
      ['pop', 'Pop — ធំបញ្ឈរ 110%'],
      ['scale', 'Scale'],
      ['underline', 'Underline'],
      ['box', 'Box'],
      ['highlighter', 'Highlighter box around'],
      ['seamless_bounce', 'Seamless bounce'],
      ['blur_switch', 'Blur switch'],
      ['focus', 'Focus'],
      ['baby_steps', 'Baby steps — លេចម្តងមួយពាក្យ'],
      ['none', 'None — ពណ៌ប៉ុណ្ណោះ'],
    ],
  },
  {
    label: 'ពេល cue លេច',
    items: [
      ['bounce', 'Bounce'],
      ['fade', 'Fade'],
      ['slide', 'Slide up'],
      ['slide_left', 'Slide left'],
      ['blur_in', 'Blur in'],
      ['soft_landing', 'Soft landing'],
      ['grow', 'Grow'],
    ],
  },
  {
    label: 'ពេញមួយ cue',
    items: [
      ['breathe', 'Breathe'],
      ['baby_earthquake', 'Baby earthquake'],
      ['glitch_infinite_zoom', 'Glitch infinite zoom'],
      ['with_backdrop', 'With backdrop'],
    ],
  },
] as const

export type CaptionAnimation = (typeof ANIMATION_GROUPS)[number]['items'][number][0]
export type CaptionShadow = { on: boolean; x: number; y: number; blur: number; color: string }

/** តម្លៃលំនាំដើមរបស់ config.py — អ្វីដែល clip ភាគច្រើនត្រូវបាន render ជាមួយ. */
export const DEFAULT_STYLE: CaptionStyle = {
  off: false,
  words: 5,
  color: '#FFD23F',
  size: 100,
  outline: 4,
  uppercase: true,
  position: 'auto',
  font: 'Montserrat ExtraBold',
  textColor: '#FFFFFF',
  outlineColor: '#000000',
  italic: false,
  underline: false,
  shadow: { on: true, x: 1, y: 1, blur: 0, color: '#000000' }, // = Shadow=1 ចាស់
  keywords: false,
  keywordColors: ['#04F827', '#FFFD03'],
  lines: 3,
  animation: 'pop',
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
    style: { off: false, font: 'Montserrat ExtraBold', italic: false, color: '#FFD23F', uppercase: true, outline: 4, size: 100 },
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    style: { off: false, font: 'Montserrat ExtraBold', italic: false, color: '#00E054', uppercase: true, outline: 4, size: 100 },
  },
  // preset ថ្មី (font ដែលដំឡើងរួច): ដូច "Beasty" និង "Think Media" ក្នុងរូប OpusClip
  {
    id: 'black-italic',
    name: 'Black Italic',
    style: { off: false, font: 'Montserrat Black', italic: true, color: '#FFD23F', uppercase: true, outline: 4, size: 90 },
  },
  {
    id: 'impact',
    name: 'Impact',
    style: { off: false, font: 'Impact', italic: false, color: '#FFFD03', uppercase: true, outline: 3, size: 100 },
  },
  { id: 'box', name: 'Box ខ្មៅ', style: null },
  {
    id: 'clean',
    name: 'ស្អាត ស',
    style: { off: false, font: 'Montserrat ExtraBold', italic: false, color: '#FFFFFF', uppercase: false, outline: 2, size: 90 },
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
    ...lookOptions(style),
  }
}

/** Font / ពណ៌ / shadow / keywords / បន្ទាត់ / animation — តែអ្វីដែលខុសពីលំនាំដើមប៉ុណ្ណោះ
 *  (job ដែលមិនប្តូរអ្វីទេ ផ្ញើ flag ដូចមុនបេះបិទ). */
export function lookOptions(style: CaptionStyle): Record<string, unknown> {
  const base = DEFAULT_STYLE
  const shadow = style.shadow
  const shadowChanged =
    !shadow.on || shadow.x !== base.shadow.x || shadow.y !== base.shadow.y || shadow.blur !== base.shadow.blur ||
    shadow.color.toLowerCase() !== base.shadow.color.toLowerCase()
  return {
    ...(style.font !== base.font ? { caption_font: style.font } : {}),
    ...(style.textColor.toLowerCase() !== base.textColor.toLowerCase() ? { caption_text_color: style.textColor } : {}),
    ...(style.outlineColor.toLowerCase() !== base.outlineColor.toLowerCase() ? { caption_outline_color: style.outlineColor } : {}),
    ...(style.italic ? { caption_italic: true } : {}),
    ...(style.underline ? { caption_underline: true } : {}),
    ...(shadowChanged
      ? { caption_shadow: shadow.on ? `${shadow.x},${shadow.y},${shadow.blur},${shadow.color}` : '0,0,0,#000000' }
      : {}),
    ...(style.keywords ? { caption_keywords: true, caption_keyword_colors: style.keywordColors.join(',') } : {}),
    ...(style.lines !== base.lines ? { caption_lines: style.lines } : {}),
    ...(style.animation !== base.animation ? { caption_animation: style.animation } : {}),
  }
}
