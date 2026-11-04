import type React from 'react'

/** Icon ពី design/screens/*.html — path ចម្លងដូចបេះបិទ មិនគូរថ្មីទេ.
 *  ពណ៌មកពី `currentColor` (ពណ៌អក្សររបស់ធាតុមេ) ដូច្នេះ hover ប្តូរពណ៌បាន
 *  ហើយ design ប្រើ #D4D8DF (= `text-text-2`) សម្រាប់ស្ទើរតែគ្រប់ icon. */

/** ត្រីកោណ "play" ក្នុងការ៉េលឿងរបស់ logo (Review.html, SignInModal.html). */
export function PlayMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.5L12 7L3 12.5Z" fill="currentColor" />
    </svg>
  )
}

/** Window controls: បន្ទាត់ 12px, stroke 1.25 (Review.html). */
export function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 6h10" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="9"
        height="9"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  )
}

/** X: window control ប្រើ 12px / 1.25; ប៊ូតុងបិទ dialog ប្រើ 14px / 1.5 មូល (SignInModal.html). */
export function CloseIcon({ size = 12, weight = 1.25 }: { size?: number; weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M1.5 1.5l9 9M10.5 1.5l-9 9"
        stroke="currentColor"
        strokeWidth={weight}
        strokeLinecap={weight > 1.25 ? 'round' : undefined}
      />
    </svg>
  )
}

/** រូបមនុស្សក្នុងប៊ូតុង Account (Review.html top bar). */
export function UserIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  )
}

/** Icon បន្ទាត់ 24×24 (sidebar, ប៊ូតុងខាងលើ). Design: item សកម្មប្រើ stroke 2,
 *  item ធម្មតាប្រើ 1.75 — ដូច្នេះ `weight` ជា prop. */
function Line({
  size,
  weight = 1.75,
  join = true,
  children,
}: {
  size: number
  weight?: number
  join?: boolean
  children: React.ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin={join ? 'round' : undefined}
    >
      {children}
    </svg>
  )
}

type LineIcon = { size?: number; weight?: number }

export function HomeIcon({ size = 18, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
    </Line>
  )
}

export function FolderIcon({ size = 18, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Line>
  )
}

export function GridIcon({ size = 18, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </Line>
  )
}

export function SettingsIcon({ size = 18, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Line>
  )
}

export function ScissorsIcon({ size = 17, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.5 15.5M14.5 14.5L20 20M8.5 8.5L12 12" />
    </Line>
  )
}

export function SubtitlesIcon({ size = 17, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h4M13 15h4M7 11h10" />
    </Line>
  )
}

export function ReframeIcon({ size = 17, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <rect x="2" y="7" width="12" height="9" rx="1.5" />
      <rect x="16" y="4" width="6" height="15" rx="1.5" />
    </Line>
  )
}

export function HeadsetIcon() {
  return (
    <Line size={20}>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </Line>
  )
}

export function MenuIcon() {
  return (
    <Line size={20} join={false}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Line>
  )
}

/** "+" ក្នុងប៊ូតុង Import (stroke 2.5) និង "→" ក្នុងប៊ូតុង ចាប់ផ្ដើម. */
export function PlusIcon() {
  return (
    <Line size={14} weight={2.5} join={false}>
      <path d="M12 5v14M5 12h14" />
    </Line>
  )
}

export function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return (
    <Line size={size} weight={2.5}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Line>
  )
}

/** ព្រួញឡើងលើទូ (drop zone ក្នុង Main.html: 40px, stroke 1.6, ពណ៌ gold). */
export function UploadIcon({ size = 40 }: { size?: number }) {
  return (
    <Line size={size} weight={1.6}>
      <path d="M12 15V4M7 9l5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Line>
  )
}

/** chip ក្នុងសារ "កុំព្យូទ័រនេះ" (Main.html footer). */
export function CpuIcon() {
  return (
    <Line size={16}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </Line>
  )
}

/** សញ្ញាធីក: file ដែលបានជ្រើស (design គ្មានស្ថានភាពនេះ — គូរពី style ដូចគ្នា). */
export function CheckIcon({ size = 20 }: { size?: number }) {
  return (
    <Line size={size} weight={2.25}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Line>
  )
}

/** ធីកពណ៌បៃតងក្នុងជំហានដែលរួច (Processing.html: viewBox 14, stroke 2). */
export function DoneCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** "i" ក្នុងរង្វង់ — សារព្រមាន/ព័ត៌មាន (design ប្រើកណ្តឹងជូនដំណឹង ដែល app នេះគ្មាន). */
export function InfoIcon() {
  return (
    <Line size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Line>
  )
}

/** ‹ › — clip មុន / បន្ទាប់ (Review.html: viewBox 24, stroke 2). */
export function ChevronIcon({ direction, size = 16 }: { direction: 'left' | 'right'; size?: number }) {
  return (
    <Line size={size} weight={2}>
      <path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </Line>
  )
}

/** Pause — design គូរតែ Play; គូរពីរបារ ទំហំដូច PlayMark. */
export function PauseMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="2" width="3" height="10" rx="0.75" fill="currentColor" />
      <rect x="8" y="2" width="3" height="10" rx="0.75" fill="currentColor" />
    </svg>
  )
}

/** Icon របស់ Subtitles.html: toolbar ពីលើ preview និង nav "Editor tools" (paths ចម្លងពី HTML). */
const SUBTITLE_PATHS: Record<string, React.ReactNode> = {
  phone: <rect x="7" y="3" width="10" height="18" rx="2" />,
  layout: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  background: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  tracker: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  enhance: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" />
    </>
  ),
  library: (
    <>
      <path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 8.5 4.5 4.5 0 0 1 17.5 18" />
      <path d="M12 12v8M9 15l3-3 3 3" />
    </>
  ),
  brand: (
    <>
      <rect x="4" y="3" width="10" height="18" rx="2" />
      <path d="M14 8l5 2-4 10" />
      <circle cx="9" cy="16" r="1.5" />
    </>
  ),
  broll: (
    <>
      <rect x="7" y="7" width="13" height="13" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
      <path d="M11.5 11h2.5a1.5 1.5 0 0 1 0 3h-2.5zM11.5 14h3a1.5 1.5 0 0 1 0 3h-3z" />
    </>
  ),
  motion: <path d="M3 19L7 5l5 9 5-9 4 14" />,
  none: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
}

export type SubtitleIconName = keyof typeof SUBTITLE_PATHS

export function SubtitleIcon({ name, size = 17 }: { name: SubtitleIconName; size?: number }) {
  return <Line size={size}>{SUBTITLE_PATHS[name]}</Line>
}

/** កែវពង្រីក — ប្រអប់ស្វែងរក (ទំព័រ ឧបករណ៍ទាំងអស់). */
export function SearchIcon({ size = 17, weight }: LineIcon) {
  return (
    <Line size={size} weight={weight}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Line>
  )
}
