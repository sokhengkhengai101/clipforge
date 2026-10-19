import type { ReactNode } from 'react'
import { Chip } from '../kit/controls'
import {
  FolderIcon,
  GridIcon,
  HomeIcon,
  PlayMark,
  ReframeIcon,
  ScissorsIcon,
  SettingsIcon,
  SubtitlesIcon,
} from '../kit/icons'
import { focusRing } from '../kit/styles'

export type Page = 'home' | 'projects' | 'tools' | 'settings'

/** Sidebar របស់ UI ថ្មី (Home.html `<nav>`): ផ្ទៃ `chrome`, ស៊ុមស្តាំ `field`,
 *  logo ៣៨px, nav ៤៦px, "ចូលប្រើរហ័ស", និងកាត plan នៅខាងក្រោម.
 *
 *  Home.html មានតែ ៣ nav; "Settings" យកពី sidebar របស់ Projects.html
 *  (component ដដែល) ព្រោះបើគ្មានវា ទំព័រ Models ចូលមិនបានពី Home ទេ.
 *  កាត plan ជា stub: app នេះគ្មានគណនី ឬនាទីទេ (local-first) — ចុចវាប្រាប់ដូច្នោះ. */
export function AppSidebar({
  page,
  onNavigate,
  onQuick,
  onPreview,
}: {
  page: Page
  onNavigate: (page: Page) => void
  onQuick: (presetId: string) => void // ចូលប្រើរហ័ស = preset ពិត
  onPreview: () => void // Upgrade (គ្មាន billing ពិត)
}) {
  return (
    <nav
      aria-label="Main"
      className="flex w-[250px] shrink-0 flex-col gap-1 border-r border-field bg-chrome px-4 py-5.5"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 px-1.5 pb-5.5">
        <span className="inline-flex size-[38px] items-center justify-center rounded-button bg-gold text-on-gold">
          <PlayMark size={16} />
        </span>
        <span data-tauri-drag-region className="leading-[1.2]">
          <span className="block text-[12px] text-text-3">Khmer</span>
          <span className="block text-[18px] font-bold">Clip Studio</span>
        </span>
      </div>

      <NavItem here={page === 'home'} onClick={() => onNavigate('home')} icon={HomeIcon}>
        ទំព័រដើម
      </NavItem>
      <NavItem here={page === 'projects'} onClick={() => onNavigate('projects')} icon={FolderIcon}>
        Projects របស់ខ្ញុំ
      </NavItem>
      <NavItem here={page === 'tools'} onClick={() => onNavigate('tools')} icon={GridIcon}>
        ឧបករណ៍ទាំងអស់
      </NavItem>
      <NavItem here={page === 'settings'} onClick={() => onNavigate('settings')} icon={SettingsIcon}>
        Settings
      </NavItem>

      <p className="mt-5.5 mb-1.5 ml-3.5 type-hint text-text-4">ចូលប្រើរហ័ស</p>
      <QuickItem icon={<ScissorsIcon />} onClick={() => onQuick('podcast')}>
        Auto Clip
      </QuickItem>
      <QuickItem icon={<SubtitlesIcon />} phase="PHASE 2">
        Subtitles ខ្មែរ
      </QuickItem>
      <QuickItem icon={<ReframeIcon />} onClick={() => onQuick('reframe')}>
        Reframe 9:16
      </QuickItem>

      <div className="mt-auto rounded-[12px] border border-line bg-card p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold">Free plan</p>
          <Chip>PREVIEW</Chip>
        </div>
        <p className="mt-0.5 mb-2.5 type-hint text-text-3">៣០ នាទីឥតគិតថ្លៃរៀងរាល់ខែ</p>
        <button
          type="button"
          onClick={onPreview}
          className={`flex min-h-[38px] w-full cursor-pointer items-center justify-center rounded-field border-0 bg-gold text-[13px] font-semibold text-on-gold ${focusRing}`}
        >
          Upgrade
        </button>
      </div>
    </nav>
  )
}

/** nav ៤៦px: ដែលសកម្ម = ផ្ទៃ `field`, អក្សរដិត, icon gold stroke 2;
 *  ផ្សេងទៀត = `text-2`, icon stroke 1.75 (Home.html). */
function NavItem({
  here,
  onClick,
  icon: Icon,
  children,
}: {
  here: boolean
  onClick: () => void
  icon: (props: { size?: number; weight?: number }) => ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={here ? 'page' : undefined}
      onClick={onClick}
      className={`flex min-h-11.5 w-full cursor-pointer items-center gap-3 rounded-button border-0 px-3.5 text-left text-[15px] ${focusRing} ${
        here ? 'bg-field font-bold text-text' : 'bg-transparent text-text-2 hover:bg-field/60'
      }`}
    >
      <span className={here ? 'text-gold' : ''}>
        <Icon weight={here ? 2 : 1.75} />
      </span>
      {children}
    </button>
  )
}

/** ចូលប្រើរហ័ស ៤២px; `phase` = មិនទាន់រត់បាន → ស្រអាប់ មិនចុចបាន. */
function QuickItem({
  icon,
  onClick,
  phase,
  children,
}: {
  icon: ReactNode
  onClick?: () => void
  phase?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={!!phase}
      onClick={onClick}
      title={phase ? `${phase} — មិនទាន់មាន` : undefined}
      className={`flex min-h-10.5 w-full cursor-pointer items-center gap-3 rounded-button border-0 bg-transparent px-3.5 text-left type-body text-text-2 hover:bg-field/60 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${focusRing}`}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {phase && <Chip>{phase}</Chip>}
    </button>
  )
}
