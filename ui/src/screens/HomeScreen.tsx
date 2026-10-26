import { useState, type ReactNode } from 'react'
import { Chip, Segmented } from '../kit/controls'
import { ArrowRightIcon, PlusIcon } from '../kit/icons'
import { ToolArt } from './ToolArt'
import { type Page } from './AppSidebar'
import { flagsOf } from '../presets'
import { FILTERS, TOOLS, type CatalogTab, type Category, type Tool } from './tools'
import { ToolsCatalog } from './ToolsCatalog'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'

/** Screen "Home" (design/screens/Home.html) — **មាតិកា**ប៉ុណ្ណោះ: sidebar និងជួរខាងលើនៅក្នុង
 *  `AppShell` ដូច្នេះចុច sidebar ប្តូរតែផ្ទៃនេះ.
 *
 *  ចុចឧបករណ៍ = ជ្រើស preset ពិតរបស់វា រួចទៅទំព័រ Projects (drop zone + ប៊ូតុង
 *  Start) — ទំព័រនោះនៅជារចនាចាស់រហូតដល់ជំហាន 2 (Main.html) ប្តូរវា.
 *  អ្វីដែល app មិនមាន (គណនី, Subtitles ខ្មែរ...) នៅលើអេក្រង់ តែប្រាប់ត្រង់ៗ. */
export function HomeScreen({
  page,
  onNavigate,
  onTool,
  onImport,
  recent,
  recentTools,
  onCatalogTool,
  catalogTab,
  onCatalogTab,
}: {
  page: 'home' | 'tools'
  onNavigate: (page: Page) => void
  onTool: (presetId: string) => void
  onImport: () => void // "Import វីដេអូ": ផ្ទាំងជ្រើស file ភ្លាម រួច dialog ការកំណត់
  recent?: ReactNode // ជួរ "Projects ថ្មីៗ" (App សង់ — កាតដូច Projects របស់ខ្ញុំ)
  recentTools: string[]
  onCatalogTool: (tool: Tool) => void
  catalogTab: CatalogTab
  onCatalogTab: (tab: CatalogTab) => void
}) {
  const t = useT()
  const [filter, setFilter] = useState<'popular' | Category>('popular')
  const shown = TOOLS.filter((item) => filter === 'popular' || item.categories.includes(filter))

  // មាតិកាដែល scroll; `scrollbar-gutter` ទុកកន្លែង scrollbar ជានិច្ច ដូច្នេះ
  // កាតមិនលោតឆ្វេង-ស្តាំពេល scrollbar លេច/បាត់ ពេលប្តូរទំហំ window
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6.5 overflow-y-auto px-8 pt-6.5 pb-8 [scrollbar-gutter:stable]">
      {page === 'tools' ? (
        // "ឧបករណ៍ទាំងអស់" = ទំព័រផ្ទាល់ខ្លួន (ToolsCatalog) ក្នុង sidebar និង top bar ដដែល
        <ToolsCatalog recent={recentTools} onOpen={onCatalogTool} tab={catalogTab} onTab={onCatalogTab} />
      ) : (
      <>
      <div className="flex flex-wrap gap-5">
        <Hero
          tone="gold"
          title="Auto Clip"
          text={t('វីដេអូវែង ក្លាយជា clips ខ្លីៗ ជាមួយ subtitles ខ្មែរត្រឹមត្រូវ។', 'Long videos become short clips with accurate Khmer subtitles.')}
          action={
            <HeroButton tone="gold" onClick={onImport}>
              <PlusIcon /> {t('Import វីដេអូ', 'Import video')}
            </HeroButton>
          }
          art={<ClipPhones />}
        />
        <Hero
          tone="info"
          title="Subtitle Studio"
          phase="PHASE 2"
          text={t('Subtitles ខ្មែរ ឬពីរភាសា ខ្មែរ + English សម្រាប់វីដេអូណាមួយ។', 'Khmer or bilingual Khmer + English subtitles for any video.')}
          action={
            // subtitles ខ្មែរ ជា Phase 2 — ប៊ូតុងនៅទីនោះ តែមិនធ្វើពុត
            <HeroButton tone="info" disabled>
              {t('ចាប់ផ្ដើម', 'Start')} <ArrowRightIcon />
            </HeroButton>
          }
          art={<SubtitleCard />}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('ប្រភេទឧបករណ៍', 'Tool type')}
          shape="pill"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((item) => ({ value: item.value, label: t(item.label) }))}
        />
        <button
          type="button"
          onClick={() => onNavigate('tools')}
          className="cursor-pointer border-0 bg-transparent type-body text-text-2 hover:text-text"
        >
          {t('ឧបករណ៍ទាំងអស់', 'All tools')} ›
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {shown.map((item) => (
          <ToolCard
            key={item.id}
            tool={item}
            onOpen={() => item.preset && onTool(item.preset.id)}
          />
        ))}
      </div>

      {/* Projects ថ្មីៗ នៅក្រោមឧបករណ៍ (អ្នកអភិវឌ្ឍសម្រេច) — ឧបករណ៍ជាអ្វីដែលអ្នកប្រើចាប់ផ្តើមពី */}
      {recent}
      </>
      )}
    </div>
  )
}

// ---------- hero ----------

/** កាតធំពីរ (radius 18, padding 28, ខ្ពស់ 190). ពណ៌អក្សររងលើផ្ទៃពណ៌ (#2B2B22,
 *  #1A2B44) ប្រើតែម្តងក្នុង design ហើយមិនមានក្នុង TOKENS.md ទេ ដូច្នេះវានៅទីនេះ. */
