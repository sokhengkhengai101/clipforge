import type { PreviewCues } from '../api'
import { captionTextStyle, emScaleOf, lineMotion, underLayers, useCaptionFonts, useMotionClock, wordColour, wordMotion } from '../captionLook'
import type { CaptionStyle } from '../captionStyle'

/** ទំហំ font ក្នុង ASS ≠ font-size ក្នុង CSS. libass យក "110" = កម្ពស់ win ascent + descent
 *  របស់ font (Montserrat ExtraBold: 1109 + 453 = 1562 units) ចំណែក CSS យក 110px = em (1000 units).
 *  ដូច្នេះ em ពិត = 110 × 1000 / 1562 = 0.640 × 110. វាស់ពី file .ttf; មុនកែ preview ធំជាង
 *  render 1.56 ដង (ប្រៀបធៀបនឹង frame ពិតត្រង់ 28.98 s នៃ clip rhino). */

/** Caption ផ្ទាល់ពីលើ clip គ្មាន caption — ធ្វើតាម `pipeline/captions.py` (render_line, cue_events):
 *  - cue មួយនៅលើអេក្រង់ពី start ដល់ end, បន្ទាត់នីមួយៗដាក់កណ្តាលនៅ `y` (an5 + \pos)
 *  - ពាក្យដែលកំពុងនិយាយ: ពណ៌ `style.color` + ពង្រីក**បញ្ឈរ** 110% (`\fscy`, មិនមែនទទឹង —
 *    ទទឹងធ្វើឲ្យពាក្យឯទៀតលោត)
 *  - អក្សរស (CAPTION_TEXT_COLOR), គ្រោងខ្មៅ `style.outline` px, ស្រមោល 1 px, Montserrat ExtraBold
 *    ទំហំ = font_size × ASS_EM (មើលខាងលើ)
 *  គ្រប់លេខគិតលើ 1080x1920 ហើយគុណនឹង `scale` = កម្ពស់ preview / 1920.
 *  ជិតដូច libass តែមិនដូចបេះបិទ (ការគូរគ្រោង និង metrics របស់ font ខុសគ្នាបន្តិច). */
export function CaptionOverlay({
  cues,
  style,
  time,
  height,
  playing,
}: {
  cues: PreviewCues
  style: CaptionStyle
  time: number // វិនាទីក្នុង clip
  height: number // កម្ពស់ preview ជា px
  playing: boolean
}) {
  const fonts = useCaptionFonts()
  const index = cues.cues.findIndex((item) => time >= item.start && time < item.end)
  const cue = cues.cues[index]
  const clock = useMotionClock(cue?.start ?? null, time, playing)
  if (style.off || !cue) return null
  const scale = height / cues.height
  const assPx = cues.font_size * scale
  // em = Fontsize របស់ ASS x em_scale របស់ font នោះ (ពី file .ttf តាម GET /fonts)
  const text = captionTextStyle(style, assPx * emScaleOf(style.font, fonts), scale)
  const motion = lineMotion(style, {
    cueStart: cue.start,
    cueSeconds: cue.end - cue.start,
    clock,
    scale,
    width: cues.width,
    height: cues.height,
  })
  const layers = underLayers(style, { scale, width: cues.width, assPx, fontPx: text.fontSize as number })
  const words = cue.lines.flatMap((line) => line.words)
  const active = words.find((word) => time >= word.start && time < word.end)
  const shown = (text: string) => (style.uppercase ? text.toUpperCase() : text)

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]">
      {/* layer 0 របស់ render (backdrop, ពណ៌ glitch): គូរមុន ដូច្នេះនៅក្រោមអក្សរទាំងអស់ */}
      {layers.map((layer) =>
        cue.lines.map((line, at) => (
          <p
            key={`${layer.key}-${at}`}
            className="absolute inset-x-0 m-0 text-center whitespace-nowrap"
            style={{ top: line.y * scale, transform: `translate(${layer.dx}px, -50%)`, lineHeight: 1, ...text, ...layer.text }}
          >
            <span key={clock.key} className={`inline-block ${motion.className}`} style={{ ...motion.style, ...layer.line }}>
              {line.words.map((word) => shown(word.text)).join(' ')}
            </span>
          </p>
        )),
      )}
      {cue.lines.map((line, at) => (
        <p
          key={at}
          className="absolute inset-x-0 m-0 text-center whitespace-nowrap"
          style={{ top: line.y * scale, transform: 'translateY(-50%)', lineHeight: 1, ...text }}
        >
          {/* key = cue: ចលនាចាប់ផ្តើមម្តងទៀតរាល់ cue ថ្មី; class លើបន្ទាត់នីមួយៗ ដូច event នីមួយៗក្នុង .ass */}
          <span key={clock.key} className={`inline-block ${motion.className}`} style={motion.style}>
            {line.words.map((word, w) => {
              const spoken = word === active
              const fx = wordMotion(style, {
                spoken,
                wordStart: word.start,
                clock,
                someoneSpeaking: !!active,
                future: !!active && word.start > active.start,
                activeScale: cues.active_scale, // Pop: ធំបញ្ឈរ 110%
                scale,
                assPx,
                fontPx: text.fontSize as number,
              })
              return (
                <span key={w}>
                  {w > 0 && ' '}
                  <span
                    className={`inline-block ${fx.className}`}
                    style={{ color: wordColour(style, spoken, !!word.keyword, index), ...fx.style }}
                  >
                    {shown(word.text)}
                  </span>
                </span>
              )
            })}
          </span>
        </p>
      ))}
    </div>
  )
}
