import { useEffect, useState, type CSSProperties } from 'react'
import { api, type CaptionFont } from './api'
import type { CaptionAnimation, CaptionStyle } from './captionStyle'

/** face ដែល render ប្រើ -> font CSS ក្នុង preview. Montserrat ត្រូវ bundle (main.tsx); Inter, Arial,
 *  Impact និង Segoe UI គឺជា font ដែលដំឡើងលើ Windows ដូចដែល libass ប្រើ. */
const CSS_FONTS: Record<string, { family: string; weight: number }> = {
  'Montserrat SemiBold': { family: "'Montserrat'", weight: 600 },
  'Montserrat Bold': { family: "'Montserrat'", weight: 700 },
  'Montserrat ExtraBold': { family: "'Montserrat'", weight: 800 },
  'Montserrat Black': { family: "'Montserrat'", weight: 900 },
  'Inter Bold': { family: "'Inter'", weight: 700 },
  'Arial Bold': { family: 'Arial', weight: 700 },
  'Arial Black': { family: "'Arial Black'", weight: 900 },
  Impact: { family: 'Impact', weight: 400 },
  'Segoe UI Black': { family: "'Segoe UI'", weight: 900 },
}
/** em_scale របស់ Montserrat ExtraBold ពេល /fonts មិនទាន់ឆ្លើយ (វាស់ពី file .ttf) */
const DEFAULT_EM = 0.6402

/** បញ្ជី font ពី sidecar — សួរម្តងក្នុងមួយការបើក app (មិនប្តូរពេលរត់). */
let cached: Promise<CaptionFont[]> | null = null
export function useCaptionFonts(): CaptionFont[] {
  const [fonts, setFonts] = useState<CaptionFont[]>([])
  useEffect(() => {
    let stale = false
    cached ??= api.fonts().then((answer) => answer.fonts).catch(() => {
      cached = null // សាកម្តងទៀតលើកក្រោយ
      return []
    })
    void cached.then((list) => !stale && setFonts(list))
    return () => {
      stale = true
    }
  }, [])
  return fonts
}

/** ទំហំ em ក្នុង CSS = Fontsize របស់ ASS x em_scale (ឧ. 110 x 0.640 = 70 px នៅលើ 1920). */
export function emScaleOf(face: string, fonts: CaptionFont[]): number {
  return fonts.find((font) => font.face === face)?.em_scale ?? DEFAULT_EM
}

/** CSS របស់អក្សរ caption ដូច Style + shadow tags ក្នុង .ass. `scale` = px preview ក្នុង 1 px output. */
export function captionTextStyle(style: CaptionStyle, fontPx: number, scale: number): CSSProperties {
  const font = CSS_FONTS[style.font] ?? CSS_FONTS['Montserrat ExtraBold']
  const outline = style.outline * scale
  const shadow = style.shadow
  return {
    fontFamily: `${font.family}, sans-serif`,
    fontWeight: font.weight,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    fontSize: fontPx,
    color: style.textColor,
    // គ្រោងនៅក្រៅអក្សរ: stroke ពីរដងនៃ outline ហើយ fill គូរពីលើ (paint-order)
    WebkitTextStroke: outline > 0 ? `${outline * 2}px ${style.outlineColor}` : undefined,
    paintOrder: 'stroke fill',
    // BackColour alpha 0x80 = ពាក់កណ្តាលថ្លា ដូច render
    textShadow: shadow.on
      ? `${shadow.x * scale}px ${shadow.y * scale}px ${shadow.blur * scale}px ${shadow.color}80`
      : undefined,
  }
}

/** ពណ៌ពាក្យមួយ: ពាក្យកំពុងនិយាយ > ពាក្យសំខាន់ (keyword highlighter, ពណ៌ឆ្លាស់តាម cue) > ពណ៌អក្សរ.
 *  Box: អក្សរងងឹតលើប្រអប់ពណ៌; Highlighter: អក្សរពណ៌ធម្មតា (ដូច `caption_fx.active_word_colour`). */
export function wordColour(style: CaptionStyle, active: boolean, keyword: boolean, cueIndex: number): string | undefined {
  if (active && style.animation === 'box') return BOX_TEXT
  if (active && style.animation === 'highlighter') return undefined
  if (active) return style.color
  if (style.keywords && keyword) return style.keywordColors[cueIndex % 2]
  return undefined
}

// ---------- Animation (ដូច pipeline/caption_fx.py) ----------
// render ធ្វើលើបន្ទាត់នីមួយៗ (event មួយក្នុងមួយបន្ទាត់) ដូច្នេះ preview ក៏ដាក់ class លើបន្ទាត់នីមួយៗដែរ.
// លេខ px ទាំងអស់គិតលើ output (1080 x 1920) ហើយគុណ `scale` = px preview ក្នុង 1 px output.

