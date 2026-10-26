import type { ReactNode } from 'react'
import { captionTextStyle } from '../captionLook'
import { DEFAULT_STYLE, type StylePreset } from '../captionStyle'
import { SubtitleIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'

/* ប្រើដោយ Subtitles (Presets) និងទំព័រ Import (Quick presets) — preset ដដែល គូរដូចគ្នា. */

/** គំរូតូចនៃ preset នីមួយៗ — preset ដែល render បាន គូរ "TO GET STARTED" ដោយ style ពិតរបស់វា
 *  (font, ពណ៌, stroke, italic) ដូចរូប OpusClip; Box និង Neon (មិនទាន់ render បាន) នៅជារូបគំរូ. */
export function PresetCard({ preset, on, onPick }: { preset: StylePreset; on: boolean; onPick: () => void }) {
  const real = preset.style && !preset.style.off ? { ...DEFAULT_STYLE, ...preset.style } : null
  const sample: Record<string, ReactNode> = {
    off: <SubtitleIcon name="none" size={32} />,
    bold: (
      <span className="text-[17px] leading-snug font-bold text-white [text-shadow:0_2px_3px_#000]">
        ចាប់ផ្ដើម<span className="text-gold">អាជីវកម្ម</span>
      </span>
    ),
    karaoke: (
      <span className="text-[17px] font-bold text-white [-webkit-text-stroke:1px_#000]">
        ចាប់ផ្ដើម <span className="text-[#00e054]">អាជីវកម្ម</span>
      </span>
    ),
    box: <span className="rounded-[4px] bg-black px-2 py-0.5 text-[15px] font-bold text-white">ចាប់ផ្ដើម</span>,
    clean: <span className="text-[16px] font-medium text-white">ចាប់ផ្ដើម</span>,
    neon: <span className="text-[17px] font-bold text-gold [text-shadow:0_0_6px_#ff8a3d]">ចាប់ផ្ដើម</span>,
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!preset.style}
      onClick={onPick}
      title={preset.style ? undefined : 'renderer មិនទាន់គូរ style នេះបាន'}
      className={`flex cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left disabled:cursor-default disabled:opacity-40 ${
        on ? 'text-text' : 'text-text-3'
      } ${focusRing}`}
    >
      <span
        className={`flex h-21 items-center justify-center rounded-button border-2 bg-raised text-text-4 ${
          on ? 'border-white' : 'border-transparent'
        }`}
      >
        {real ? (
          // 0.2 = គំរូតូច: stroke និង shadow តូចតាមទំហំ
          <span className="text-center leading-[1.1]" style={captionTextStyle(real, 18 * (real.size / 100), 0.2)}>
            {real.uppercase ? 'TO GET' : 'To get'}
            <br />
            <span style={{ color: real.color }}>{real.uppercase ? 'STARTED' : 'started'}</span>
          </span>
        ) : (
          sample[preset.id]
        )}
      </span>
      <span className={`text-[13px] ${on ? 'font-semibold' : ''}`}>{preset.name}</span>
    </button>
  )
}
