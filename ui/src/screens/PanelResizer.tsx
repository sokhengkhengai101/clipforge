import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { focusRing } from '../kit/styles'

/** បន្ទាត់ "<->" រវាងផ្ទាំងពីរ: អូសដើម្បីពង្រីក/បង្រួមផ្ទាំងខាងឆ្វេង.
 *  ពេលអូស `onLive` សរសេរទទឹងត្រង់ style នៃផ្ទាំងផ្ទាល់ (មិនប្រើ state) — បើ render EditorScreen ទាំងមូល
 *  (transcript រាប់ពាន់ពាក្យ) រាល់ការរំកិលមេម៉ៅ វានឹងមិនរលូន; `onChange` ហៅតែម្តងពេលលែង.
 *  ចុចពីរដង = ទំហំដើម; ←/→ លើ keyboard = 20 px (Shift = 80). */
export function PanelResizer({
  widthOf,
  onLive,
  min,
  maxOf,
  onChange,
  onReset,
  label,
}: {
  widthOf: () => number // ទទឹងបច្ចុប្បន្នរបស់ផ្ទាំង (px)
  onLive: (width: number) => void // កំពុងអូស — ផ្លាស់ប្តូរ style ផ្ទាល់
  min: number
  maxOf: () => number // ទទឹងធំបំផុត (គិតពេលអូស ព្រោះអាស្រ័យលើទំហំ window)
  onChange: (width: number) => void
  onReset: () => void
  label: string
}) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const clamp = (width: number) => Math.round(Math.min(Math.max(width, min), Math.max(min, maxOf())))
  const widthNow = widthOf
  const apply = onLive

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { x: event.clientX, width: widthNow() }
    document.body.style.cursor = 'col-resize' // រក្សា cursor ពេលមេម៉ៅចេញពីបន្ទាត់
  }
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    apply(clamp(start.current.width + event.clientX - start.current.x))
  }
  const onUp = () => {
    if (!start.current) return
    start.current = null
    document.body.style.cursor = ''
    onChange(clamp(widthNow()))
  }
  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 80 : 20
    const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    if (!delta) return
    event.preventDefault()
    event.stopPropagation() // កុំឲ្យ timeline / transcript ទទួល
    const next = clamp(widthNow() + delta)
    apply(next)
    onChange(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={onReset}
      onKeyDown={onKey}
      className={`relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none ${focusRing}`}
    >
      {/* បន្ទាត់ 1 px ដូចស៊ុមចាស់ — hover មិនប្តូរពណ៌ (អ្នកអភិវឌ្ឍ 2026-10-29); cursor ↔ ប្រាប់ថាអូសបាន */}
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
    </div>
  )
}