function Hero({
  tone,
  title,
  text,
  action,
  art,
  phase,
}: {
  tone: 'gold' | 'info'
  title: string
  text: string
  action: ReactNode
  art: ReactNode
  phase?: string
}) {
  const skin = tone === 'gold' ? 'bg-gold text-on-gold' : 'bg-info text-info-ink'
  const sub = tone === 'gold' ? 'text-[#2B2B22]' : 'text-[#1A2B44]'
  return (
    // basis 420 (design: 380): នៅ 1280 hero ពីរនៅក្បែរគ្នាដូច design; នៅ window តូចបំផុត
    // (1100) 380 ទើបតែគ្រប់ ហើយចំណងជើង និងប៊ូតុងរុំអក្សរ — 420 ធ្វើឲ្យវាដាក់ជាន់គ្នាជំនួស
    <section
      className={`flex min-h-[190px] min-w-0 flex-1 basis-[420px] items-center gap-4 rounded-dialog p-7 ${skin}`}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[26px] leading-[1.4] font-bold">{title}</h2>
        <p className={`mt-1.5 mb-4.5 type-body-lg ${sub}`}>{text}</p>
        {/* chip នៅក្បែរប៊ូតុង: វាពន្យល់ថាហេតុអ្វីប៊ូតុងនោះចុចមិនបាន */}
        <div className="flex items-center gap-2.5">
          {action}
          {phase && <Chip>{phase}</Chip>}
        </div>
      </div>
      <div aria-hidden="true" className="shrink-0">
        {art}
      </div>
    </section>
  )
}

/** ប៊ូតុងងងឹតលើ hero (44px, padding 18, អក្សរស 15 ដិត). */
function HeroButton({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: 'gold' | 'info'
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t('Subtitles ខ្មែរ ជារបស់ Phase 2', 'Khmer subtitles come in Phase 2') : undefined}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border-0 px-4.5 text-[15px] font-bold whitespace-nowrap text-white outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bg disabled:cursor-default disabled:opacity-50 ${
        tone === 'gold' ? 'bg-bg' : 'bg-info-ink'
      }`}
    >
      {children}
    </button>
  )
}

/** ទូរស័ព្ទបី ដែលមាន caption (Auto Clip hero). */
function ClipPhones() {
  return (
    <div className="flex items-end gap-2">
      <span className="relative h-[102px] w-[58px] rounded-button bg-bg">
        <span className="absolute right-1.5 bottom-3.5 left-1.5 h-2 rounded-[3px] bg-white" />
      </span>
      <span className="relative h-[124px] w-[70px] rounded-[12px] bg-bg">
        <span className="absolute right-5 bottom-4.5 left-2 h-[9px] rounded-[3px] bg-white" />
        <span className="absolute right-2 bottom-4.5 h-[9px] w-2.5 rounded-[3px] bg-gold" />
      </span>
      <span className="relative h-[102px] w-[58px] rounded-button bg-bg">
        <span className="absolute right-1.5 bottom-3.5 left-1.5 h-2 rounded-[3px] bg-white" />
      </span>
    </div>
  )
}

/** កាត subtitle ពីរភាសា (Subtitle Studio hero). */
function SubtitleCard() {
  return (
    <div className="flex w-[150px] flex-col gap-2 rounded-[12px] bg-info-ink p-3.5">
      <span className="h-2.5 w-4/5 rounded-[3px] bg-white" />
      <span className="h-2 w-3/5 rounded-[3px] bg-info" />
      <span className="mt-1.5 h-2.5 w-[70%] rounded-[3px] bg-white" />
      <span className="h-2 w-1/2 rounded-[3px] bg-info" />
    </div>
  )
}

// ---------- tool cards ----------

/** កាតឧបករណ៍ (radius 14, ផ្ទៃ card, ស៊ុម line): រូប 110px លើផ្ទៃ raised + ចំណងជើង.
 *  ឧបករណ៍ដែលមិនទាន់រត់បាន: ស្រអាប់ មិនចុចបាន ហើយមានស្លាក Phase. */
function ToolCard({ tool, onOpen }: { tool: Tool; onOpen: () => void }) {
  const t = useT()
  const ready = tool.phase === null
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onOpen}
      // tooltip = flag ពិតដែល job នឹងរត់ (description របស់ preset ជាភាសាអង់គ្លេស)
      title={
        ready && tool.preset
          ? flagsOf(tool.preset) || t('flag លំនាំដើម', 'default flags')
          : `${tool.phase} — ${t('មិនទាន់មាន', 'not available yet')}`
      }
      className={`flex cursor-pointer flex-col overflow-hidden rounded-card border border-line bg-card text-left text-text hover:border-raised-3 disabled:cursor-default disabled:opacity-50 disabled:hover:border-line ${focusRing}`}
    >
      <div
        aria-hidden="true"
        className="relative flex h-[110px] items-center justify-center bg-raised"
      >
        <ToolArt id={tool.id} />
        {!ready && (
          <span className="absolute top-2.5 right-2.5">
            <Chip>{tool.phase}</Chip>
          </span>
        )}
      </div>
      <div className="px-3.5 pt-3 pb-4">
        <p className="flex items-center gap-1.5 text-[15px] font-bold">
          {t(tool.title)}
          {tool.badge && (
            <span
              className={`rounded-[4px] px-1.5 text-[11px] font-bold ${
                tool.badge === 'AI' ? 'bg-gold text-on-gold' : 'bg-info text-info-ink'
              }`}
            >
              {tool.badge}
            </span>
          )}
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.6] text-text-3">{t(tool.description)}</p>
      </div>
    </button>
  )
}