const BOX_TEXT = '#111111'
const ENTRANCES = new Set(['bounce', 'fade', 'slide', 'slide_left', 'blur_in', 'soft_landing', 'grow'])
const HOLD_CLASS: Partial<Record<CaptionAnimation, string>> = {
  breathe: 'caption-breathe',
  baby_earthquake: 'caption-quake',
  glitch_infinite_zoom: 'caption-glitch',
}

/** '#RRGGBB' + ភាពស្រអាប់ -> rgba(...) */
function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
}

/** ម៉ោងរបស់ CSS animation = ម៉ោងវីដេអូ (មិនមែនម៉ោង browser):
 *  - ផ្អាក: animation ឈរនៅពេលវីដេអូ (`animation-delay` អវិជ្ជមាន + paused) ដូច frame ដែល FFmpeg គូរ;
 *  - កំពុងចាក់: ចាប់ផ្តើមម្តងក្នុងមួយ cue ពីកន្លែងដែលការចាក់ចាប់ផ្តើម ហើយរត់ដោយខ្លួនឯង.
 *  `key` ប្តូរ = element ថ្មី = animation ចាប់ផ្តើមពី `delay`. ឧ. ផ្អាក 0.5 s ក្នុង cue -> delay -0.5. */
export type MotionClock = { key: string; at: number; running: boolean }
export function useMotionClock(cueStart: number | null, time: number, playing: boolean): MotionClock {
  // "information from previous renders": ប្តូរ anchor ពេល render (React អនុញ្ញាតក្នុង component ខ្លួនឯង)
  const [anchor, setAnchor] = useState({ cue: cueStart, playing, at: time })
  if (anchor.cue !== cueStart || anchor.playing !== playing || (!playing && anchor.at !== time)) {
    setAnchor({ cue: cueStart, playing, at: time })
  }
  return { key: `${cueStart}:${anchor.at}:${playing}`, at: anchor.at, running: playing }
}

/** ប្រអប់ដូច libass (BorderStyle 3 / 4): កម្ពស់ = Fontsize ទាំងមូល (ascent + descent = `assPx`) + pad
 *  ទាំងសងខាង, ចំណែក CSS គ្របតែ `fontPx` (= assPx x em_scale). padding បន្ថែមភាពខុសគ្នានោះ ហើយ margin
 *  អវិជ្ជមានស្មើគ្នាទុកទំហំ layout ដដែល — ពាក្យឯទៀតមិនរំកិល.
 *  វាស់មុនកែ: ប្រអប់ Box កម្ពស់ 94 px ក្នុង preview ធៀបនឹង 132 px ក្នុង render. */
function boxArea(fill: string, assPx: number, fontPx: number, padRatio: number): CSSProperties {
  const pad = padRatio * assPx
  const tall = (assPx - fontPx) / 2 + pad
  return {
    background: fill,
    lineHeight: 1,
    padding: `${tall}px ${pad}px`,
    margin: `${-tall}px ${-pad}px`,
  }
}

/** delay + play-state ពី clock: animation ចាប់ផ្តើមនៅ `start` (cue ឬពាក្យ) ក្នុងម៉ោងវីដេអូ. */
function clockCss(clock: MotionClock, start: number): CSSProperties {
  return { animationDelay: `${start - clock.at}s`, animationPlayState: clock.running ? 'running' : 'paused' }
}

/** class + style សម្រាប់បន្ទាត់មួយរបស់ cue (key វាលើ `clock.key` ដើម្បីឲ្យ CSS animation ចាប់ផ្តើមម្តងទៀត).
 *  ស្រទាប់ខាងក្រោម (backdrop, ពណ៌ glitch) នៅ `underLayers`. */
export function lineMotion(
  style: CaptionStyle,
  { cueStart, cueSeconds, clock, scale, width, height }: {
    cueStart: number
    cueSeconds: number
    clock: MotionClock
    scale: number
    width: number // output px (1080)
    height: number // output px (1920)
  },
): { className: string; style: CSSProperties } {
  const kind = style.animation
  const className = ENTRANCES.has(kind) ? `caption-${kind.replace('_', '-')}` : (HOLD_CLASS[kind] ?? '')
  const css: CSSProperties & Record<string, string> = {
    ...(clockCss(clock, cueStart) as Record<string, string>),
    '--cap-px': `${scale}px`,
    '--cap-shift': `${Math.round(width * 0.075) * scale}px`, // slide_left: 7.5% ទទឹង
    '--cap-drop': `${Math.round(height * 0.03) * scale}px`, // soft_landing: 3% កម្ពស់
    '--cap-rise': `${Math.round(height * 0.02) * scale}px`, // slide: 2% កម្ពស់
  }
  // glitch: ពង្រីក 100 -> 118% ពេញមួយ cue
  if (kind === 'glitch_infinite_zoom') css.animationDuration = `${Math.max(cueSeconds, 0.05)}s`
  return { className, style: css }
}

