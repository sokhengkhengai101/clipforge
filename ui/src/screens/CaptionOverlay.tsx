import type { PreviewCues } from '../api'
import type { CaptionStyle } from '../captionStyle'

/** ទំហំ font ក្នុង ASS ≠ font-size ក្នុង CSS. libass យក "110" = កម្ពស់ win ascent + descent
 *  របស់ font (Montserrat ExtraBold: 1109 + 453 = 1562 units) ចំណែក CSS យក 110px = em (1000 units).
 *  ដូច្នេះ em ពិត = 110 × 1000 / 1562 = 0.640 × 110. វាស់ពី file .ttf; មុនកែ preview ធំជាង
 *  render 1.56 ដង (ប្រៀបធៀបនឹង frame ពិតត្រង់ 28.98 s នៃ clip rhino). */
const ASS_EM = 1000 / (1109 + 453)

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
}: {
  cues: PreviewCues
  style: CaptionStyle
  time: number // វិនាទីក្នុង clip
  height: number // កម្ពស់ preview ជា px
}) {
  if (style.off) return null
  const cue = cues.cues.find((item) => time >= item.start && time < item.end)
  if (!cue) return null
  const scale = height / cues.height
  const outline = style.outline * scale

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]">
      {cue.lines.map((line, index) => (
        <p
          key={index}
          className="absolute inset-x-0 m-0 text-center whitespace-nowrap text-white"
          style={{
            top: line.y * scale,
            transform: 'translateY(-50%)',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: cues.font_size * ASS_EM * scale,
            lineHeight: 1,
            // គ្រោងនៅក្រៅអក្សរ: stroke ពីរដងនៃ outline ហើយ fill គូរពីលើ (paint-order)
            WebkitTextStroke: outline > 0 ? `${outline * 2}px #000` : undefined,
            paintOrder: 'stroke fill',
            // Shadow 1 ពណ៌ BackColour &H80000000 = ខ្មៅ 50%
            textShadow: `${scale}px ${scale}px 0 rgb(0 0 0 / 0.5)`,
          }}
        >
          {line.words.map((word, at) => {
            const active = time >= word.start && time < word.end
            const text = style.uppercase ? word.text.toUpperCase() : word.text
            return (
              <span key={at}>
                {at > 0 && ' '}
                <span
                  className="inline-block"
                  style={active ? { color: style.color, transform: `scaleY(${cues.active_scale})` } : undefined}
                >
                  {text}
                </span>
              </span>
            )
          })}
        </p>
      ))}
    </div>
  )
}
