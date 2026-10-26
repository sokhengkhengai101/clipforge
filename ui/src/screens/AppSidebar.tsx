import { useState, type ReactNode } from 'react'
import { Chip } from '../kit/controls'
import {
  FolderIcon,
  GridIcon,
  HomeIcon,
  PlayMark,
  ReframeIcon,
  ScissorsIcon,
  SubtitlesIcon,
} from '../kit/icons'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'
import { CATALOG_TABS, type CatalogTab } from './tools'

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
  toolsTab,
  onToolsTab,
  onPreview,
}: {
  page: Page
  onNavigate: (page: Page) => void
  onQuick: (presetId: string) => void // ចូលប្រើរហ័ស = preset ពិត
  toolsTab: CatalogTab
  onToolsTab: (tab: CatalogTab) => void // ទៅទំព័រ ឧបករណ៍ទាំងអស់ ក្នុង tab នោះ
  onPreview: () => void // Upgrade (គ្មាន billing ពិត)
}) {
  const t = useT()
  // ឧបករណ៍ទាំងអស់ ▾ (រូបដែលអ្នកអភិវឌ្ឍផ្ញើ): បើកលំនាំដើម; ចុចវាបិទ/បើក ហើយទៅទំព័រឧបករណ៍
  const [toolsOpen, setToolsOpen] = useState(true)
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
        {t('ទំព័រដើម', 'Home')}
      </NavItem>
      <NavItem here={page === 'projects'} onClick={() => onNavigate('projects')} icon={FolderIcon}>
        {t('Projects របស់ខ្ញុំ', 'My projects')}
      </NavItem>
      <NavItem
        here={page === 'tools'}
        onClick={() => {
          setToolsOpen((open) => !open)
          onToolsTab('popular')
        }}
        icon={GridIcon}
        expanded={toolsOpen}
      >
        {t('ឧបករណ៍ទាំងអស់', 'All tools')}
      </NavItem>
      {toolsOpen && (
        // ប្រភេទឧបករណ៍ ជាធាតុរង មានបន្ទាត់ឈរនៅខាងឆ្វេង (ដូចរូប)
        <div className="ml-[25px] flex flex-col gap-0.5 border-l border-raised-3 py-1 pl-3">
          {CATALOG_TABS.filter((item) => item.value !== 'recent' && item.value !== 'popular').map((item) => {
            const here = page === 'tools' && toolsTab === item.value
            return (
              <button
                key={item.value}
                type="button"
                aria-current={here ? 'page' : undefined}
                onClick={() => onToolsTab(item.value)}
                className={`flex min-h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-button border-0 px-3 text-left type-body ${focusRing} ${
                  here ? 'bg-field font-semibold text-text' : 'bg-transparent text-text-2 hover:bg-field/60'
                }`}
              >
                <span className={here ? 'text-gold' : 'text-text-3'}>{CATEGORY_ICON[item.value]}</span>
                {t(item.label)}
              </button>
            )
          })}
        </div>
      )}

      <p className="mt-5.5 mb-1.5 ml-3.5 type-hint text-text-4">{t('ចូលប្រើរហ័ស', 'Quick access')}</p>
      <QuickItem icon={<ScissorsIcon />} onClick={() => onQuick('shorts')}>
        Auto Clip
      </QuickItem>
      <QuickItem icon={<SubtitlesIcon />} phase="PHASE 2">
        {t('Subtitles ខ្មែរ', 'Subtitles KH')}
      </QuickItem>
      <QuickItem icon={<ReframeIcon />} onClick={() => onQuick('reframe')}>
        Reframe 9:16
      </QuickItem>

      <div className="mt-auto rounded-[12px] border border-line bg-card p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold">Free plan</p>
          <Chip>PREVIEW</Chip>
        </div>
        <p className="mt-0.5 mb-2.5 type-hint text-text-3">{t('៣០ នាទីឥតគិតថ្លៃរៀងរាល់ខែ', '30 free minutes every month')}</p>
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

/** icon នៃប្រភេទឧបករណ៍ក្រោម "ឧបករណ៍ទាំងអស់" (រូបដែលអ្នកអភិវឌ្ឍផ្ញើមាន icon នៅមុខធាតុរង). */
const CATEGORY_ICON: Partial<Record<CatalogTab, ReactNode>> = {
  clips: <ScissorsIcon size={15} />,
  subtitles: <SubtitlesIcon size={15} />,
  edit: <ReframeIcon size={15} />,
}

/** nav ៤៦px: ដែលសកម្ម = ផ្ទៃ `field`, អក្សរដិត, icon gold stroke 2;
 *  ផ្សេងទៀត = `text-2`, icon stroke 1.75 (Home.html). */
function NavItem({
  here,
  onClick,
  icon: Icon,
  expanded,
  children,
}: {
  here: boolean
  onClick: () => void
  icon: (props: { size?: number; weight?: number }) => ReactNode
  expanded?: boolean // មានធាតុរង: ព្រួញ ▾ / ▴
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={here ? 'page' : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={`flex min-h-11.5 w-full cursor-pointer items-center gap-3 rounded-button border-0 px-3.5 text-left text-[15px] ${focusRing} ${
        here ? 'bg-field font-bold text-text' : 'bg-transparent text-text-2 hover:bg-field/60'
      }`}
    >
      <span className={here ? 'text-gold' : ''}>
        <Icon weight={here ? 2 : 1.75} />
      </span>
      <span className="flex-1">{children}</span>
      {expanded !== undefined && (
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className={`text-text-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      )}
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
  const t = useT()
  return (
    <button
      type="button"
      disabled={!!phase}
      onClick={onClick}
      title={phase ? `${phase} — ${t('មិនទាន់មាន', 'not available yet')}` : undefined}
      className={`flex min-h-10.5 w-full cursor-pointer items-center gap-3 rounded-button border-0 bg-transparent px-3.5 text-left type-body text-text-2 hover:bg-field/60 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${focusRing}`}
    >
      {icon}
      {/* មួយបន្ទាត់ជានិច្ច — អក្សរ English វែងជាងខ្មែរ ហើយ chip PHASE យកកន្លែង */}
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{children}</span>
      {phase && <Chip>{phase}</Chip>}
    </button>
  )
}