/** ស្រទាប់ដែល render គូរនៅ layer 0 **ក្រោម**អក្សរទាំងអស់ (`captions.line_events`), គូរជាច្បាប់ចម្លង
 *  នៃបន្ទាត់នៅពីក្រោយអក្សរពិត — មិនមែន text-shadow ទេ ព្រោះ text-shadow ចម្លងគ្រោងផង (វាស់: ពណ៌ glitch
 *  ក្រាស់ពេក) ហើយប្រអប់របស់បន្ទាត់ទី ២ គ្របអក្សរបន្ទាត់ទី ១ (backdrop).
 *  - glitch: ពណ៌ក្រហមទៅឆ្វេង ខៀវទៅស្តាំ 0.8% ទទឹង, គ្មានគ្រោង, alpha 0x50 = 69%
 *  - with_backdrop: ប្រអប់ខ្មៅ alpha 0x48 (= 72%) ពីក្រោយបន្ទាត់ទាំងមូល (BorderStyle 4), padding 22% */
export type UnderLayer = { key: string; dx: number; text: CSSProperties; line: CSSProperties }
export function underLayers(
  style: CaptionStyle,
  { scale, width, assPx, fontPx }: { scale: number; width: number; assPx: number; fontPx: number },
): UnderLayer[] {
  const bare: CSSProperties = { WebkitTextStroke: '0', textShadow: 'none', textDecoration: 'none' }
  if (style.animation === 'glitch_infinite_zoom') {
    const shift = Math.round(width * 0.008) * scale
    return [
      { key: 'red', dx: -shift, text: { ...bare, color: rgba('#FF2A55', 0.69) }, line: {} },
      { key: 'cyan', dx: shift, text: { ...bare, color: rgba('#22D3FF', 0.69) }, line: {} },
    ]
  }
  if (style.animation === 'with_backdrop') {
    return [{ key: 'backdrop', dx: 0, text: { ...bare, color: 'transparent' }, line: boxArea(rgba('#000000', 0.72), assPx, fontPx, 0.22) }]
  }
  return []
}

/** class + style របស់ពាក្យមួយ (ពាក្យកំពុងនិយាយ / ពាក្យផ្សេង), ដូច `caption_fx.active_word_tags` /
 *  `other_word_tags` / baby_steps. ប្រអប់ = `boxArea` (មិនរំកិលពាក្យឯទៀត). */
export function wordMotion(
  style: CaptionStyle,
  { spoken, wordStart, clock, someoneSpeaking, future, activeScale, scale, assPx, fontPx }: {
    spoken: boolean
    wordStart: number
    clock: MotionClock
    someoneSpeaking: boolean // render ព្រិល/ស្រអាប់ពាក្យផ្សេង តែពេលមានពាក្យកំពុងនិយាយ
    future: boolean // baby_steps: ពាក្យដែលមិនទាន់និយាយ
    activeScale: number // Pop: 1.1
    scale: number
    assPx: number
    fontPx: number
  },
): { className: string; style: CSSProperties } {
  const kind = style.animation
  const css: CSSProperties = {}
  let className = ''
  if (kind === 'baby_steps' && future) css.visibility = 'hidden' // នៅតែកាន់កន្លែង ដូច \alpha&HFF&
  if (spoken) {
    if (kind === 'pop') css.transform = `scaleY(${activeScale})`
    // libass \fscx115 ពង្រីក advance ផង ដូច្នេះពាក្យជិតខាងរំកិល; `zoom` ធ្វើដូចគ្នា (transform មិនធ្វើ)
    if (kind === 'scale') css.zoom = 1.15
    if (kind === 'underline') css.textDecoration = 'underline'
    if (kind === 'seamless_bounce') {
      className = 'caption-word-bounce'
      Object.assign(css, clockCss(clock, wordStart))
    }
    if (kind === 'box' || kind === 'highlighter') {
      const fill = kind === 'box' ? style.color : rgba(style.color, 0.62) // highlighter alpha 0x60
      Object.assign(css, boxArea(fill, assPx, fontPx, kind === 'box' ? 0.12 : 0.2))
      // ប្រអប់នៅក្រោមពាក្យជិតខាង ដូច layer 0 (highlighter pad 22 px ធំជាងចន្លោះពាក្យ ហើយគ្របគ្រោងវា)
      css.position = 'relative'
      css.zIndex = -1
      if (kind === 'box') css.WebkitTextStroke = '0' // អក្សរងងឹតគ្មានគ្រោង
    }
  } else if (someoneSpeaking) {
    if (kind === 'blur_switch') {
      css.filter = `blur(${4 * scale}px)`
      css.WebkitTextStroke = '0' // render ដកគ្រោងចេញ ទើបអក្សរព្រិល
    }
    if (kind === 'focus') css.opacity = 0.4 // alpha 0x99
  }
  return { className, style: css }
}
