import { useState, type ReactNode } from 'react'
import { HeadsetIcon, SettingsIcon, UserIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { WindowControls } from '../kit/TopBar'
import { AppSidebar, type Page } from './AppSidebar'
import type { CatalogTab } from './tools'
import { PreviewDialog } from './PreviewDialog'
import { useT } from '../i18n'

/** ស៊ុមរួមរបស់ទំព័រដែល sidebar នាំទៅ (ទំព័រដើម, Projects, ឧបករណ៍ទាំងអស់, Settings).
 *
 *  Sidebar និងជួរខាងលើ (ជំនួយ, Menu, គណនី, ប៊ូតុង window) **នៅនឹង** ហើយមានតែ `children`
 *  (ផ្ទៃមាតិកា) ដែលប្តូរពេលចុច sidebar — ពីមុនទំព័រនីមួយៗមានស៊ុមរៀងខ្លួន ដូច្នេះការចុច
 *  sidebar ប្តូរ window ទាំងមូល (Projects មាន top bar ផ្សេង Settings មាន sidebar ចាស់).
 *  មាតិកាគ្រប់គ្រងការ scroll ខ្លួនឯង ព្រោះ Projects មាន footer `sticky`. */
export function AppShell({
  page,
  onNavigate,
  onQuick,
  onSettings,
  toolsTab,
  onToolsTab,
  children,
}: {
  page: Page
  onNavigate: (page: Page) => void
  onQuick: (presetId: string) => void
  onSettings: () => void // ប៊ូតុង Settings ស្តាំខាងលើ (ជំនួស Menu)
  toolsTab: CatalogTab
  onToolsTab: (tab: CatalogTab) => void
  children: ReactNode
}) {
  const t = useT()
  const [preview, setPreview] = useState<'account' | 'later' | null>(null)

  return (
    <div className="flex h-full min-h-0 w-full bg-bg font-kantumruy text-text">
      <AppSidebar
        page={page}
        onNavigate={onNavigate}
        onQuick={onQuick}
        toolsTab={toolsTab}
        onToolsTab={onToolsTab}
        onPreview={() => setPreview('account')}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* ជួរខាងលើ: ចន្លោះទទេអូស window បាន (window គ្មាន title bar របស់ Windows).
            វានៅ **ក្រៅ** ផ្ទៃដែល scroll — បើមិនដូច្នោះ ពេល scroll ចុះ ប៊ូតុងបិទ/បង្រួម
            និងតំបន់អូស window រមូរបាត់ (រកឃើញពេលធ្វើឲ្យ window តូច). */}
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center justify-end gap-2.5 px-8 pt-4.5"
        >
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          <IconButton label={t('ជំនួយ', 'Help')} onClick={() => setPreview('later')}>
            <HeadsetIcon />
          </IconButton>
          <IconButton label={t('Settings', 'Settings')} onClick={onSettings}>
            <SettingsIcon />
          </IconButton>
          <button
            type="button"
            onClick={() => setPreview('account')}
            className={`inline-flex min-h-10 cursor-pointer items-center gap-2.5 rounded-full border-0 bg-field py-0 pr-3.5 pl-1 type-body font-semibold text-text ${focusRing}`}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-raised-2 text-text-2">
              <UserIcon />
            </span>
            {t('ចូលគណនី', 'Sign in')}
          </button>
          <WindowControls />
        </div>

        <div className="flex min-h-0 flex-1">{children}</div>
      </main>

      {preview && <PreviewDialog kind={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex size-10 cursor-pointer items-center justify-center rounded-button border-0 bg-transparent text-text-2 hover:bg-field ${focusRing}`}
    >
      {children}
    </button>
  )
}
