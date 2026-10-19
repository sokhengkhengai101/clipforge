import type { ReactNode } from 'react'
import { IN_TAURI } from '../api'
import { CloseIcon, MaximizeIcon, MinimizeIcon, PlayMark } from './icons'
import { focusRing } from './styles'

/** របារខាងលើរបស់ screen ទាំងអស់ (Review.html `<header>`): ផ្ទៃ `chrome`,
 *  បន្ទាត់ `line` ខាងក្រោម, logo + ឈ្មោះ + breadcrumb ខាងឆ្វេង, window controls ខាងស្តាំ.
 *
 *  Window គ្មាន decoration (`decorations: false`) ដូច្នេះរបារនេះត្រូវអូស window បាន:
 *  `data-tauri-drag-region` ដំណើរការតែលើធាតុដែលមាន attribute នោះផ្ទាល់ មិនមែនលើកូនវា
 *  ទេ — ដូច្នេះអក្សរ និងចន្លោះទទេក៏ត្រូវមានវាដែរ. វាត្រូវការ permission
 *  `core:window:allow-start-dragging` (capabilities/default.json). */
export function TopBar({
  crumb,
  onHome,
  children,
}: {
  crumb?: ReactNode
  onHome?: () => void // logo + ឈ្មោះ = ត្រឡប់ទៅ Home (design គ្មានផ្លូវត្រឡប់ផ្សេងពី Import)
  children?: ReactNode
}) {
  return (
    <header
      data-tauri-drag-region
      className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-chrome py-2.5 pr-2 pl-5 font-kantumruy text-text"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onHome}
          disabled={!onHome}
          title={onHome ? 'ទំព័រដើម' : undefined}
          className={`flex cursor-pointer items-center gap-2.5 rounded-field border-0 bg-transparent p-0 text-text disabled:cursor-default ${focusRing}`}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-gold text-on-gold">
            <PlayMark />
          </span>
          <span className="text-[15px] font-bold whitespace-nowrap">Khmer Clip Studio</span>
        </button>
        {crumb && (
          <>
            <span data-tauri-drag-region className="text-text-5">
              /
            </span>
            <span data-tauri-drag-region className="truncate type-body text-text-3">
              {crumb}
            </span>
          </>
        )}
      </div>
      <div data-tauri-drag-region className="flex items-center gap-3.5">
        {children}
        <WindowControls />
      </div>
    </header>
  )
}

/** បង្រួម / ពង្រីក / បិទ — 44×36, icon បន្ទាត់ 12px (TOKENS.md "Window controls").
 *  Hover លើ Close ពណ៌ `danger` ដូច Windows; design មិនគូរ hover ទេ.
 *  ក្នុង browser វាគ្មានអ្វីត្រូវបិទ ដូច្នេះប៊ូតុងគ្មានឥទ្ធិពល. */
export function WindowControls() {
  const act = async (what: 'close' | 'minimize' | 'toggle') => {
    if (!IN_TAURI) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow()
    try {
      if (what === 'close') await window.close()
      else if (what === 'minimize') await window.minimize()
      else await window.toggleMaximize()
    } catch (error) {
      // គ្មាន permission ធ្លាប់ធ្វើឲ្យប៊ូតុងទាំងនេះស្ងាត់ — ឥឡូវយ៉ាងហោចណាស់វាប្រាប់
      console.error(`window ${what} failed:`, error)
    }
  }

  const base =
    `inline-flex h-9 w-11 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-text-2 ${focusRing}`
  return (
    <div aria-label="Window controls" className="ml-1.5 flex items-center gap-0.5">
      <button type="button" aria-label="Minimize" onClick={() => act('minimize')} className={`${base} hover:bg-field`}>
        <MinimizeIcon />
      </button>
      <button type="button" aria-label="Maximize" onClick={() => act('toggle')} className={`${base} hover:bg-field`}>
        <MaximizeIcon />
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => act('close')}
        className={`${base} hover:bg-danger hover:text-text`}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
